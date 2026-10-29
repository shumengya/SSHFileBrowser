package api

import "encoding/hex"
import "errors"
import "net/http"
import "strings"
import "sync"
import "time"
import "unicode/utf8"

import "github.com/gin-gonic/gin"
import "golang.org/x/crypto/bcrypt"

import "sshfilebrowser/internal/secret"
import "sshfilebrowser/internal/store"

const sessionCookie string = "sfb_session"
const sessionTTL time.Duration = 7 * 24 * time.Hour

// 用户不存在时也比对一次哈希,登录耗时一致,不暴露用户名是否存在
var dummyHash []byte = mustHash("sshfilebrowser-dummy-password")

var setupMutex sync.Mutex

func mustHash(password string) []byte {
	var hash []byte
	var err error
	hash, err = bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	return hash
}

// requireCSRFHeader:改数据的请求必须带自定义头。跨站页面带不上这个头(会触发 CORS 预检,而我们不开 CORS)
func requireCSRFHeader(ctx *gin.Context) {
	var method string = ctx.Request.Method
	if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
		return
	}
	if ctx.GetHeader("X-Requested-With") != "sshfilebrowser" {
		ctx.AbortWithStatusJSON(http.StatusForbidden, errorBody{Code: "CSRF", Message: "缺少请求头"})
	}
}

func (server *Server) requireAuth(ctx *gin.Context) {
	var token string
	var err error
	token, err = ctx.Cookie(sessionCookie)
	if err != nil || token == "" {
		ctx.AbortWithStatusJSON(http.StatusUnauthorized, errorBody{Code: "UNAUTHORIZED", Message: "请先登录"})
		return
	}
	var user store.User
	user, err = server.store.FindSessionUser(token)
	if err != nil {
		ctx.AbortWithStatusJSON(http.StatusUnauthorized, errorBody{Code: "UNAUTHORIZED", Message: "登录已过期"})
		return
	}
	ctx.Set("user", user)
	ctx.Set("token", token)
}

func currentUser(ctx *gin.Context) store.User {
	var value any = ctx.MustGet("user")
	var user, isUser = value.(store.User)
	if !isUser {
		panic("上下文里没有用户")
	}
	return user
}

func (server *Server) authStatus(ctx *gin.Context) {
	var count int
	var err error
	count, err = server.store.CountUsers()
	if err != nil {
		respondError(ctx, err)
		return
	}
	var username string = ""
	var token string
	token, err = ctx.Cookie(sessionCookie)
	if err == nil && token != "" {
		var user store.User
		user, err = server.store.FindSessionUser(token)
		if err == nil {
			username = user.Username
		}
	}
	ctx.JSON(http.StatusOK, gin.H{"initialized": count > 0, "username": username})
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func validateCredentials(input credentials) error {
	var length int = utf8.RuneCountInString(input.Username)
	if length < 3 || length > 32 || strings.ContainsAny(input.Username, " \t\r\n") {
		return errors.New("用户名需要 3~32 个字符,不能有空格")
	}
	if len(input.Password) < 8 || len(input.Password) > 72 {
		return errors.New("密码需要 8~72 个字符")
	}
	return nil
}

// setup 只有在还没有任何用户时可用,用来创建第一个管理员
func (server *Server) setup(ctx *gin.Context) {
	setupMutex.Lock()
	defer setupMutex.Unlock()
	var input credentials = credentials{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	var count int
	count, err = server.store.CountUsers()
	if err != nil {
		respondError(ctx, err)
		return
	}
	if count > 0 {
		ctx.AbortWithStatusJSON(http.StatusForbidden, errorBody{Code: "INITIALIZED", Message: "已经初始化过了"})
		return
	}
	err = validateCredentials(input)
	if err != nil {
		badRequest(ctx, err.Error())
		return
	}
	var hash []byte
	hash, err = bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		respondError(ctx, err)
		return
	}
	var userID int64
	userID, err = server.store.CreateUser(input.Username, string(hash))
	if err != nil {
		respondError(ctx, err)
		return
	}
	server.startSession(ctx, userID, input.Username)
}

func (server *Server) login(ctx *gin.Context) {
	var input credentials = credentials{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	var clientKey string = ctx.ClientIP()
	if server.limiter.blocked(clientKey) {
		ctx.AbortWithStatusJSON(http.StatusTooManyRequests, errorBody{Code: "RATE_LIMITED", Message: "失败次数过多,请 15 分钟后再试"})
		return
	}
	var user store.User
	user, err = server.store.FindUserByName(input.Username)
	var hash []byte = dummyHash
	if err == nil {
		hash = []byte(user.PasswordHash)
	}
	var compareErr error = bcrypt.CompareHashAndPassword(hash, []byte(input.Password))
	if err != nil || compareErr != nil {
		server.limiter.fail(clientKey)
		ctx.AbortWithStatusJSON(http.StatusUnauthorized, errorBody{Code: "BAD_CREDENTIALS", Message: "用户名或密码错误"})
		return
	}
	server.limiter.reset(clientKey)
	server.startSession(ctx, user.ID, user.Username)
}

func (server *Server) startSession(ctx *gin.Context, userID int64, username string) {
	var token string = hex.EncodeToString(secret.RandomBytes(32))
	var expires time.Time = time.Now().Add(sessionTTL)
	var err error = server.store.CreateSession(token, userID, expires)
	if err != nil {
		respondError(ctx, err)
		return
	}
	server.setCookie(ctx, token, expires)
	ctx.JSON(http.StatusOK, gin.H{"username": username})
}

func (server *Server) setCookie(ctx *gin.Context, token string, expires time.Time) {
	var maxAge int = int(time.Until(expires).Seconds())
	if token == "" {
		maxAge = -1
	}
	http.SetCookie(ctx.Writer, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   server.config.SecureCookie,
		SameSite: http.SameSiteLaxMode,
	})
}

func (server *Server) logout(ctx *gin.Context) {
	var err error = server.store.DeleteSession(ctx.GetString("token"))
	if err != nil {
		respondError(ctx, err)
		return
	}
	server.setCookie(ctx, "", time.Time{})
	ctx.JSON(http.StatusOK, gin.H{})
}

type passwordChange struct {
	OldPassword string `json:"oldPassword"`
	NewPassword string `json:"newPassword"`
}

// changePassword 改完密码踢掉所有会话,再给当前浏览器发一个新的
func (server *Server) changePassword(ctx *gin.Context) {
	var input passwordChange = passwordChange{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	var user store.User = currentUser(ctx)
	err = bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.OldPassword))
	if err != nil {
		badRequest(ctx, "原密码错误")
		return
	}
	err = validateCredentials(credentials{Username: user.Username, Password: input.NewPassword})
	if err != nil {
		badRequest(ctx, err.Error())
		return
	}
	var hash []byte
	hash, err = bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		respondError(ctx, err)
		return
	}
	err = server.store.UpdatePassword(user.ID, string(hash))
	if err != nil {
		respondError(ctx, err)
		return
	}
	err = server.store.DeleteUserSessions(user.ID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	server.startSession(ctx, user.ID, user.Username)
}
