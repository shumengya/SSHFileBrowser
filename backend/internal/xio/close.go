package xio

import "errors"
import "io"
import "log"
import "net"
import "os"

// Close 用于 defer 关闭资源:规范不允许丢弃 error,这里统一记日志。
// 读场景的关闭失败不影响结果;写场景要自己显式检查 Close 的返回值。
func Close(closer io.Closer, what string) {
	var err error = closer.Close()
	if err == nil {
		return
	}
	// 重复关闭、对端先断开属于正常情况,不刷日志
	if errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) || errors.Is(err, os.ErrClosed) {
		return
	}
	log.Printf("关闭%s: %v", what, err)
}
