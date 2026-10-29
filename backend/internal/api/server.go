package api

import "cmp"
import "fmt"
import "io/fs"
import "mime"
import "net/http"
import "os"
import "path"
import "strconv"
import "strings"

import "github.com/gin-gonic/gin"

import "sshfilebrowser/internal/config"
import "sshfilebrowser/internal/remote"
import "sshfilebrowser/internal/secret"
import "sshfilebrowser/internal/store"
import "sshfilebrowser/internal/task"
import "sshfilebrowser/web"

type Server struct {
	config    config.Config
	store     *store.Store
	box       *secret.Box
	pool      *remote.Pool
	tasks     *task.Manager
	limiter   *loginLimiter
	static    fs.FS
	indexHTML []byte
}

func NewServer(cfg config.Config, database *store.Store, box *secret.Box, pool *remote.Pool, tasks *task.Manager) (*Server, error) {
	var static fs.FS
	var err error
	static, err = web.Dist()
	if err != nil {
		return nil, err
	}
	var indexHTML []byte
	indexHTML, err = fs.ReadFile(static, "index.html")
	if err != nil {
		return nil, fmt.Errorf("内嵌前端缺少 index.html,请先构建前端: %w", err)
	}
	return &Server{
		config:    cfg,
		store:     database,
		box:       box,
		pool:      pool,
		tasks:     tasks,
		limiter:   newLoginLimiter(),
		static:    static,
		indexHTML: indexHTML,
	}, nil
}

func (server *Server) Handler() http.Handler {
	gin.SetMode(gin.ReleaseMode)
	var engine *gin.Engine = gin.New()
	// 任务列表每秒轮询一次,不记日志
	engine.Use(gin.LoggerWithConfig(gin.LoggerConfig{SkipPaths: []string{"/api/tasks"}}), gin.Recovery())
	// 默认不信任任何代理头,防止伪造 X-Forwarded-For 绕过登录限流;在反代后面请设置 SFB_TRUSTED_PROXIES
	var trustErr error = engine.SetTrustedProxies(splitList(os.Getenv("SFB_TRUSTED_PROXIES")))
	if trustErr != nil {
		panic(trustErr)
	}

	var apiGroup *gin.RouterGroup = engine.Group("/api", requireCSRFHeader)
	apiGroup.GET("/auth/status", server.authStatus)
	apiGroup.POST("/auth/setup", server.setup)
	apiGroup.POST("/auth/login", server.login)

	var authed *gin.RouterGroup = apiGroup.Group("", server.requireAuth)
	authed.POST("/auth/logout", server.logout)
	authed.POST("/auth/password", server.changePassword)

	authed.GET("/hosts", server.listHosts)
	authed.POST("/hosts", server.createHost)
	authed.POST("/hosts/test", server.testHost)
	authed.PUT("/hosts/:hostId", server.updateHost)
	authed.DELETE("/hosts/:hostId", server.deleteHost)
	authed.POST("/hosts/:hostId/connect", server.connectHost)
	authed.POST("/hosts/:hostId/trust", server.trustHost)
	authed.GET("/hosts/:hostId/bookmarks", server.listBookmarks)
	authed.POST("/hosts/:hostId/bookmarks", server.createBookmark)
	authed.DELETE("/hosts/:hostId/bookmarks/:bookmarkId", server.deleteBookmark)

	var files *gin.RouterGroup = authed.Group("/hosts/:hostId/fs")
	files.GET("/list", server.listDir)
	files.GET("/stat", server.statPath)
	files.GET("/content", server.readContent)
	files.PUT("/content", server.writeContent)
	files.POST("/mkdir", server.mkdir)
	files.POST("/touch", server.touch)
	files.POST("/rename", server.rename)
	files.POST("/delete", server.deletePaths)
	files.POST("/chmod", server.chmod)
	files.POST("/chown", server.chown)
	files.GET("/search", server.search)
	files.GET("/size", server.dirSize)
	files.POST("/upload", server.upload)
	files.GET("/download", server.download)
	files.POST("/paste", server.paste)
	files.POST("/compress", server.compress)
	files.POST("/extract", server.extract)

	authed.GET("/tasks", server.listTasks)
	authed.POST("/tasks/:taskId/cancel", server.cancelTask)
	authed.DELETE("/tasks/:taskId", server.removeTask)
	authed.DELETE("/tasks", server.clearTasks)

	engine.NoRoute(server.serveStatic)
	return engine
}

func splitList(raw string) []string {
	var items []string = []string{}
	var parts []string = strings.Split(raw, ",")
	var index int
	for index = 0; index < len(parts); index++ {
		var item string = strings.TrimSpace(parts[index])
		if item != "" {
			items = append(items, item)
		}
	}
	return items
}

// serveStatic 托管内嵌的前端;找不到的路径回落到 index.html(单页应用)
func (server *Server) serveStatic(ctx *gin.Context) {
	if strings.HasPrefix(ctx.Request.URL.Path, "/api/") {
		ctx.JSON(http.StatusNotFound, errorBody{Code: "NOT_FOUND", Message: "接口不存在"})
		return
	}
	// embed.FS 的路径不带前导 /;path.Clean 保证不会出现 ..
	var name string = strings.TrimPrefix(path.Clean("/"+ctx.Request.URL.Path), "/")
	if name != "" && name != "index.html" {
		var info fs.FileInfo
		var err error
		info, err = fs.Stat(server.static, name)
		if err == nil && !info.IsDir() {
			var content []byte
			content, err = fs.ReadFile(server.static, name)
			if err != nil {
				respondError(ctx, err)
				return
			}
			// 带哈希的静态资源可以长期缓存
			if strings.HasPrefix(name, "assets/") {
				ctx.Header("Cache-Control", "public, max-age=31536000, immutable")
			}
			ctx.Data(http.StatusOK, contentType(name), content)
			return
		}
	}
	ctx.Header("Cache-Control", "no-cache")
	ctx.Data(http.StatusOK, "text/html; charset=utf-8", server.indexHTML)
}

// contentType 常见类型写死:Windows 注册表里的 MIME 映射经常被别的软件改乱(比如 .js 变成 text/plain)
func contentType(name string) string {
	var known map[string]string = map[string]string{
		".js":    "text/javascript; charset=utf-8",
		".css":   "text/css; charset=utf-8",
		".html":  "text/html; charset=utf-8",
		".svg":   "image/svg+xml",
		".json":  "application/json",
		".png":   "image/png",
		".ico":   "image/x-icon",
		".woff2": "font/woff2",
	}
	var extension string = strings.ToLower(path.Ext(name))
	var found string = known[extension]
	if found != "" {
		return found
	}
	return cmp.Or(mime.TypeByExtension(extension), "application/octet-stream")
}

func paramID(ctx *gin.Context, name string) (int64, bool) {
	var value int64
	var err error
	value, err = strconv.ParseInt(ctx.Param(name), 10, 64)
	if err != nil || value <= 0 {
		badRequest(ctx, "参数 "+name+" 不合法")
		return 0, false
	}
	return value, true
}
