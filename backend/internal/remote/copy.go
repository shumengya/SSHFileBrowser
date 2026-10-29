package remote

import "context"
import "errors"
import "fmt"
import "io"
import "io/fs"
import "path"
import "regexp"
import "strconv"

// Progress 回调:0~1 之间的进度和一句当前状态
type Progress func(fraction float64, message string)

const ConflictSkip string = "skip"
const ConflictOverwrite string = "overwrite"
const ConflictRename string = "rename"

// Transfer 描述一次粘贴:Source 与 Target 是同一个连接时走远端命令,否则经本服务中转
type Transfer struct {
	Source    *Conn
	Target    *Conn
	Paths     []string
	TargetDir string
	Move      bool
	Conflict  string
	Report    Progress
}

func (transfer *Transfer) sameHost() bool {
	return transfer.Source == transfer.Target
}

func (transfer *Transfer) Run(ctx context.Context) error {
	var err error = refuseRoot(transfer.Paths)
	if err != nil {
		return err
	}
	var total int = len(transfer.Paths)
	var index int
	for index = 0; index < total; index++ {
		var done float64 = float64(index)
		var source string = transfer.Paths[index]
		// 每一项的进度折算到整体进度里
		var report Progress = func(fraction float64, message string) {
			transfer.Report((done+fraction)/float64(total), message)
		}
		report(0, path.Base(source))
		err = transfer.one(ctx, source, report)
		if err != nil {
			return fmt.Errorf("%s: %w", path.Base(source), err)
		}
	}
	transfer.Report(1, "完成")
	return nil
}

func (transfer *Transfer) one(ctx context.Context, source string, report Progress) error {
	var info fs.FileInfo
	var err error
	info, err = transfer.Source.sftp.Lstat(source)
	if err != nil {
		return fmt.Errorf("读取源文件: %w", err)
	}
	var isDir bool = info.IsDir()
	if transfer.sameHost() && isDir && isInside(transfer.TargetDir, source) {
		return errors.New("不能把文件夹复制或移动到它自己里面")
	}
	var dest string
	var skip bool
	dest, skip, err = transfer.destination(source, isDir)
	if err != nil || skip {
		return err
	}
	// 同机移动且目标不存在:直接改名,瞬间完成
	var destInfo fs.FileInfo
	destInfo, err = transfer.Target.sftp.Lstat(dest)
	var destExists bool = err == nil
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("检查目标: %w", err)
	}
	if transfer.Move && transfer.sameHost() && !destExists {
		err = transfer.Source.sftp.Rename(source, dest)
		if err == nil {
			return nil
		}
		// 跨分区改名会失败,退回复制后删除
	}
	// 类型不同(文件覆盖文件夹或反过来)无法合并,先删掉旧的
	if destExists && destInfo.IsDir() != isDir {
		err = transfer.Target.Delete(ctx, []string{dest})
		if err != nil {
			return fmt.Errorf("删除旧目标: %w", err)
		}
	}
	if transfer.sameHost() && transfer.Source.info.HasShell {
		err = transfer.Source.copyByShell(ctx, source, dest, isDir, report)
	}
	if !transfer.sameHost() || !transfer.Source.info.HasShell {
		err = transfer.copyStream(ctx, source, dest, report)
	}
	if err != nil {
		return err
	}
	if transfer.Move {
		return transfer.Source.Delete(ctx, []string{source})
	}
	return nil
}

// destination 处理重名:同目录复制一律生成"副本",否则按冲突策略
func (transfer *Transfer) destination(source string, isDir bool) (string, bool, error) {
	var name string = path.Base(source)
	var dest string = path.Join(transfer.TargetDir, name)
	var sameDir bool = transfer.sameHost() && dest == source
	if sameDir && transfer.Move {
		return dest, true, nil
	}
	var found bool
	var err error
	found, err = transfer.Target.exists(dest)
	if err != nil || !found {
		return dest, false, err
	}
	if sameDir || transfer.Conflict == ConflictRename {
		dest, err = transfer.Target.uniqueName(transfer.TargetDir, name, isDir)
		return dest, false, err
	}
	if transfer.Conflict == ConflictOverwrite {
		return dest, false, nil
	}
	return dest, true, nil
}

// uniqueName 生成 "a - 副本.txt"、"a - 副本 (2).txt" ……
func (conn *Conn) uniqueName(dir string, name string, isDir bool) (string, error) {
	var stem, extension = splitName(name, isDir)
	var attempt int
	for attempt = 1; attempt < 1000; attempt++ {
		var candidate string = stem + " - 副本" + extension
		if attempt > 1 {
			candidate = stem + " - 副本 (" + strconv.Itoa(attempt) + ")" + extension
		}
		var full string = path.Join(dir, candidate)
		var found bool
		var err error
		found, err = conn.exists(full)
		if err != nil {
			return "", err
		}
		if !found {
			return full, nil
		}
	}
	return "", errors.New("找不到可用的副本名")
}

var rsyncPercent *regexp.Regexp = regexp.MustCompile(`(\d{1,3})%`)

// copyByShell 同机复制:有 rsync 用 rsync(带进度),否则 cp -a。
// 目录统一用 "src/" -> "dest/" 的形式,目标已存在时就是合并,不会多套一层。
func (conn *Conn) copyByShell(ctx context.Context, source string, dest string, isDir bool, report Progress) error {
	var sourceArg string = Quote(source)
	var destArg string = Quote(dest)
	if isDir {
		sourceArg = Quote(source + "/")
		destArg = Quote(dest + "/")
	}
	if conn.hasTool("rsync") {
		var onLine func(line string) = func(line string) {
			var match []string = rsyncPercent.FindStringSubmatch(line)
			if match == nil {
				return
			}
			var percent int
			var err error
			percent, err = strconv.Atoi(match[1])
			if err == nil {
				report(float64(min(percent, 100))/100, path.Base(source))
			}
		}
		// 老版本 rsync 不认识 --info=progress2,失败就不带进度再来一次
		var err error = conn.RunLines(ctx, "rsync -a --info=progress2 -- "+sourceArg+" "+destArg, onLine)
		if err == nil || ctx.Err() != nil {
			return err
		}
		return conn.Run(ctx, "rsync -a -- "+sourceArg+" "+destArg, io.Discard)
	}
	if isDir {
		return conn.Run(ctx, "mkdir -p -- "+Quote(dest)+" && cp -a -- "+Quote(source+"/.")+" "+destArg, io.Discard)
	}
	return conn.Run(ctx, "cp -a -- "+sourceArg+" "+destArg, io.Discard)
}
