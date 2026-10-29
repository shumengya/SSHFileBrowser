package remote

import "archive/zip"
import "context"
import "fmt"
import "io"
import "io/fs"
import "path"
import "strings"
import "sync"

import walkfs "github.com/kr/fs"
import "github.com/pkg/sftp"

import "sshfilebrowser/internal/xio"

const searchLimit int = 500

// Search 在 dir 下递归查找文件名包含 keyword 的条目(不区分大小写)。
// 有 find 用 find,没有就走 SFTP 遍历。第二个返回值表示结果是否被截断。
func (conn *Conn) Search(ctx context.Context, dir string, keyword string) ([]Entry, bool, error) {
	if conn.hasTool("find") {
		return conn.searchByFind(ctx, dir, keyword)
	}
	return conn.searchByWalk(ctx, dir, keyword)
}

func globEscape(value string) string {
	var replacer *strings.Replacer = strings.NewReplacer(`\`, `\\`, `*`, `\*`, `?`, `\?`, `[`, `\[`)
	return replacer.Replace(value)
}

func (conn *Conn) searchByFind(ctx context.Context, dir string, keyword string) ([]Entry, bool, error) {
	var pattern string = "*" + globEscape(keyword) + "*"
	// 多取一条用来判断是否截断;2>/dev/null 吞掉没权限目录的报错,exit 0 防止 find 的非零退出码
	var script string = fmt.Sprintf(
		"find %s -mindepth 1 -iname %s 2>/dev/null | head -n %d; exit 0",
		Quote(dir),
		Quote(pattern),
		searchLimit+1,
	)
	var output string
	var err error
	output, err = conn.Output(ctx, script)
	if err != nil {
		return nil, false, err
	}
	var lines []string = strings.Split(strings.TrimRight(output, "\n"), "\n")
	var paths []string = []string{}
	var index int
	for index = 0; index < len(lines); index++ {
		if strings.HasPrefix(lines[index], "/") {
			paths = append(paths, lines[index])
		}
	}
	var truncated bool = len(paths) > searchLimit
	if truncated {
		paths = paths[:searchLimit]
	}
	return conn.statMany(paths), truncated, nil
}

// statMany 并发 lstat,失败的(比如刚被删掉)直接丢掉
func (conn *Conn) statMany(paths []string) []Entry {
	var results []Entry = make([]Entry, len(paths))
	var valid []bool = make([]bool, len(paths))
	var limiter chan struct{} = make(chan struct{}, 16)
	var waitGroup sync.WaitGroup
	var index int
	for index = 0; index < len(paths); index++ {
		var position int = index
		waitGroup.Go(func() {
			limiter <- struct{}{}
			defer func() { <-limiter }()
			var entry Entry
			var err error
			entry, err = conn.Stat(paths[position])
			if err != nil {
				return
			}
			results[position] = entry
			valid[position] = true
		})
	}
	waitGroup.Wait()
	var entries []Entry = []Entry{}
	for index = 0; index < len(results); index++ {
		if valid[index] {
			entries = append(entries, results[index])
		}
	}
	return entries
}

func (conn *Conn) searchByWalk(ctx context.Context, dir string, keyword string) ([]Entry, bool, error) {
	var lowered string = strings.ToLower(keyword)
	var paths []string = []string{}
	var walk *walkfs.Walker = conn.sftp.Walk(dir)
	var visited int = 0
	for walk.Step() {
		if ctx.Err() != nil {
			return nil, false, ctx.Err()
		}
		visited++
		// 没有 find 的服务器上兜底,防止在超大目录树里跑太久
		if visited > 200000 || len(paths) > searchLimit {
			break
		}
		if walk.Err() != nil || walk.Path() == dir {
			continue
		}
		if strings.Contains(strings.ToLower(path.Base(walk.Path())), lowered) {
			paths = append(paths, walk.Path())
		}
	}
	var truncated bool = len(paths) > searchLimit || visited > 200000
	if len(paths) > searchLimit {
		paths = paths[:searchLimit]
	}
	return conn.statMany(paths), truncated, nil
}

// ZipTo 把多个文件/文件夹边读边压缩写到 writer,用于打包下载。
// 软链接不跟随,避免循环;读不到的文件跳过。
func (conn *Conn) ZipTo(ctx context.Context, paths []string, writer io.Writer) error {
	var archive *zip.Writer = zip.NewWriter(writer)
	var index int
	for index = 0; index < len(paths); index++ {
		var root string = paths[index]
		var walk *walkfs.Walker = conn.sftp.Walk(root)
		for walk.Step() {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if walk.Err() != nil {
				continue
			}
			var info fs.FileInfo = walk.Stat()
			var name string = path.Base(root) + strings.TrimPrefix(walk.Path(), root)
			var err error
			if info.IsDir() {
				_, err = archive.CreateHeader(&zip.FileHeader{Name: name + "/", Modified: info.ModTime()})
				if err != nil {
					return fmt.Errorf("写入压缩包: %w", err)
				}
				continue
			}
			if !info.Mode().IsRegular() {
				continue
			}
			err = conn.zipFile(archive, walk.Path(), name, info)
			if err != nil {
				return err
			}
		}
	}
	return archive.Close()
}

func (conn *Conn) zipFile(archive *zip.Writer, fullPath string, name string, info fs.FileInfo) error {
	var header *zip.FileHeader
	var err error
	header, err = zip.FileInfoHeader(info)
	if err != nil {
		return fmt.Errorf("生成压缩包条目: %w", err)
	}
	header.Name = name
	header.Method = zip.Deflate
	var entryWriter io.Writer
	entryWriter, err = archive.CreateHeader(header)
	if err != nil {
		return fmt.Errorf("写入压缩包: %w", err)
	}
	var file *sftp.File
	file, err = conn.sftp.Open(fullPath)
	if err != nil {
		// 没权限读的文件留一个空条目,不中断整个下载
		return nil
	}
	defer xio.Close(file, "远程文件")
	_, err = file.WriteTo(entryWriter)
	if err != nil {
		return fmt.Errorf("读取 %s: %w", fullPath, err)
	}
	return nil
}
