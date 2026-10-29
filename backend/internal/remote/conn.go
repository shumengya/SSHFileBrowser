package remote

import "context"
import "crypto/subtle"
import "errors"
import "fmt"
import "log"
import "net"
import "strconv"
import "strings"
import "sync"
import "sync/atomic"
import "time"

import "github.com/pkg/sftp"
import "golang.org/x/crypto/ssh"

import "sshfilebrowser/internal/xio"

var ErrHostKeyMismatch error = errors.New("服务器主机指纹与上次记录不一致,可能存在中间人攻击")

// HostKeyError 带上新指纹,前端展示给用户确认后再信任
type HostKeyError struct {
	Fingerprint string
}

func (hostKeyError *HostKeyError) Error() string {
	return ErrHostKeyMismatch.Error() + "(新指纹 " + hostKeyError.Fingerprint + ")"
}

func (hostKeyError *HostKeyError) Unwrap() error {
	return ErrHostKeyMismatch
}

// Info 是连上之后探测到的服务器能力,前端据此决定按钮是否可用
type Info struct {
	Home     string          `json:"home"`
	HasShell bool            `json:"hasShell"`
	Tools    map[string]bool `json:"tools"`
	HostKey  string          `json:"hostKey"`
}

type Conn struct {
	client   *ssh.Client
	sftp     *sftp.Client
	info     Info
	closed   atomic.Bool
	lastPing atomic.Int64

	accountOnce sync.Once
	users       map[uint32]string
	groups      map[uint32]string
}

type DialOptions struct {
	Address    string
	Port       int
	Username   string
	AuthType   string
	Password   string // 密码登录时是登录密码,密钥登录时是私钥 PEM
	Passphrase string
	HostKey    string // 已信任的指纹,空表示首次连接
}

// Dial 建立 SSH + SFTP。主机指纹不一致时返回 ErrHostKeyMismatch,且不会发送任何凭证。
func Dial(ctx context.Context, options DialOptions) (*Conn, error) {
	var methods []ssh.AuthMethod
	var err error
	methods, err = authMethods(options)
	if err != nil {
		return nil, err
	}
	var seenKey string = ""
	var mismatch bool = false
	var config *ssh.ClientConfig = &ssh.ClientConfig{
		User: options.Username,
		Auth: methods,
		HostKeyCallback: func(hostname string, remote net.Addr, key ssh.PublicKey) error {
			seenKey = ssh.FingerprintSHA256(key)
			if options.HostKey == "" || subtle.ConstantTimeCompare([]byte(seenKey), []byte(options.HostKey)) == 1 {
				return nil
			}
			mismatch = true
			return ErrHostKeyMismatch
		},
		Timeout: 15 * time.Second,
	}
	var address string = net.JoinHostPort(options.Address, strconv.Itoa(options.Port))
	var dialer net.Dialer = net.Dialer{Timeout: 15 * time.Second}
	var raw net.Conn
	raw, err = dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, fmt.Errorf("连接 %s: %w", address, err)
	}
	// 握手阶段对端不说话会一直卡住,给整个握手设个总时限
	err = raw.SetDeadline(time.Now().Add(20 * time.Second))
	if err != nil {
		xio.Close(raw, "TCP 连接")
		return nil, fmt.Errorf("设置超时: %w", err)
	}
	var sshConn ssh.Conn
	var channels <-chan ssh.NewChannel
	var requests <-chan *ssh.Request
	sshConn, channels, requests, err = ssh.NewClientConn(raw, address, config)
	if mismatch {
		xio.Close(raw, "TCP 连接")
		return nil, &HostKeyError{Fingerprint: seenKey}
	}
	if err != nil {
		xio.Close(raw, "TCP 连接")
		// x/crypto 的认证失败有好几种原文(keyboard-interactive 失败时是 unexpected message type 51),统一成人话
		var text string = err.Error()
		if strings.Contains(text, "unable to authenticate") || strings.Contains(text, "unexpected message type 51") {
			return nil, fmt.Errorf("认证失败,请检查用户名和密码/私钥: %w", err)
		}
		return nil, fmt.Errorf("SSH 握手/认证: %w", err)
	}
	err = raw.SetDeadline(time.Time{})
	if err != nil {
		xio.Close(sshConn, "SSH 连接")
		return nil, fmt.Errorf("清除超时: %w", err)
	}
	var client *ssh.Client = ssh.NewClient(sshConn, channels, requests)
	var sftpClient *sftp.Client
	sftpClient, err = sftp.NewClient(
		client,
		sftp.UseConcurrentReads(true),
		sftp.UseConcurrentWrites(true),
		sftp.MaxConcurrentRequestsPerFile(64),
	)
	if err != nil {
		xio.Close(client, "SSH 连接")
		return nil, fmt.Errorf("启动 SFTP 子系统: %w", err)
	}
	var conn *Conn = &Conn{client: client, sftp: sftpClient}
	conn.info.HostKey = seenKey
	conn.lastPing.Store(time.Now().Unix())
	go conn.watch()
	conn.probe()
	return conn, nil
}

func (conn *Conn) watch() {
	var err error = conn.client.Wait()
	conn.closed.Store(true)
	if err != nil && !errors.Is(err, net.ErrClosed) {
		log.Printf("SSH 连接断开: %v", err)
	}
}

func authMethods(options DialOptions) ([]ssh.AuthMethod, error) {
	if options.AuthType == "key" {
		var signer ssh.Signer
		var err error
		signer, err = parseKey(options.Password, options.Passphrase)
		if err != nil {
			return nil, err
		}
		return []ssh.AuthMethod{ssh.PublicKeys(signer)}, nil
	}
	var password string = options.Password
	// 有些服务器只开了 keyboard-interactive,把每个问题都用密码回答
	var interactive ssh.KeyboardInteractiveChallenge = func(name string, instruction string, questions []string, echos []bool) ([]string, error) {
		var answers []string = make([]string, len(questions))
		var index int
		for index = 0; index < len(questions); index++ {
			answers[index] = password
		}
		return answers, nil
	}
	return []ssh.AuthMethod{ssh.Password(password), ssh.KeyboardInteractive(interactive)}, nil
}

func parseKey(pemText string, passphrase string) (ssh.Signer, error) {
	var signer ssh.Signer
	var err error
	if passphrase != "" {
		signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(pemText), []byte(passphrase))
		if err != nil {
			return nil, fmt.Errorf("解析私钥(请检查口令): %w", err)
		}
		return signer, nil
	}
	signer, err = ssh.ParsePrivateKey([]byte(pemText))
	var missing *ssh.PassphraseMissingError
	if errors.As(err, &missing) {
		return nil, errors.New("私钥已加密,请填写私钥口令")
	}
	if err != nil {
		return nil, fmt.Errorf("解析私钥: %w", err)
	}
	return signer, nil
}

func (conn *Conn) Info() Info {
	return conn.info
}

func (conn *Conn) SFTP() *sftp.Client {
	return conn.sftp
}

func (conn *Conn) Close() error {
	conn.closed.Store(true)
	xio.Close(conn.sftp, "SFTP")
	return conn.client.Close()
}

// Alive 30 秒内确认过就直接信任,否则发一次 keepalive,避免每个请求都多一次往返
func (conn *Conn) Alive() bool {
	if conn.closed.Load() {
		return false
	}
	var now int64 = time.Now().Unix()
	if now-conn.lastPing.Load() < 30 {
		return true
	}
	// 半死的 TCP 连接上 SendRequest 可能卡很久,限时 5 秒
	var replied chan error = make(chan error, 1)
	go func() {
		var _, _, err = conn.client.SendRequest("keepalive@openssh.com", true, nil)
		replied <- err
	}()
	var timer *time.Timer = time.NewTimer(5 * time.Second)
	defer timer.Stop()
	var err error
	select {
	case err = <-replied:
		if err != nil {
			return false
		}
	case <-timer.C:
		return false
	}
	conn.lastPing.Store(now)
	return true
}
