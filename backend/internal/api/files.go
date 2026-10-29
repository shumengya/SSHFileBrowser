package api

import "context"
import "net/http"
import "path"
import "strconv"
import "strings"
import "time"

import "github.com/gin-gonic/gin"

import "sshfilebrowser/internal/remote"

const maxEditSize int64 = 5 << 20

// conn 取当前请求对应服务器的连接;返回 false 时已经写好了错误响应
func (server *Server) conn(ctx *gin.Context) (*remote.Conn, func(), bool) {
	var hostID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return nil, nil, false
	}
	var conn *remote.Conn
	var release func()
	var err error
	conn, release, err = server.pool.Get(ctx.Request.Context(), hostID)
	if err != nil {
		respondError(ctx, err)
		return nil, nil, false
	}
	return conn, release, true
}

// detached 删除、递归改权限这类操作中途被取消会留下半成品,不跟随浏览器断开
func detached(ctx *gin.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx.Request.Context()), 30*time.Minute)
}

func queryPath(ctx *gin.Context, name string) (string, bool) {
	var cleaned string
	var err error
	cleaned, err = remote.CleanPath(ctx.Query(name))
	if err != nil {
		badRequest(ctx, "路径不合法")
		return "", false
	}
	return cleaned, true
}

func cleanPaths(ctx *gin.Context, raw []string) ([]string, bool) {
	if len(raw) == 0 {
		badRequest(ctx, "没有选择文件")
		return nil, false
	}
	var paths []string = make([]string, len(raw))
	var index int
	for index = 0; index < len(raw); index++ {
		var err error
		paths[index], err = remote.CleanPath(raw[index])
		if err != nil {
			badRequest(ctx, "路径不合法")
			return nil, false
		}
	}
	return paths, true
}

func (server *Server) listDir(ctx *gin.Context) {
	var dir string
	var valid bool
	dir, valid = queryPath(ctx, "path")
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
	var entries []remote.Entry
	var err error
	entries, err = conn.List(dir)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"path": dir, "entries": entries})
}

func (server *Server) statPath(ctx *gin.Context) {
	var target string
	var valid bool
	target, valid = queryPath(ctx, "path")
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
	var entry remote.Entry
	var err error
	entry, err = conn.Stat(target)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, entry)
}

func (server *Server) readContent(ctx *gin.Context) {
	var target string
	var valid bool
	target, valid = queryPath(ctx, "path")
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
	var content string
	var err error
	content, err = conn.ReadText(target, maxEditSize)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"path": target, "content": content})
}

type contentInput struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

func (server *Server) writeContent(ctx *gin.Context) {
	ctx.Request.Body = http.MaxBytesReader(ctx.Writer, ctx.Request.Body, maxEditSize*2)
	var input contentInput = contentInput{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误或内容过大")
		return
	}
	var target string
	target, err = remote.CleanPath(input.Path)
	if err != nil {
		badRequest(ctx, "路径不合法")
		return
	}
	var conn *remote.Conn
	var release func()
	var valid bool
	conn, release, valid = server.conn(ctx)
	if !valid {
		return
	}
	defer release()
	err = conn.WriteText(target, input.Content)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{})
}

type createInput struct {
	Dir  string `json:"dir"`
	Name string `json:"name"`
}

// createEntry 新建文件夹/文件共用:校验目录与名字,拼出完整路径
func (server *Server) createEntry(ctx *gin.Context, create func(conn *remote.Conn, fullPath string) error) {
	var input createInput = createInput{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	var dir string
	dir, err = remote.CleanPath(input.Dir)
	if err != nil {
		badRequest(ctx, "路径不合法")
		return
	}
	var name string
	name, err = remote.CleanName(input.Name)
	if err != nil {
		badRequest(ctx, "名称不能为空,也不能包含 /")
		return
	}
	var conn *remote.Conn
	var release func()
	var valid bool
	conn, release, valid = server.conn(ctx)
	if !valid {
		return
	}
	defer release()
	var fullPath string = path.Join(dir, name)
	err = create(conn, fullPath)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"path": fullPath})
}

func (server *Server) mkdir(ctx *gin.Context) {
	server.createEntry(ctx, func(conn *remote.Conn, fullPath string) error {
		return conn.Mkdir(fullPath)
	})
}

func (server *Server) touch(ctx *gin.Context) {
	server.createEntry(ctx, func(conn *remote.Conn, fullPath string) error {
		return conn.Touch(fullPath)
	})
}

type renameInput struct {
	Path    string `json:"path"`
	NewName string `json:"newName"`
}

func (server *Server) rename(ctx *gin.Context) {
	var input renameInput = renameInput{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	var oldPath string
	oldPath, err = remote.CleanPath(input.Path)
	if err != nil || oldPath == "/" {
		badRequest(ctx, "路径不合法")
		return
	}
	var name string
	name, err = remote.CleanName(input.NewName)
	if err != nil {
		badRequest(ctx, "名称不能为空,也不能包含 /")
		return
	}
	var conn *remote.Conn
	var release func()
	var valid bool
	conn, release, valid = server.conn(ctx)
	if !valid {
		return
	}
	defer release()
	var newPath string = path.Join(path.Dir(oldPath), name)
	if newPath == oldPath {
		ctx.JSON(http.StatusOK, gin.H{"path": newPath})
		return
	}
	err = conn.Rename(oldPath, newPath)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"path": newPath})
}

type pathsInput struct {
	Paths     []string `json:"paths"`
	Mode      string   `json:"mode"`
	Owner     string   `json:"owner"`
	Group     string   `json:"group"`
	Recursive bool     `json:"recursive"`
}

// bindPaths 解析并校验请求里的 paths,同时拿到连接
func (server *Server) bindPaths(ctx *gin.Context) (pathsInput, *remote.Conn, func(), bool) {
	var input pathsInput = pathsInput{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return input, nil, nil, false
	}
	var valid bool
	input.Paths, valid = cleanPaths(ctx, input.Paths)
	if !valid {
		return input, nil, nil, false
	}
	var conn *remote.Conn
	var release func()
	conn, release, valid = server.conn(ctx)
	return input, conn, release, valid
}

func (server *Server) deletePaths(ctx *gin.Context) {
	var input, conn, release, valid = server.bindPaths(ctx)
	if !valid {
		return
	}
	defer release()
	var work context.Context
	var cancel context.CancelFunc
	work, cancel = detached(ctx)
	defer cancel()
	var err error = conn.Delete(work, input.Paths)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{})
}

func (server *Server) chmod(ctx *gin.Context) {
	var input, conn, release, valid = server.bindPaths(ctx)
	if !valid {
		return
	}
	defer release()
	var mode uint64
	var err error
	mode, err = strconv.ParseUint(strings.TrimSpace(input.Mode), 8, 32)
	if err != nil || mode > 0o7777 {
		badRequest(ctx, "权限值不合法,应为 0755 这样的八进制数")
		return
	}
	var work context.Context
	var cancel context.CancelFunc
	work, cancel = detached(ctx)
	defer cancel()
	err = conn.Chmod(work, input.Paths, uint32(mode), input.Recursive)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{})
}

func (server *Server) chown(ctx *gin.Context) {
	var input, conn, release, valid = server.bindPaths(ctx)
	if !valid {
		return
	}
	defer release()
	var work context.Context
	var cancel context.CancelFunc
	work, cancel = detached(ctx)
	defer cancel()
	var err error = conn.Chown(work, input.Paths, strings.TrimSpace(input.Owner), strings.TrimSpace(input.Group), input.Recursive)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{})
}

func (server *Server) search(ctx *gin.Context) {
	var dir string
	var valid bool
	dir, valid = queryPath(ctx, "path")
	if !valid {
		return
	}
	var keyword string = strings.TrimSpace(ctx.Query("keyword"))
	if keyword == "" || len(keyword) > 200 {
		badRequest(ctx, "请输入搜索关键字")
		return
	}
	var conn *remote.Conn
	var release func()
	conn, release, valid = server.conn(ctx)
	if !valid {
		return
	}
	defer release()
	var entries []remote.Entry
	var truncated bool
	var err error
	entries, truncated, err = conn.Search(ctx.Request.Context(), dir, keyword)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"entries": entries, "truncated": truncated})
}

func (server *Server) dirSize(ctx *gin.Context) {
	var target string
	var valid bool
	target, valid = queryPath(ctx, "path")
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
	var size int64
	var err error
	size, err = conn.DirSize(ctx.Request.Context(), target)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"size": size})
}
