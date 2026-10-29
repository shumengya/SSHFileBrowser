package api

import "context"
import "errors"
import "net/http"
import "strings"
import "time"

import "github.com/gin-gonic/gin"

import "sshfilebrowser/internal/remote"
import "sshfilebrowser/internal/store"

// hostView 返回给前端的服务器信息,永远不包含密码和私钥
type hostView struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Address       string `json:"address"`
	Port          int    `json:"port"`
	Username      string `json:"username"`
	AuthType      string `json:"authType"`
	HasPassphrase bool   `json:"hasPassphrase"`
	HostKey       string `json:"hostKey"`
	DefaultDir    string `json:"defaultDir"`
	SortOrder     int    `json:"sortOrder"`
}

func toView(host store.Host) hostView {
	return hostView{
		ID:            host.ID,
		Name:          host.Name,
		Address:       host.Address,
		Port:          host.Port,
		Username:      host.Username,
		AuthType:      host.AuthType,
		HasPassphrase: len(host.Passphrase) > 0,
		HostKey:       host.HostKey,
		DefaultDir:    host.DefaultDir,
		SortOrder:     host.SortOrder,
	}
}

// hostForm 新增/编辑表单;编辑时 Secret 留空表示不修改
type hostForm struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	Address    string `json:"address"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	AuthType   string `json:"authType"`
	Secret     string `json:"secret"`
	Passphrase string `json:"passphrase"`
	DefaultDir string `json:"defaultDir"`
	SortOrder  int    `json:"sortOrder"`
}

func (form *hostForm) normalize() error {
	form.Name = strings.TrimSpace(form.Name)
	form.Address = strings.TrimSpace(form.Address)
	form.Username = strings.TrimSpace(form.Username)
	form.DefaultDir = strings.TrimSpace(form.DefaultDir)
	if form.Address == "" || strings.ContainsAny(form.Address, " \t/") {
		return errors.New("请填写正确的服务器地址")
	}
	if form.Port == 0 {
		form.Port = 22
	}
	if form.Port < 1 || form.Port > 65535 {
		return errors.New("端口范围 1~65535")
	}
	if form.Username == "" {
		return errors.New("请填写登录用户名")
	}
	if form.AuthType != store.AuthPassword && form.AuthType != store.AuthKey {
		return errors.New("认证方式只能是密码或密钥")
	}
	if form.DefaultDir != "" && !strings.HasPrefix(form.DefaultDir, "/") {
		return errors.New("默认目录必须是绝对路径")
	}
	if form.Name == "" {
		form.Name = form.Username + "@" + form.Address
	}
	return nil
}

func (server *Server) listHosts(ctx *gin.Context) {
	var hosts []store.Host
	var err error
	hosts, err = server.store.ListHosts()
	if err != nil {
		respondError(ctx, err)
		return
	}
	var views []hostView = make([]hostView, len(hosts))
	var index int
	for index = 0; index < len(hosts); index++ {
		views[index] = toView(hosts[index])
	}
	ctx.JSON(http.StatusOK, views)
}

func bindHostForm(ctx *gin.Context) (hostForm, bool) {
	var form hostForm = hostForm{}
	var err error = ctx.ShouldBindJSON(&form)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return form, false
	}
	err = form.normalize()
	if err != nil {
		badRequest(ctx, err.Error())
		return form, false
	}
	return form, true
}

func (server *Server) createHost(ctx *gin.Context) {
	var form hostForm
	var valid bool
	form, valid = bindHostForm(ctx)
	if !valid {
		return
	}
	if form.Secret == "" {
		badRequest(ctx, "请填写密码或私钥")
		return
	}
	var host store.Host = store.Host{
		Name:       form.Name,
		Address:    form.Address,
		Port:       form.Port,
		Username:   form.Username,
		AuthType:   form.AuthType,
		Secret:     server.box.Seal(form.Secret),
		Passphrase: server.box.Seal(form.Passphrase),
		DefaultDir: form.DefaultDir,
		SortOrder:  form.SortOrder,
	}
	var err error
	host.ID, err = server.store.CreateHost(host)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, toView(host))
}

func (server *Server) updateHost(ctx *gin.Context) {
	var hostID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var form hostForm
	form, valid = bindHostForm(ctx)
	if !valid {
		return
	}
	var host store.Host
	var err error
	host, err = server.store.GetHost(hostID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	if form.AuthType != host.AuthType && form.Secret == "" {
		badRequest(ctx, "切换认证方式后需要重新填写密码或私钥")
		return
	}
	// 换了地址或端口就是另一台机器了,旧指纹作废
	var resetKey bool = form.Address != host.Address || form.Port != host.Port
	if form.Secret != "" {
		host.Secret = server.box.Seal(form.Secret)
		// 换了私钥,口令跟着换(留空就是没有口令)
		host.Passphrase = server.box.Seal(form.Passphrase)
	}
	if form.Secret == "" && form.Passphrase != "" {
		host.Passphrase = server.box.Seal(form.Passphrase)
	}
	if form.AuthType == store.AuthPassword {
		host.Passphrase = nil
	}
	host.Name = form.Name
	host.Address = form.Address
	host.Port = form.Port
	host.Username = form.Username
	host.AuthType = form.AuthType
	host.DefaultDir = form.DefaultDir
	host.SortOrder = form.SortOrder
	err = server.store.UpdateHost(host, resetKey)
	if err != nil {
		respondError(ctx, err)
		return
	}
	server.pool.Forget(hostID)
	if resetKey {
		host.HostKey = ""
	}
	ctx.JSON(http.StatusOK, toView(host))
}

func (server *Server) deleteHost(ctx *gin.Context) {
	var hostID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var err error = server.store.DeleteHost(hostID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	server.pool.Forget(hostID)
	ctx.JSON(http.StatusOK, gin.H{})
}

// testHost 用表单参数试连;编辑已有服务器时没填的密码从库里取
func (server *Server) testHost(ctx *gin.Context) {
	var form hostForm
	var valid bool
	form, valid = bindHostForm(ctx)
	if !valid {
		return
	}
	var options remote.DialOptions = remote.DialOptions{
		Address:    form.Address,
		Port:       form.Port,
		Username:   form.Username,
		AuthType:   form.AuthType,
		Password:   form.Secret,
		Passphrase: form.Passphrase,
	}
	var err error
	if form.ID > 0 && form.Secret == "" {
		var host store.Host
		host, err = server.store.GetHost(form.ID)
		if err != nil {
			respondError(ctx, err)
			return
		}
		options.Password, err = server.box.Open(host.Secret)
		if err == nil && form.Passphrase == "" {
			options.Passphrase, err = server.box.Open(host.Passphrase)
		}
		if err != nil {
			respondError(ctx, err)
			return
		}
	}
	if options.Password == "" {
		badRequest(ctx, "请填写密码或私钥")
		return
	}
	var dialCtx context.Context
	var cancel context.CancelFunc
	dialCtx, cancel = context.WithTimeout(ctx.Request.Context(), 25*time.Second)
	defer cancel()
	var info remote.Info
	info, err = server.pool.Test(dialCtx, options)
	if err != nil {
		badRequest(ctx, "连接失败:"+err.Error())
		return
	}
	ctx.JSON(http.StatusOK, info)
}

// connectHost 打开标签页时调用:建立(或复用)连接,返回主目录和服务器能力
func (server *Server) connectHost(ctx *gin.Context) {
	var hostID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var conn *remote.Conn
	var release func()
	var err error
	conn, release, err = server.pool.Get(ctx.Request.Context(), hostID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	defer release()
	// 连接之后再读配置,首次连接时才能拿到刚记下的指纹
	var host store.Host
	host, err = server.store.GetHost(hostID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"info": conn.Info(), "host": toView(host)})
}

type trustInput struct {
	Fingerprint string `json:"fingerprint"`
}

// trustHost 用户确认新指纹后才更新;要求带上看到的指纹,防止确认的和实际连上的不是同一个
func (server *Server) trustHost(ctx *gin.Context) {
	var hostID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var input trustInput = trustInput{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil || !strings.HasPrefix(input.Fingerprint, "SHA256:") {
		badRequest(ctx, "缺少指纹")
		return
	}
	err = server.store.SetHostKey(hostID, input.Fingerprint)
	if err != nil {
		respondError(ctx, err)
		return
	}
	server.pool.Forget(hostID)
	ctx.JSON(http.StatusOK, gin.H{})
}
