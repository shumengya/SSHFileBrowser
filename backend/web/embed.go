package web

import "embed"
import "fmt"
import "io/fs"

// dist 由 frontend 的 pnpm build 生成(vite.config.ts 里 outDir 指向这里),编译时整体打进二进制。
// 目录不存在时 go build 会直接报错,请先运行根目录的 build.ps1。
//
//go:embed all:dist
var files embed.FS

// Dist 返回以 dist 为根的前端文件系统
func Dist() (fs.FS, error) {
	var sub fs.FS
	var err error
	sub, err = fs.Sub(files, "dist")
	if err != nil {
		return nil, fmt.Errorf("读取内嵌前端: %w", err)
	}
	return sub, nil
}
