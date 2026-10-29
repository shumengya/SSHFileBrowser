package remote

import "archive/zip"
import "bytes"
import "context"
import "crypto/ed25519"
import "crypto/rand"
import "errors"
import "io"
import "log"
import "net"
import "slices"
import "testing"

import "github.com/pkg/sftp"
import "golang.org/x/crypto/ssh"

import "sshfilebrowser/internal/xio"

const testPassword string = "secret-pass"

// startServer 起一个进程内 SSH 服务器,SFTP 用内存文件系统;拒绝 exec,模拟"没有 shell"的服务器
func startServer(test *testing.T) (string, int) {
	var _, privateKey, err = ed25519.GenerateKey(rand.Reader)
	if err != nil {
		test.Fatal(err)
	}
	var signer ssh.Signer
	signer, err = ssh.NewSignerFromKey(privateKey)
	if err != nil {
		test.Fatal(err)
	}
	var config *ssh.ServerConfig = &ssh.ServerConfig{
		PasswordCallback: func(meta ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			if string(password) == testPassword {
				return nil, nil
			}
			return nil, errors.New("密码错误")
		},
	}
	config.AddHostKey(signer)
	var listener net.Listener
	listener, err = net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		test.Fatal(err)
	}
	test.Cleanup(func() {
		var closeErr error = listener.Close()
		if closeErr != nil {
			test.Log(closeErr)
		}
	})
	var handlers sftp.Handlers = sftp.InMemHandler()
	go func() {
		for {
			var raw net.Conn
			var acceptErr error
			raw, acceptErr = listener.Accept()
			if acceptErr != nil {
				return
			}
			go serveConn(raw, config, handlers)
		}
	}()
	var address, isTCP = listener.Addr().(*net.TCPAddr)
	if !isTCP {
		test.Fatal("监听地址不是 TCP")
	}
	return "127.0.0.1", address.Port
}

func logErr(what string, err error) {
	if err != nil && !errors.Is(err, net.ErrClosed) {
		log.Printf("测试服务器 %s: %v", what, err)
	}
}

func serveConn(raw net.Conn, config *ssh.ServerConfig, handlers sftp.Handlers) {
	var _, channels, requests, err = ssh.NewServerConn(raw, config)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(requests)
	for {
		var newChannel, open = <-channels
		if !open {
			return
		}
		if newChannel.ChannelType() != "session" {
			logErr("拒绝通道", newChannel.Reject(ssh.UnknownChannelType, "只支持 session"))
			continue
		}
		var channel ssh.Channel
		var sessionRequests <-chan *ssh.Request
		channel, sessionRequests, err = newChannel.Accept()
		if err != nil {
			continue
		}
		go serveSession(channel, sessionRequests, handlers)
	}
}

// serveSession 只接受 sftp 子系统;exec 一律拒绝,探测会判定为"没有 shell"
func serveSession(channel ssh.Channel, requests <-chan *ssh.Request, handlers sftp.Handlers) {
	for {
		var request, open = <-requests
		if !open {
			return
		}
		var isSFTP bool = request.Type == "subsystem" && len(request.Payload) > 4 && string(request.Payload[4:]) == "sftp"
		logErr("回复请求", request.Reply(isSFTP, nil))
		if !isSFTP {
			logErr("关闭会话", channel.Close())
			continue
		}
		go func() {
			var server *sftp.RequestServer = sftp.NewRequestServer(channel, handlers)
			var serveErr error = server.Serve()
			if !errors.Is(serveErr, io.EOF) {
				logErr("SFTP", serveErr)
			}
			logErr("关闭 SFTP", server.Close())
		}()
	}
}

func dialTest(test *testing.T, address string, port int, password string) (*Conn, error) {
	return Dial(context.Background(), DialOptions{
		Address:  address,
		Port:     port,
		Username: "tester",
		AuthType: "password",
		Password: password,
	})
}

func names(entries []Entry) []string {
	var result []string = make([]string, len(entries))
	var index int
	for index = 0; index < len(entries); index++ {
		result[index] = entries[index].Name
	}
	slices.Sort(result)
	return result
}

func mustList(test *testing.T, conn *Conn, dir string) []string {
	var entries []Entry
	var err error
	entries, err = conn.List(dir)
	if err != nil {
		test.Fatalf("列目录 %s: %v", dir, err)
	}
	return names(entries)
}

func check(test *testing.T, what string, err error) {
	if err != nil {
		test.Fatalf("%s: %v", what, err)
	}
}

func TestDialRejectsWrongPassword(test *testing.T) {
	var address, port = startServer(test)
	var _, err = dialTest(test, address, port, "wrong")
	if err == nil {
		test.Fatal("错误密码居然连上了")
	}
}

func TestFileOperations(test *testing.T) {
	var address, port = startServer(test)
	var conn, err = dialTest(test, address, port, testPassword)
	check(test, "连接", err)
	defer xio.Close(conn, "测试连接")
	if conn.Info().HasShell {
		test.Fatal("测试服务器不支持 exec,应判定为没有 shell")
	}
	if conn.Info().HostKey == "" {
		test.Fatal("没有拿到主机指纹")
	}
	var ctx context.Context = context.Background()
	check(test, "新建文件夹", conn.Mkdir("/work"))
	if !errors.Is(conn.Mkdir("/work"), ErrExists) {
		test.Fatal("重复新建文件夹应返回 ErrExists")
	}
	check(test, "写文件", conn.WriteText("/work/a.txt", "你好\nhello"))
	var content string
	content, err = conn.ReadText("/work/a.txt", 1<<20)
	check(test, "读文件", err)
	if content != "你好\nhello" {
		test.Fatalf("读回内容不对: %q", content)
	}
	check(test, "写二进制", conn.WriteText("/work/bin.dat", "a\x00b"))
	_, err = conn.ReadText("/work/bin.dat", 1<<20)
	if !errors.Is(err, ErrBinary) {
		test.Fatalf("二进制文件应返回 ErrBinary, 实际 %v", err)
	}
	check(test, "新建空文件", conn.Touch("/work/empty.txt"))
	check(test, "重命名", conn.Rename("/work/empty.txt", "/work/b.txt"))
	if !errors.Is(conn.Rename("/work/b.txt", "/work/a.txt"), ErrExists) {
		test.Fatal("重命名到已存在的名字应返回 ErrExists")
	}
	check(test, "子目录", conn.Mkdir("/work/sub"))
	check(test, "子目录文件", conn.WriteText("/work/sub/c.txt", "ccc"))

	// 同目录复制:自动生成副本名
	var progress []float64 = []float64{}
	var report Progress = func(fraction float64, message string) { progress = append(progress, fraction) }
	var copyHere *Transfer = &Transfer{Source: conn, Target: conn, Paths: []string{"/work/a.txt"}, TargetDir: "/work", Conflict: ConflictSkip, Report: report}
	check(test, "同目录复制", copyHere.Run(ctx))
	if !slices.Contains(mustList(test, conn, "/work"), "a - 副本.txt") {
		test.Fatalf("没有生成副本: %v", mustList(test, conn, "/work"))
	}
	if progress[len(progress)-1] != 1 {
		test.Fatal("进度最后应为 1")
	}

	// 跨服务器(另一条连接)复制文件夹,再移动回来
	var other *Conn
	other, err = dialTest(test, address, port, testPassword)
	check(test, "第二条连接", err)
	defer xio.Close(other, "测试连接")
	check(test, "目标目录", other.Mkdir("/dest"))
	var cross *Transfer = &Transfer{Source: conn, Target: other, Paths: []string{"/work/sub", "/work/a.txt"}, TargetDir: "/dest", Conflict: ConflictSkip, Report: report}
	check(test, "跨服务器复制", cross.Run(ctx))
	content, err = other.ReadText("/dest/sub/c.txt", 1<<20)
	check(test, "读复制过去的文件", err)
	if content != "ccc" {
		test.Fatalf("复制后内容不对: %q", content)
	}
	// 再复制一次,冲突时保留两者
	cross.Conflict = ConflictRename
	check(test, "冲突时保留两者", cross.Run(ctx))
	if !slices.Contains(mustList(test, other, "/dest"), "sub - 副本") {
		test.Fatalf("冲突重命名失败: %v", mustList(test, other, "/dest"))
	}
	var move *Transfer = &Transfer{Source: other, Target: conn, Paths: []string{"/dest/sub - 副本"}, TargetDir: "/work", Move: true, Conflict: ConflictSkip, Report: report}
	check(test, "跨服务器移动", move.Run(ctx))
	if slices.Contains(mustList(test, other, "/dest"), "sub - 副本") {
		test.Fatal("移动后源文件还在")
	}
	var intoSelf *Transfer = &Transfer{Source: conn, Target: conn, Paths: []string{"/work"}, TargetDir: "/work/sub", Conflict: ConflictSkip, Report: report}
	if intoSelf.Run(ctx) == nil {
		test.Fatal("把文件夹复制进自己应该报错")
	}

	var found []Entry
	found, _, err = conn.Search(ctx, "/work", "C.TXT")
	check(test, "搜索", err)
	if len(found) != 2 {
		test.Fatalf("应搜到 2 个 c.txt, 实际 %v", names(found))
	}

	var buffer bytes.Buffer
	check(test, "打包下载", conn.ZipTo(ctx, []string{"/work/sub", "/work/a.txt"}, &buffer))
	var reader *zip.Reader
	reader, err = zip.NewReader(bytes.NewReader(buffer.Bytes()), int64(buffer.Len()))
	check(test, "解析 zip", err)
	var zipped []string = []string{}
	var index int
	for index = 0; index < len(reader.File); index++ {
		zipped = append(zipped, reader.File[index].Name)
	}
	if !slices.Contains(zipped, "sub/c.txt") || !slices.Contains(zipped, "a.txt") {
		test.Fatalf("zip 条目不对: %v", zipped)
	}

	if refuseRoot([]string{"/"}) == nil {
		test.Fatal("应该拒绝删除根目录")
	}
	check(test, "删除", conn.Delete(ctx, []string{"/work/sub", "/work/b.txt"}))
	var left []string = mustList(test, conn, "/work")
	if slices.Contains(left, "sub") || slices.Contains(left, "b.txt") {
		test.Fatalf("删除后还在: %v", left)
	}
}

func TestHelpers(test *testing.T) {
	if Quote("it's") != `'it'\''s'` {
		test.Fatal("Quote 转义错误")
	}
	var stem, extension = splitName("site.tar.gz", false)
	if stem != "site" || extension != ".tar.gz" {
		test.Fatalf("splitName: %q %q", stem, extension)
	}
	stem, extension = splitName(".bashrc", false)
	if stem != ".bashrc" || extension != "" {
		test.Fatalf("splitName 隐藏文件: %q %q", stem, extension)
	}
	var _, err = CleanPath("relative/path")
	if !errors.Is(err, ErrBadPath) {
		test.Fatal("相对路径应被拒绝")
	}
	var cleaned string
	cleaned, err = CleanPath("/a/../b//c/")
	if err != nil || cleaned != "/b/c" {
		test.Fatalf("CleanPath: %q %v", cleaned, err)
	}
	if !isInside("/a/b", "/a") || isInside("/ab", "/a") {
		test.Fatal("isInside 判断错误")
	}
}
