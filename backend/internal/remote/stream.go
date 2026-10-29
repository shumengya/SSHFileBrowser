package remote

import "context"
import "errors"
import "fmt"
import "io"
import "io/fs"
import "log"
import "os"
import "path"
import "strings"
import "time"

import walkfs "github.com/kr/fs"
import "github.com/pkg/sftp"

import "sshfilebrowser/internal/xio"

// countingReader 统计已复制字节,同时响应取消。
// 带 Size() 是为了让 sftp.File.ReadFrom 识别出大小、开启并发写。
type countingReader struct {
	ctx    context.Context
	reader io.Reader
	size   int64
	onRead func(count int)
}

func (counter *countingReader) Size() int64 {
	return counter.size
}

func (counter *countingReader) Read(buffer []byte) (int, error) {
	var err error = counter.ctx.Err()
	if err != nil {
		return 0, err
	}
	var count int
	count, err = counter.reader.Read(buffer)
	counter.onRead(count)
	return count, err
}

// copyStream 经本服务中转复制:跨服务器粘贴,或服务器没有 shell 时使用
func (transfer *Transfer) copyStream(ctx context.Context, source string, dest string, report Progress) error {
	var srcClient *sftp.Client = transfer.Source.sftp
	var dstClient *sftp.Client = transfer.Target.sftp
	// 先走一遍算总大小,进度条才有意义
	var total int64 = 0
	var walk *walkfs.Walker = srcClient.Walk(source)
	for walk.Step() {
		if walk.Err() == nil && walk.Stat().Mode().IsRegular() {
			total += walk.Stat().Size()
		}
	}
	var copied int64 = 0
	var lastReport time.Time
	var onRead func(count int) = func(count int) {
		copied += int64(count)
		if total > 0 && time.Since(lastReport) > 300*time.Millisecond {
			lastReport = time.Now()
			report(float64(copied)/float64(total), path.Base(source))
		}
	}
	walk = srcClient.Walk(source)
	for walk.Step() {
		var err error = walk.Err()
		if err != nil {
			return fmt.Errorf("遍历 %s: %w", walk.Path(), err)
		}
		err = ctx.Err()
		if err != nil {
			return err
		}
		var relative string = strings.TrimPrefix(walk.Path(), source)
		var target string = dest + relative
		var info fs.FileInfo = walk.Stat()
		var mode fs.FileMode = info.Mode()
		if mode.IsDir() {
			err = dstClient.MkdirAll(target)
			if err != nil {
				return fmt.Errorf("创建目录 %s: %w", target, err)
			}
			continue
		}
		if mode&fs.ModeSymlink != 0 {
			err = copyLink(srcClient, dstClient, walk.Path(), target)
			if err != nil {
				return err
			}
			continue
		}
		if !mode.IsRegular() {
			// 设备文件、管道之类没法复制,跳过
			continue
		}
		err = copyFile(ctx, srcClient, dstClient, walk.Path(), target, info, onRead)
		if err != nil {
			return err
		}
	}
	return nil
}

func copyLink(srcClient *sftp.Client, dstClient *sftp.Client, source string, target string) error {
	var link string
	var err error
	link, err = srcClient.ReadLink(source)
	if err != nil {
		return fmt.Errorf("读取软链接 %s: %w", source, err)
	}
	// 目标位置已有同名文件时 Symlink 会失败,先删掉
	err = dstClient.Remove(target)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("替换软链接 %s: %w", target, err)
	}
	err = dstClient.Symlink(link, target)
	if err != nil {
		return fmt.Errorf("创建软链接 %s: %w", target, err)
	}
	return nil
}

func copyFile(ctx context.Context, srcClient *sftp.Client, dstClient *sftp.Client, source string, target string, info fs.FileInfo, onRead func(count int)) error {
	var reader *sftp.File
	var err error
	reader, err = srcClient.Open(source)
	if err != nil {
		return fmt.Errorf("打开 %s: %w", source, err)
	}
	defer xio.Close(reader, "源文件")
	var writer *sftp.File
	writer, err = dstClient.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("创建 %s: %w", target, err)
	}
	var counter *countingReader = &countingReader{
		ctx:    ctx,
		reader: reader,
		size:   info.Size(),
		onRead: onRead,
	}
	_, err = writer.ReadFrom(counter)
	if err != nil {
		xio.Close(writer, "目标文件")
		return fmt.Errorf("复制 %s: %w", source, err)
	}
	err = writer.Close()
	if err != nil {
		return fmt.Errorf("保存 %s: %w", target, err)
	}
	// 尽量保留权限和修改时间;失败(比如不是属主)不影响内容,只记日志
	err = dstClient.Chmod(target, info.Mode().Perm())
	if err == nil {
		err = dstClient.Chtimes(target, time.Now(), info.ModTime())
	}
	if err != nil {
		log.Printf("保留 %s 的属性: %v", target, err)
	}
	return nil
}
