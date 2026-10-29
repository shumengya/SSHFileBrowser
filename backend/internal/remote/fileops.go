package remote

import "bytes"
import "context"
import "errors"
import "fmt"
import "io"
import "io/fs"
import "os"
import "path"
import "strconv"
import "strings"
import "sync"
import "unicode/utf8"

import walkfs "github.com/kr/fs"
import "github.com/pkg/sftp"

import "sshfilebrowser/internal/xio"

type Entry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Type    string `json:"type"`  // dir / file / link / other
	IsDir   bool   `json:"isDir"` // 指向目录的软链接也算目录,双击可以进入
	Size    int64  `json:"size"`
	Mode    string `json:"mode"` // 八进制,如 0755
	ModTime int64  `json:"mtime"`
	Owner   string `json:"owner"`
	Group   string `json:"group"`
	Target  string `json:"target,omitempty"`
	Broken  bool   `json:"broken,omitempty"`
}

func (conn *Conn) toEntry(fullPath string, info fs.FileInfo) Entry {
	var entry Entry = Entry{
		Name:    info.Name(),
		Path:    fullPath,
		Type:    "other",
		Size:    info.Size(),
		ModTime: info.ModTime().Unix(),
		Mode:    fmt.Sprintf("%04o", uint32(info.Mode().Perm())),
	}
	var stat, isStat = info.Sys().(*sftp.FileStat)
	if isStat {
		// 直接用原始 POSIX 位,保留 setuid/sticky
		entry.Mode = fmt.Sprintf("%04o", stat.Mode&0o7777)
		entry.Owner, entry.Group = conn.ownerNames(stat.UID, stat.GID)
	}
	var mode fs.FileMode = info.Mode()
	if mode.IsDir() {
		entry.Type = "dir"
		entry.IsDir = true
	}
	if mode.IsRegular() {
		entry.Type = "file"
	}
	if mode&fs.ModeSymlink != 0 {
		entry.Type = "link"
	}
	return entry
}

// resolveLink 补全软链接的目标与"是否指向目录"
func (conn *Conn) resolveLink(entry *Entry) {
	var target string
	var err error
	target, err = conn.sftp.ReadLink(entry.Path)
	if err == nil {
		entry.Target = target
	}
	var info fs.FileInfo
	info, err = conn.sftp.Stat(entry.Path)
	if err != nil {
		entry.Broken = true
		return
	}
	entry.IsDir = info.IsDir()
	if !info.IsDir() {
		entry.Size = info.Size()
	}
}

func (conn *Conn) List(dir string) ([]Entry, error) {
	var infos []fs.FileInfo
	var err error
	infos, err = conn.sftp.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读取目录: %w", err)
	}
	var entries []Entry = make([]Entry, len(infos))
	// 软链接要多两次往返,并发处理,最多 16 个同时进行
	var limiter chan struct{} = make(chan struct{}, 16)
	var waitGroup sync.WaitGroup
	var index int
	for index = 0; index < len(infos); index++ {
		entries[index] = conn.toEntry(path.Join(dir, infos[index].Name()), infos[index])
		if entries[index].Type != "link" {
			continue
		}
		var current *Entry = &entries[index]
		waitGroup.Go(func() {
			limiter <- struct{}{}
			conn.resolveLink(current)
			<-limiter
		})
	}
	waitGroup.Wait()
	return entries, nil
}

func (conn *Conn) Stat(fullPath string) (Entry, error) {
	var info fs.FileInfo
	var err error
	info, err = conn.sftp.Lstat(fullPath)
	if err != nil {
		return Entry{}, fmt.Errorf("读取文件信息: %w", err)
	}
	var entry Entry = conn.toEntry(fullPath, info)
	if entry.Type == "link" {
		conn.resolveLink(&entry)
	}
	return entry, nil
}

func (conn *Conn) exists(fullPath string) (bool, error) {
	var _, err = conn.sftp.Lstat(fullPath)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, fmt.Errorf("检查 %s: %w", fullPath, err)
}

// ReadText 只接受 UTF-8 文本:别的编码按 UTF-8 保存回去会把文件弄坏
func (conn *Conn) ReadText(fullPath string, maxSize int64) (string, error) {
	var file *sftp.File
	var err error
	file, err = conn.sftp.Open(fullPath)
	if err != nil {
		return "", fmt.Errorf("打开文件: %w", err)
	}
	defer xio.Close(file, "远程文件")
	var info fs.FileInfo
	info, err = file.Stat()
	if err != nil {
		return "", fmt.Errorf("读取文件信息: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("这是一个文件夹: %w", ErrBadPath)
	}
	if info.Size() > maxSize {
		return "", ErrTooLarge
	}
	var content []byte
	content, err = io.ReadAll(io.LimitReader(file, maxSize+1))
	if err != nil {
		return "", fmt.Errorf("读取文件: %w", err)
	}
	if int64(len(content)) > maxSize {
		return "", ErrTooLarge
	}
	if bytes.IndexByte(content[:min(len(content), 8000)], 0) >= 0 {
		return "", ErrBinary
	}
	if !utf8.Valid(content) {
		return "", fmt.Errorf("文件不是 UTF-8 编码: %w", ErrBinary)
	}
	return string(content), nil
}

// WriteText 原地截断写入,保留原文件的权限和属主
func (conn *Conn) WriteText(fullPath string, content string) error {
	var file *sftp.File
	var err error
	file, err = conn.sftp.OpenFile(fullPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("打开文件: %w", err)
	}
	_, err = io.WriteString(file, content)
	if err != nil {
		xio.Close(file, "远程文件")
		return fmt.Errorf("写入文件: %w", err)
	}
	err = file.Close()
	if err != nil {
		return fmt.Errorf("保存文件: %w", err)
	}
	return nil
}

func (conn *Conn) Mkdir(fullPath string) error {
	var found bool
	var err error
	found, err = conn.exists(fullPath)
	if err != nil {
		return err
	}
	if found {
		return ErrExists
	}
	err = conn.sftp.Mkdir(fullPath)
	if err != nil {
		return fmt.Errorf("新建文件夹: %w", err)
	}
	return nil
}

func (conn *Conn) Touch(fullPath string) error {
	var found bool
	var err error
	found, err = conn.exists(fullPath)
	if err != nil {
		return err
	}
	if found {
		return ErrExists
	}
	var file *sftp.File
	file, err = conn.sftp.OpenFile(fullPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if err != nil {
		return fmt.Errorf("新建文件: %w", err)
	}
	err = file.Close()
	if err != nil {
		return fmt.Errorf("新建文件: %w", err)
	}
	return nil
}

func (conn *Conn) Rename(oldPath string, newPath string) error {
	var found bool
	var err error
	found, err = conn.exists(newPath)
	if err != nil {
		return err
	}
	if found {
		return ErrExists
	}
	err = conn.sftp.Rename(oldPath, newPath)
	if err != nil {
		return fmt.Errorf("重命名: %w", err)
	}
	return nil
}

func quoteAll(paths []string) string {
	var quoted []string = make([]string, len(paths))
	var index int
	for index = 0; index < len(paths); index++ {
		quoted[index] = Quote(paths[index])
	}
	return strings.Join(quoted, " ")
}

func refuseRoot(paths []string) error {
	var index int
	for index = 0; index < len(paths); index++ {
		if paths[index] == "/" {
			return fmt.Errorf("不能操作根目录: %w", ErrBadPath)
		}
	}
	return nil
}

// Delete 有 shell 时用 rm -rf,大目录比逐个 SFTP 删除快几个数量级
func (conn *Conn) Delete(ctx context.Context, paths []string) error {
	var err error = refuseRoot(paths)
	if err != nil {
		return err
	}
	if conn.info.HasShell {
		return conn.Run(ctx, "rm -rf -- "+quoteAll(paths), io.Discard)
	}
	var index int
	for index = 0; index < len(paths); index++ {
		err = conn.sftp.RemoveAll(paths[index])
		if err != nil {
			return fmt.Errorf("删除 %s: %w", paths[index], err)
		}
	}
	return nil
}

func (conn *Conn) Chmod(ctx context.Context, paths []string, mode uint32, recursive bool) error {
	if mode > 0o7777 {
		return fmt.Errorf("权限值不合法: %w", ErrBadPath)
	}
	if conn.info.HasShell {
		var flag string = ""
		if recursive {
			flag = "-R "
		}
		return conn.Run(ctx, "chmod "+flag+fmt.Sprintf("%04o", mode)+" -- "+quoteAll(paths), io.Discard)
	}
	if recursive {
		return ErrNoShell
	}
	var index int
	for index = 0; index < len(paths); index++ {
		var err error = conn.sftp.Chmod(paths[index], os.FileMode(mode&0o777))
		if err != nil {
			return fmt.Errorf("修改权限: %w", err)
		}
	}
	return nil
}

// Chown 依赖 shell:SFTP 只接受数字 uid/gid,用户名换算交给远端 chown 更可靠
func (conn *Conn) Chown(ctx context.Context, paths []string, owner string, group string, recursive bool) error {
	if !conn.info.HasShell {
		return ErrNoShell
	}
	if owner != "" && !validAccount(owner) || group != "" && !validAccount(group) {
		return fmt.Errorf("用户名或用户组不合法: %w", ErrBadPath)
	}
	var flag string = ""
	if recursive {
		flag = "-R "
	}
	if owner == "" && group == "" {
		return nil
	}
	if owner == "" {
		return conn.Run(ctx, "chgrp "+flag+Quote(group)+" -- "+quoteAll(paths), io.Discard)
	}
	var spec string = owner
	if group != "" {
		spec = owner + ":" + group
	}
	return conn.Run(ctx, "chown "+flag+Quote(spec)+" -- "+quoteAll(paths), io.Discard)
}

// DirSize 优先 du -sb(字节精确);busybox 没有 -b 时退回 -sk
func (conn *Conn) DirSize(ctx context.Context, fullPath string) (int64, error) {
	if !conn.hasTool("du") {
		return conn.walkSize(fullPath)
	}
	var quoted string = Quote(fullPath)
	var script string = "du -sb -- " + quoted + " 2>/dev/null || du -sk -- " + quoted +
		" 2>/dev/null | awk '{print $1*1024}'; exit 0"
	var output string
	var err error
	output, err = conn.Output(ctx, script)
	if err != nil {
		return 0, err
	}
	var fields []string = strings.Fields(output)
	if len(fields) == 0 {
		return conn.walkSize(fullPath)
	}
	var size int64
	size, err = strconv.ParseInt(fields[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("解析 du 输出: %w", err)
	}
	return size, nil
}

func (conn *Conn) walkSize(fullPath string) (int64, error) {
	var total int64 = 0
	var walk *walkfs.Walker = conn.sftp.Walk(fullPath)
	for walk.Step() {
		// 没权限的子目录跳过,和 du 的行为一致
		if walk.Err() != nil {
			continue
		}
		if walk.Stat().Mode().IsRegular() {
			total += walk.Stat().Size()
		}
	}
	return total, nil
}
