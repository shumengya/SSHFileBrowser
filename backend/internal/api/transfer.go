package api

import "errors"
import "fmt"
import "io"
import "io/fs"
import "log"
import "mime"
import "net/http"
import "os"
import "path"
import "strings"
import "time"

import "github.com/gin-gonic/gin"
import "github.com/pkg/sftp"

import "sshfilebrowser/internal/remote"
import "sshfilebrowser/internal/secret"
import "sshfilebrowser/internal/xio"

// cleanRelative 校验上传时带的相对路径(文件夹上传会有 a/b/c.txt),不允许 .. 跳出目标目录
func cleanRelative(raw string) (string, error) {
	var parts []string = strings.Split(strings.ReplaceAll(raw, `\`, "/"), "/")
	var kept []string = []string{}
	var index int
	for index = 0; index < len(parts); index++ {
		if parts[index] == "" {
			continue
		}
		var name string
		var err error
		name, err = remote.CleanName(parts[index])
		if err != nil || name != parts[index] {
			return "", remote.ErrBadPath
		}
		kept = append(kept, name)
	}
	if len(kept) == 0 {
		return "", remote.ErrBadPath
	}
	return strings.Join(kept, "/"), nil
}

// sizedReader 告诉 sftp.File.ReadFrom 总大小,让它开启并发写
type sizedReader struct {
	io.Reader
	size int64
}

func (reader sizedReader) Size() int64 {
	return reader.size
}

// upload 请求体就是文件内容(不用 multipart),边收边写到远端,不落本地磁盘。
// 先写到同目录的临时文件,完整收到后再改名,中途断开不会留下半截文件。
func (server *Server) upload(ctx *gin.Context) {
	var dir string
	var valid bool
	dir, valid = queryPath(ctx, "dir")
	if !valid {
		return
	}
	var relative string
	var err error
	relative, err = cleanRelative(ctx.Query("name"))
	if err != nil {
		badRequest(ctx, "文件名不合法")
		return
	}
	var overwrite bool = ctx.Query("overwrite") == "1"
	var conn *remote.Conn
	var release func()
	conn, release, valid = server.conn(ctx)
	if !valid {
		return
	}
	defer release()
	var client *sftp.Client = conn.SFTP()
	var target string = path.Join(dir, relative)
	err = client.MkdirAll(path.Dir(target))
	if err != nil {
		respondError(ctx, fmt.Errorf("创建目录: %w", err))
		return
	}
	var existing fs.FileInfo
	existing, err = client.Lstat(target)
	if err == nil && (existing.IsDir() || !overwrite) {
		respondError(ctx, remote.ErrExists)
		return
	}
	var temp string = path.Join(path.Dir(target), fmt.Sprintf(".%s.%x.part", path.Base(target), secret.RandomBytes(4)))
	var file *sftp.File
	file, err = client.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		respondError(ctx, fmt.Errorf("创建文件: %w", err))
		return
	}
	var body io.Reader = ctx.Request.Body
	if ctx.Request.ContentLength > 0 {
		body = sizedReader{Reader: ctx.Request.Body, size: ctx.Request.ContentLength}
	}
	_, err = file.ReadFrom(body)
	var closeErr error = file.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil && existing != nil {
		// 覆盖时沿用原文件权限,否则会变成 umask 默认值
		err = client.Chmod(temp, existing.Mode().Perm())
	}
	if err == nil {
		err = replace(client, temp, target)
	}
	if err != nil {
		var removeErr error = client.Remove(temp)
		if removeErr != nil && !errors.Is(removeErr, fs.ErrNotExist) {
			log.Printf("清理临时文件 %s: %v", temp, removeErr)
		}
		respondError(ctx, fmt.Errorf("上传 %s: %w", relative, err))
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"path": target})
}

// replace 优先用 posix-rename(原子覆盖);服务器不支持该扩展时先删后改名
func replace(client *sftp.Client, temp string, target string) error {
	var err error = client.PosixRename(temp, target)
	if err == nil {
		return nil
	}
	err = client.Remove(target)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return client.Rename(temp, target)
}

// 允许在浏览器里直接打开(预览)的类型;其它一律下载,防止远端的 html/svg 在本站执行脚本
var inlineTypes []string = []string{"image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon", "video/", "audio/", "application/pdf"}

func inlineAllowed(contentType string) bool {
	var index int
	for index = 0; index < len(inlineTypes); index++ {
		if strings.HasPrefix(contentType, inlineTypes[index]) {
			return true
		}
	}
	return false
}

func setDisposition(ctx *gin.Context, kind string, name string) {
	ctx.Header("Content-Disposition", mime.FormatMediaType(kind, map[string]string{"filename": name}))
}

// download 单个文件直接流式返回(支持断点续传/拖动进度条);多个或文件夹打包成 zip
func (server *Server) download(ctx *gin.Context) {
	var paths []string
	var valid bool
	paths, valid = cleanPaths(ctx, ctx.QueryArray("path"))
	if !valid {
		return
	}
	var conn *remote.Conn
	var release func()
	conn, release, valid = server.conn(ctx)
	if !valid {
		return
	}
	defer release()
	ctx.Header("X-Content-Type-Options", "nosniff")
	ctx.Header("Content-Security-Policy", "sandbox")
	if len(paths) == 1 {
		var info fs.FileInfo
		var err error
		info, err = conn.SFTP().Stat(paths[0])
		if err != nil {
			respondError(ctx, err)
			return
		}
		if info.Mode().IsRegular() {
			server.serveFile(ctx, conn, paths[0], info)
			return
		}
	}
	var name string = "download.zip"
	if len(paths) == 1 {
		name = path.Base(paths[0]) + ".zip"
	}
	ctx.Header("Content-Type", "application/zip")
	setDisposition(ctx, "attachment", name)
	ctx.Status(http.StatusOK)
	// 响应头已经发出,出错只能记日志,浏览器会看到下载中断
	var err error = conn.ZipTo(ctx.Request.Context(), paths, ctx.Writer)
	if err != nil {
		log.Printf("打包下载: %v", err)
	}
}

func (server *Server) serveFile(ctx *gin.Context, conn *remote.Conn, fullPath string, info fs.FileInfo) {
	var file *sftp.File
	var err error
	file, err = conn.SFTP().Open(fullPath)
	if err != nil {
		respondError(ctx, err)
		return
	}
	defer xio.Close(file, "远程文件")
	var contentType string = mime.TypeByExtension(strings.ToLower(path.Ext(fullPath)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	var kind string = "attachment"
	if ctx.Query("inline") == "1" && inlineAllowed(contentType) {
		kind = "inline"
	}
	if kind == "attachment" {
		contentType = "application/octet-stream"
	}
	ctx.Header("Content-Type", contentType)
	setDisposition(ctx, kind, info.Name())
	http.ServeContent(ctx.Writer, ctx.Request, info.Name(), info.ModTime().Truncate(time.Second), file)
}
