package api

import "errors"
import "io/fs"
import "log"
import "net/http"
import "strings"

import "github.com/gin-gonic/gin"

import "sshfilebrowser/internal/remote"
import "sshfilebrowser/internal/store"

// errorBody 统一的错误响应:code 给前端做分支,message 直接展示
type errorBody struct {
	Code        string `json:"code"`
	Message     string `json:"message"`
	Fingerprint string `json:"fingerprint,omitempty"`
}

func respondError(ctx *gin.Context, err error) {
	var hostKeyError *remote.HostKeyError
	if errors.As(err, &hostKeyError) {
		ctx.AbortWithStatusJSON(http.StatusConflict, errorBody{
			Code:        "HOSTKEY_MISMATCH",
			Message:     err.Error(),
			Fingerprint: hostKeyError.Fingerprint,
		})
		return
	}
	var status int = http.StatusBadGateway
	var body errorBody = errorBody{Code: "CONNECT_FAILED", Message: err.Error()}
	if !errors.Is(err, remote.ErrConnect) {
		status, body.Code, body.Message = classify(err)
	}
	if status == http.StatusInternalServerError {
		log.Printf("请求 %s %s 出错: %v", ctx.Request.Method, ctx.Request.URL.Path, err)
	}
	ctx.AbortWithStatusJSON(status, body)
}

func classify(err error) (int, string, string) {
	var message string = err.Error()
	if errors.Is(err, store.ErrNotFound) {
		return http.StatusNotFound, "NOT_FOUND", "记录不存在"
	}
	if errors.Is(err, remote.ErrBadPath) {
		return http.StatusBadRequest, "BAD_REQUEST", message
	}
	if errors.Is(err, remote.ErrExists) || errors.Is(err, fs.ErrExist) {
		return http.StatusConflict, "EXISTS", "目标已存在"
	}
	if errors.Is(err, fs.ErrNotExist) {
		return http.StatusNotFound, "NOT_EXIST", "文件或目录不存在"
	}
	if errors.Is(err, fs.ErrPermission) || strings.Contains(strings.ToLower(message), "permission denied") {
		return http.StatusForbidden, "PERMISSION_DENIED", "权限不足:" + message
	}
	if errors.Is(err, remote.ErrBinary) {
		return http.StatusUnprocessableEntity, "BINARY", message
	}
	if errors.Is(err, remote.ErrTooLarge) {
		return http.StatusRequestEntityTooLarge, "TOO_LARGE", message
	}
	if errors.Is(err, remote.ErrNoShell) || errors.Is(err, remote.ErrMissingTool) {
		return http.StatusNotImplemented, "UNSUPPORTED", message
	}
	return http.StatusInternalServerError, "INTERNAL", message
}

func badRequest(ctx *gin.Context, message string) {
	ctx.AbortWithStatusJSON(http.StatusBadRequest, errorBody{Code: "BAD_REQUEST", Message: message})
}
