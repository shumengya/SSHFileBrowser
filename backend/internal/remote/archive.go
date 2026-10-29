package remote

import "context"
import "errors"
import "fmt"
import "io"
import "path"
import "strings"

// 支持的压缩格式,和前端下拉框一一对应
var archiveFormats map[string]string = map[string]string{
	"zip":     ".zip",
	"tar.gz":  ".tar.gz",
	"tar.bz2": ".tar.bz2",
	"tar.xz":  ".tar.xz",
	"tar":     ".tar",
}

func requireTool(conn *Conn, tool string) error {
	if !conn.info.HasShell {
		return ErrNoShell
	}
	if !conn.info.Tools[tool] {
		return fmt.Errorf("%w: %s", ErrMissingTool, tool)
	}
	return nil
}

// relativeNames 要求所有条目都在 baseDir 下,返回 "./名字" 形式,避免以 - 开头的文件名被当成参数
func relativeNames(baseDir string, paths []string) (string, error) {
	var names []string = make([]string, len(paths))
	var index int
	for index = 0; index < len(paths); index++ {
		if path.Dir(paths[index]) != baseDir {
			return "", fmt.Errorf("压缩的文件必须在同一个目录下: %w", ErrBadPath)
		}
		names[index] = "./" + path.Base(paths[index])
	}
	return quoteAll(names), nil
}

// Compress 把 baseDir 下的若干条目打包成 archive(绝对路径)
func (conn *Conn) Compress(ctx context.Context, baseDir string, paths []string, archive string, format string) error {
	var extension string = archiveFormats[format]
	if extension == "" {
		return fmt.Errorf("不支持的压缩格式 %s: %w", format, ErrBadPath)
	}
	var tool string = "tar"
	if format == "zip" {
		tool = "zip"
	}
	var err error = requireTool(conn, tool)
	if err != nil {
		return err
	}
	var found bool
	found, err = conn.exists(archive)
	if err != nil {
		return err
	}
	// zip 遇到已存在的文件会往里追加,必须提前拦住
	if found {
		return ErrExists
	}
	var names string
	names, err = relativeNames(baseDir, paths)
	if err != nil {
		return err
	}
	var flags map[string]string = map[string]string{
		"tar.gz":  "-czf",
		"tar.bz2": "-cjf",
		"tar.xz":  "-cJf",
		"tar":     "-cf",
	}
	var script string = "cd " + Quote(baseDir) + " && "
	if format == "zip" {
		script += "zip -qry " + Quote(archive) + " " + names
	}
	if format != "zip" {
		script += "tar " + flags[format] + " " + Quote(archive) + " -- " + names
	}
	return conn.Run(ctx, script, io.Discard)
}

// Extract 按扩展名选择解压命令,解压到 destDir(不存在会自动创建)
func (conn *Conn) Extract(ctx context.Context, archive string, destDir string, overwrite bool) error {
	var lower string = strings.ToLower(archive)
	var script string = "mkdir -p -- " + Quote(destDir) + " && "
	var tool string = "tar"
	var err error
	if strings.HasSuffix(lower, ".zip") {
		tool = "unzip"
		var mode string = "-n"
		if overwrite {
			mode = "-o"
		}
		script += "unzip -q " + mode + " -- " + Quote(archive) + " -d " + Quote(destDir)
	}
	if tool == "tar" {
		var flag string = ""
		if strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") {
			flag = "-xzf"
		}
		if strings.HasSuffix(lower, ".tar.bz2") || strings.HasSuffix(lower, ".tbz2") {
			flag = "-xjf"
		}
		if strings.HasSuffix(lower, ".tar.xz") || strings.HasSuffix(lower, ".txz") {
			flag = "-xJf"
		}
		if strings.HasSuffix(lower, ".tar") {
			flag = "-xf"
		}
		if flag == "" {
			return errors.New("不支持的压缩包格式,支持 zip / tar / tar.gz / tar.bz2 / tar.xz")
		}
		var command string = "tar " + flag + " " + Quote(archive) + " -C " + Quote(destDir)
		script += command
		// GNU tar 用 --skip-old-files 静默跳过已存在文件;busybox 不认识就退回 -k
		if !overwrite {
			script += " --skip-old-files 2>/dev/null || " + command + " -k"
		}
	}
	err = requireTool(conn, tool)
	if err != nil {
		return err
	}
	return conn.Run(ctx, script, io.Discard)
}
