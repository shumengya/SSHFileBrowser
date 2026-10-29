package config

import "cmp"
import "os"
import "path/filepath"
import "strings"

// Config 全部来自环境变量;不设置时用适合"双击运行"的默认值。
type Config struct {
	Listen       string // 监听地址,默认只绑本机,公网暴露请放在 HTTPS 反代后面
	DataDir      string // SQLite 与密钥文件所在目录
	SecureCookie bool   // 走 HTTPS 时打开,cookie 加 Secure 标记
	SecretKey    string // 可选:直接给 base64 的 32 字节密钥,不给就自动生成到 DataDir
	OpenBrowser  bool   // 启动后自动打开浏览器
}

func Load() Config {
	var config Config = Config{
		Listen:       cmp.Or(os.Getenv("SFB_LISTEN"), "127.0.0.1:8090"),
		DataDir:      cmp.Or(os.Getenv("SFB_DATA_DIR"), defaultDataDir()),
		SecureCookie: os.Getenv("SFB_SECURE_COOKIE") == "1",
		SecretKey:    os.Getenv("SFB_SECRET_KEY"),
		OpenBrowser:  os.Getenv("SFB_NO_BROWSER") != "1",
	}
	return config
}

// defaultDataDir 数据放在 exe 旁边的 data 目录,和程序一起拷走就能迁移。
// go run 时 exe 在临时目录,每次都会变,改用当前目录。
func defaultDataDir() string {
	var executable string
	var err error
	executable, err = os.Executable()
	if err != nil {
		return "data"
	}
	var dir string = filepath.Dir(executable)
	if strings.HasPrefix(dir, filepath.Clean(os.TempDir())) {
		return "data"
	}
	return filepath.Join(dir, "data")
}
