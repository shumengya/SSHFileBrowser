package remote

import "bufio"
import "bytes"
import "context"
import "fmt"
import "io"
import "log"
import "strconv"
import "strings"
import "time"

import "golang.org/x/crypto/ssh"

import "sshfilebrowser/internal/xio"

type writerFunc func(chunk []byte) (int, error)

func (write writerFunc) Write(chunk []byte) (int, error) {
	return write(chunk)
}

// Run 用 sh -c 执行脚本,不受用户登录 shell(zsh/fish 等)差异影响。
// ctx 取消时给远端进程发 KILL 并关闭会话。
func (conn *Conn) Run(ctx context.Context, script string, stdout io.Writer) error {
	if !conn.info.HasShell {
		return ErrNoShell
	}
	var session *ssh.Session
	var err error
	session, err = conn.client.NewSession()
	if err != nil {
		return fmt.Errorf("创建 SSH 会话: %w", err)
	}
	defer xio.Close(session, "SSH 会话")
	var stderr bytes.Buffer
	session.Stdout = stdout
	session.Stderr = &stderr
	var finished chan struct{} = make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-ctx.Done():
			var signalErr error = session.Signal(ssh.SIGKILL)
			if signalErr != nil {
				log.Printf("发送 KILL 信号: %v", signalErr)
			}
			xio.Close(session, "SSH 会话")
		case <-finished:
		}
	}()
	err = session.Run("sh -c " + Quote(script))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		var detail string = strings.TrimSpace(stderr.String())
		if len(detail) > 500 {
			detail = detail[:500] + "…"
		}
		if detail == "" {
			return fmt.Errorf("执行命令: %w", err)
		}
		return fmt.Errorf("执行命令: %s", detail)
	}
	return nil
}

// Output 执行并返回标准输出
func (conn *Conn) Output(ctx context.Context, script string) (string, error) {
	var stdout bytes.Buffer
	var err error = conn.Run(ctx, script, &stdout)
	return stdout.String(), err
}

// RunLines 逐行回调输出;rsync 进度用 \r 刷新,所以 \r 也当换行处理
func (conn *Conn) RunLines(ctx context.Context, script string, onLine func(line string)) error {
	var pending []byte = nil
	var writer writerFunc = func(chunk []byte) (int, error) {
		pending = append(pending, chunk...)
		for {
			var cut int = bytes.IndexAny(pending, "\r\n")
			if cut < 0 {
				break
			}
			var line string = strings.TrimSpace(string(pending[:cut]))
			pending = pending[cut+1:]
			if line != "" {
				onLine(line)
			}
		}
		return len(chunk), nil
	}
	return conn.Run(ctx, script, writer)
}

const probeScript string = `for tool in rsync zip unzip tar gzip bzip2 xz du find; do
  if command -v "$tool" >/dev/null 2>&1; then echo "tool:$tool"; fi
done
echo probe-ok`

// probe 探测 shell 与常用命令;Windows OpenSSH 等没有 sh 的服务器会失败,只用纯 SFTP 功能
func (conn *Conn) probe() {
	var home string
	var err error
	home, err = conn.sftp.Getwd()
	if err != nil || !strings.HasPrefix(home, "/") {
		home = "/"
	}
	conn.info.Home = home
	conn.info.Tools = map[string]bool{}
	conn.info.HasShell = true
	var ctx context.Context
	var cancel context.CancelFunc
	ctx, cancel = context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var output string
	output, err = conn.Output(ctx, probeScript)
	if err != nil || !strings.Contains(output, "probe-ok") {
		conn.info.HasShell = false
		return
	}
	var lines []string = strings.Split(output, "\n")
	var index int
	for index = 0; index < len(lines); index++ {
		var line string = strings.TrimSpace(lines[index])
		if strings.HasPrefix(line, "tool:") {
			conn.info.Tools[strings.TrimPrefix(line, "tool:")] = true
		}
	}
}

func (conn *Conn) hasTool(name string) bool {
	return conn.info.HasShell && conn.info.Tools[name]
}

// loadAccounts 通过 SFTP 读 /etc/passwd 和 /etc/group,把 uid/gid 翻译成名字;读不到就显示数字
func (conn *Conn) loadAccounts() {
	conn.accountOnce.Do(func() {
		conn.users = conn.readIDFile("/etc/passwd")
		conn.groups = conn.readIDFile("/etc/group")
	})
}

func (conn *Conn) readIDFile(filePath string) map[uint32]string {
	var names map[uint32]string = map[uint32]string{}
	var file io.ReadCloser
	var err error
	file, err = conn.sftp.Open(filePath)
	if err != nil {
		return names
	}
	defer xio.Close(file, filePath)
	var scanner *bufio.Scanner = bufio.NewScanner(io.LimitReader(file, 4<<20))
	for scanner.Scan() {
		// 格式: name:x:id:...
		var fields []string = strings.SplitN(scanner.Text(), ":", 4)
		if len(fields) < 3 {
			continue
		}
		var number uint64
		number, err = strconv.ParseUint(fields[2], 10, 32)
		if err != nil {
			continue
		}
		names[uint32(number)] = fields[0]
	}
	return names
}

func (conn *Conn) ownerNames(uid uint32, gid uint32) (string, string) {
	conn.loadAccounts()
	var owner string = conn.users[uid]
	if owner == "" {
		owner = strconv.FormatUint(uint64(uid), 10)
	}
	var group string = conn.groups[gid]
	if group == "" {
		group = strconv.FormatUint(uint64(gid), 10)
	}
	return owner, group
}
