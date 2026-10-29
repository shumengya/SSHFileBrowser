package remote

import "errors"
import "path"
import "regexp"
import "strings"

var ErrBadPath error = errors.New("路径不合法")
var ErrConnect error = errors.New("连接服务器失败")
var ErrExists error = errors.New("目标已存在")
var ErrNoShell error = errors.New("该服务器不支持执行命令(没有 POSIX shell),此功能不可用")
var ErrMissingTool error = errors.New("服务器缺少所需命令")
var ErrBinary error = errors.New("这是二进制文件,不能用文本编辑器打开")
var ErrTooLarge error = errors.New("文件过大,不能在线编辑")

// Quote 生成 POSIX shell 单引号字面量,任何字符都不会被解释
func Quote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

// CleanPath 要求绝对路径;用户传上来的每个路径都要过这一道
func CleanPath(raw string) (string, error) {
	if raw == "" || !strings.HasPrefix(raw, "/") || strings.ContainsRune(raw, 0) {
		return "", ErrBadPath
	}
	return path.Clean(raw), nil
}

// CleanName 校验单个文件名:不能带分隔符,也不能是 . 或 ..
func CleanName(name string) (string, error) {
	var trimmed string = strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." || trimmed == ".." || strings.ContainsAny(trimmed, "/\x00") {
		return "", ErrBadPath
	}
	return trimmed, nil
}

var accountPattern *regexp.Regexp = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]*$`)

func validAccount(name string) bool {
	return len(name) <= 64 && accountPattern.MatchString(name)
}

// isInside 判断 child 是否就是 parent 或在它里面,防止把目录复制进自己
func isInside(child string, parent string) bool {
	if parent == "/" {
		return true
	}
	return child == parent || strings.HasPrefix(child, parent+"/")
}

// splitName 把 "a.tar.gz" 拆成 "a" 和 ".tar.gz",用于生成"副本"名
func splitName(name string, isDir bool) (string, string) {
	if isDir || strings.HasPrefix(name, ".") && strings.Count(name, ".") == 1 {
		return name, ""
	}
	var lower string = strings.ToLower(name)
	var doubles []string = []string{".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst"}
	var index int
	for index = 0; index < len(doubles); index++ {
		if strings.HasSuffix(lower, doubles[index]) && len(name) > len(doubles[index]) {
			return name[:len(name)-len(doubles[index])], name[len(name)-len(doubles[index]):]
		}
	}
	var extension string = path.Ext(name)
	if extension == name {
		return name, ""
	}
	return strings.TrimSuffix(name, extension), extension
}
