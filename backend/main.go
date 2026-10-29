package main

import "bufio"
import "bytes"
import "context"
import "errors"
import "fmt"
import "io"
import "log"
import "net"
import "net/http"
import "os"
import "os/exec"
import "os/signal"
import "runtime"
import "syscall"
import "time"

import "sshfilebrowser/internal/api"
import "sshfilebrowser/internal/config"
import "sshfilebrowser/internal/remote"
import "sshfilebrowser/internal/secret"
import "sshfilebrowser/internal/store"
import "sshfilebrowser/internal/task"
import "sshfilebrowser/internal/xio"

func main() {
	var handled, err = runCommand(os.Args[1:])
	if handled {
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	err = run()
	if err == nil {
		return
	}
	log.Printf("启动失败: %v", err)
	// 双击运行时控制台出错会一闪而过,停一下让用户看到原因
	if runtime.GOOS == "windows" {
		fmt.Println("按回车键退出…")
		var _, readErr = bufio.NewReader(os.Stdin).ReadString('\n')
		if readErr != nil {
			log.Printf("读取输入: %v", readErr)
		}
	}
	os.Exit(1)
}

func run() error {
	var cfg config.Config = config.Load()
	var address string = browserURL(cfg.Listen)
	// 先占端口:重复双击时直接打开已在运行的那个,不会去抢数据库
	var listener net.Listener
	var err error
	listener, err = net.Listen("tcp", cfg.Listen)
	if err != nil {
		if alreadyRunning(address) {
			log.Printf("SSH 文件管理器已经在运行: %s", address)
			if cfg.OpenBrowser {
				openBrowser(address)
			}
			return nil
		}
		return fmt.Errorf("监听 %s(端口被其它程序占用,可用环境变量 SFB_LISTEN 换一个): %w", cfg.Listen, err)
	}
	defer xio.Close(listener, "监听端口")
	err = os.MkdirAll(cfg.DataDir, 0o700)
	if err != nil {
		return fmt.Errorf("创建数据目录: %w", err)
	}
	var box *secret.Box
	box, err = secret.Open(cfg.DataDir, cfg.SecretKey)
	if err != nil {
		return err
	}
	var database *store.Store
	database, err = store.Open(cfg.DataDir)
	if err != nil {
		return err
	}
	defer xio.Close(database, "数据库")
	var pool *remote.Pool = remote.NewPool(database, box)
	defer pool.Close()
	var server *api.Server
	server, err = api.NewServer(cfg, database, box, pool, task.NewManager())
	if err != nil {
		return err
	}
	var httpServer *http.Server = &http.Server{
		Handler:           server.Handler(),
		ReadHeaderTimeout: 15 * time.Second,
	}
	var ctx context.Context
	var stop context.CancelFunc
	ctx, stop = signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go purgeSessions(ctx, database)
	var serveErr chan error = make(chan error, 1)
	go func() {
		serveErr <- httpServer.Serve(listener)
	}()
	log.Printf("SSH 文件管理器 %s 已启动: %s", version, address)
	log.Printf("数据目录 %s;关闭此窗口即退出", cfg.DataDir)
	if cfg.OpenBrowser {
		openBrowser(address)
	}
	select {
	case err = <-serveErr:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}
	log.Printf("正在退出…")
	var shutdownCtx context.Context
	var cancel context.CancelFunc
	shutdownCtx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

// alreadyRunning 端口被占用时探测一下,是不是自己的另一个实例
func alreadyRunning(address string) bool {
	var client *http.Client = &http.Client{Timeout: 2 * time.Second}
	var response *http.Response
	var err error
	response, err = client.Get(address + "/api/auth/status")
	if err != nil {
		return false
	}
	defer xio.Close(response.Body, "响应")
	var body []byte
	body, err = io.ReadAll(io.LimitReader(response.Body, 4096))
	if err != nil {
		return false
	}
	return response.StatusCode == http.StatusOK && bytes.Contains(body, []byte(`"initialized"`))
}

// purgeSessions 启动时和之后每小时清一次过期会话,长期运行时表不会越来越大
func purgeSessions(ctx context.Context, database *store.Store) {
	var ticker *time.Ticker = time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		var err error = database.PurgeExpiredSessions()
		if err != nil {
			log.Printf("%v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// browserURL 监听 0.0.0.0 或只写了端口时,浏览器访问本机回环地址
func browserURL(listen string) string {
	var host, port, err = net.SplitHostPort(listen)
	if err != nil {
		return "http://" + listen
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

func openBrowser(address string) {
	var command *exec.Cmd = exec.Command("xdg-open", address)
	if runtime.GOOS == "windows" {
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", address)
	}
	if runtime.GOOS == "darwin" {
		command = exec.Command("open", address)
	}
	var err error = command.Start()
	if err != nil {
		log.Printf("打开浏览器失败,请手动访问 %s: %v", address, err)
		return
	}
	go func() {
		var waitErr error = command.Wait()
		if waitErr != nil {
			log.Printf("浏览器启动程序退出: %v", waitErr)
		}
	}()
}
