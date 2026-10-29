package main

import "bufio"
import "errors"
import "fmt"
import "os"
import "strings"

import "golang.org/x/crypto/bcrypt"
import "golang.org/x/term"

import "sshfilebrowser/internal/config"
import "sshfilebrowser/internal/store"
import "sshfilebrowser/internal/xio"

// version 由 build.cmd 通过 -ldflags "-X main.version=..." 注入
var version string = "dev"

const usage string = `用法:
  sshfilebrowser                  启动服务(默认)
  sshfilebrowser reset-password   忘记管理员密码时在本机重置
  sshfilebrowser version          显示版本`

// runCommand 处理命令行子命令;返回 false 表示没有子命令,照常启动服务
func runCommand(args []string) (bool, error) {
	if len(args) == 0 {
		return false, nil
	}
	if args[0] == "version" || args[0] == "-v" || args[0] == "--version" {
		fmt.Println("sshfilebrowser", version)
		return true, nil
	}
	if args[0] == "reset-password" {
		return true, resetPassword()
	}
	if args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Println(usage)
		return true, nil
	}
	return true, fmt.Errorf("未知命令 %s\n%s", args[0], usage)
}

// resetPassword 只能在服务器本机执行,能读写数据目录就说明有权限,不再校验旧密码
func resetPassword() error {
	var cfg config.Config = config.Load()
	// 不自动创建:目录不存在多半是在错误的位置运行了命令
	var _, statErr = os.Stat(cfg.DataDir)
	if errors.Is(statErr, os.ErrNotExist) {
		return fmt.Errorf("数据目录 %s 不存在:请在 sshfilebrowser.exe 所在目录运行,或用 SFB_DATA_DIR 指定", cfg.DataDir)
	}
	var database *store.Store
	var err error
	database, err = store.Open(cfg.DataDir)
	if err != nil {
		return err
	}
	defer xio.Close(database, "数据库")
	var reader *bufio.Reader = bufio.NewReader(os.Stdin)
	fmt.Printf("数据目录: %s\n用户名: ", cfg.DataDir)
	var username string
	username, err = reader.ReadString('\n')
	if err != nil {
		return fmt.Errorf("读取用户名: %w", err)
	}
	var user store.User
	user, err = database.FindUserByName(strings.TrimSpace(username))
	if errors.Is(err, store.ErrNotFound) {
		return errors.New("没有这个用户(用户名区分大小写)")
	}
	if err != nil {
		return err
	}
	var password string
	password, err = readSecret("新密码(至少 8 位): ")
	if err != nil {
		return err
	}
	if len(password) < 8 || len(password) > 72 {
		return errors.New("密码需要 8~72 个字符")
	}
	var confirm string
	confirm, err = readSecret("再输入一次: ")
	if err != nil {
		return err
	}
	if confirm != password {
		return errors.New("两次输入不一致")
	}
	var hash []byte
	hash, err = bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("计算密码哈希: %w", err)
	}
	err = database.UpdatePassword(user.ID, string(hash))
	if err != nil {
		return fmt.Errorf("保存密码: %w", err)
	}
	// 已登录的浏览器全部失效,必须用新密码重新登录
	err = database.DeleteUserSessions(user.ID)
	if err != nil {
		return err
	}
	fmt.Println("密码已重置,所有已登录的会话已失效。")
	return nil
}

// readSecret 输入时不回显
func readSecret(prompt string) (string, error) {
	fmt.Print(prompt)
	var secretBytes []byte
	var err error
	secretBytes, err = term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Println()
	if err != nil {
		return "", fmt.Errorf("读取密码(请在命令行窗口里运行): %w", err)
	}
	return string(secretBytes), nil
}
