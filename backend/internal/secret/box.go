package secret

import "crypto/aes"
import "crypto/cipher"
import "crypto/rand"
import "encoding/base64"
import "errors"
import "fmt"
import "os"
import "path/filepath"
import "strings"

// Box 用 AES-256-GCM 加密存进 SQLite 的 SSH 密码/私钥,数据库单独泄露时拿不到明文。
type Box struct {
	aead cipher.AEAD
}

// Open 优先用环境变量里的密钥,否则读取或生成 DataDir/secret.key。
// 注意:密钥文件丢了,已保存的服务器凭证就全部解不开了。
func Open(dataDir string, encodedKey string) (*Box, error) {
	var key []byte
	var err error
	if encodedKey != "" {
		key, err = base64.StdEncoding.DecodeString(strings.TrimSpace(encodedKey))
		if err != nil {
			return nil, fmt.Errorf("解析 SFB_SECRET_KEY: %w", err)
		}
		return newBox(key)
	}
	var keyPath string = filepath.Join(dataDir, "secret.key")
	var content []byte
	content, err = os.ReadFile(keyPath)
	if err == nil {
		key, err = base64.StdEncoding.DecodeString(strings.TrimSpace(string(content)))
		if err != nil {
			return nil, fmt.Errorf("解析密钥文件: %w", err)
		}
		return newBox(key)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("读取密钥文件: %w", err)
	}
	key = RandomBytes(32)
	var encoded string = base64.StdEncoding.EncodeToString(key)
	err = os.WriteFile(keyPath, []byte(encoded+"\n"), 0o600)
	if err != nil {
		return nil, fmt.Errorf("写入密钥文件: %w", err)
	}
	return newBox(key)
}

func newBox(key []byte) (*Box, error) {
	if len(key) != 32 {
		return nil, errors.New("密钥长度必须是 32 字节")
	}
	var block cipher.Block
	var err error
	block, err = aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("创建 AES: %w", err)
	}
	var aead cipher.AEAD
	aead, err = cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("创建 GCM: %w", err)
	}
	return &Box{aead: aead}, nil
}

// Seal 输出 nonce+密文;空字符串原样返回,表示"没有设置"。
func (box *Box) Seal(plain string) []byte {
	if plain == "" {
		return nil
	}
	var nonce []byte = RandomBytes(box.aead.NonceSize())
	return box.aead.Seal(nonce, nonce, []byte(plain), nil)
}

// RandomBytes 读系统随机源;Go 1.24 起出错会直接崩溃,这里的检查只是兜底。
func RandomBytes(size int) []byte {
	var buffer []byte = make([]byte, size)
	var _, err = rand.Read(buffer)
	if err != nil {
		panic(fmt.Errorf("读取随机数: %w", err))
	}
	return buffer
}

func (box *Box) Open(sealed []byte) (string, error) {
	if len(sealed) == 0 {
		return "", nil
	}
	var size int = box.aead.NonceSize()
	if len(sealed) < size {
		return "", errors.New("密文损坏")
	}
	var plain []byte
	var err error
	plain, err = box.aead.Open(nil, sealed[:size], sealed[size:], nil)
	if err != nil {
		return "", fmt.Errorf("解密凭证(密钥可能已更换): %w", err)
	}
	return string(plain), nil
}
