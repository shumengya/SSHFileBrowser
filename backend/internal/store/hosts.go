package store

import "database/sql"
import "errors"
import "fmt"
import "time"

import "sshfilebrowser/internal/xio"

const AuthPassword string = "password"
const AuthKey string = "key"

// Host 里的 Secret / Passphrase 是密文,解密交给 secret.Box
type Host struct {
	ID         int64
	Name       string
	Address    string
	Port       int
	Username   string
	AuthType   string
	Secret     []byte
	Passphrase []byte
	HostKey    string // 首次连接记下的 SHA256 指纹(TOFU)
	DefaultDir string
	SortOrder  int
}

const hostColumns string = `id, name, address, port, username, auth_type, secret, passphrase, host_key, default_dir, sort_order`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanHost(row rowScanner) (Host, error) {
	var host Host = Host{}
	var err error = row.Scan(
		&host.ID,
		&host.Name,
		&host.Address,
		&host.Port,
		&host.Username,
		&host.AuthType,
		&host.Secret,
		&host.Passphrase,
		&host.HostKey,
		&host.DefaultDir,
		&host.SortOrder,
	)
	return host, err
}

func (store *Store) ListHosts() ([]Host, error) {
	var rows *sql.Rows
	var err error
	rows, err = store.database.Query(`SELECT ` + hostColumns + ` FROM hosts ORDER BY sort_order, id`)
	if err != nil {
		return nil, fmt.Errorf("查询服务器列表: %w", err)
	}
	defer xio.Close(rows, "查询结果")
	var hosts []Host = []Host{}
	for rows.Next() {
		var host Host
		host, err = scanHost(rows)
		if err != nil {
			return nil, fmt.Errorf("读取服务器: %w", err)
		}
		hosts = append(hosts, host)
	}
	return hosts, rows.Err()
}

func (store *Store) GetHost(hostID int64) (Host, error) {
	var row *sql.Row = store.database.QueryRow(`SELECT `+hostColumns+` FROM hosts WHERE id = ?`, hostID)
	var host Host
	var err error
	host, err = scanHost(row)
	if errors.Is(err, sql.ErrNoRows) {
		return host, ErrNotFound
	}
	if err != nil {
		return host, fmt.Errorf("查询服务器: %w", err)
	}
	return host, nil
}

func (store *Store) CreateHost(host Host) (int64, error) {
	var now int64 = time.Now().Unix()
	var result sql.Result
	var err error
	result, err = store.database.Exec(
		`INSERT INTO hosts (name, address, port, username, auth_type, secret, passphrase, default_dir, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		host.Name,
		host.Address,
		host.Port,
		host.Username,
		host.AuthType,
		host.Secret,
		host.Passphrase,
		host.DefaultDir,
		host.SortOrder,
		now,
		now,
	)
	if err != nil {
		return 0, fmt.Errorf("新增服务器: %w", err)
	}
	return result.LastInsertId()
}

// UpdateHost 会清空已记录的主机指纹:地址变了,旧指纹没有意义
func (store *Store) UpdateHost(host Host, resetHostKey bool) error {
	var result sql.Result
	var err error
	result, err = store.database.Exec(
		`UPDATE hosts SET name = ?, address = ?, port = ?, username = ?, auth_type = ?, secret = ?, passphrase = ?,
		 default_dir = ?, sort_order = ?, host_key = CASE WHEN ? THEN '' ELSE host_key END, updated_at = ?
		 WHERE id = ?`,
		host.Name,
		host.Address,
		host.Port,
		host.Username,
		host.AuthType,
		host.Secret,
		host.Passphrase,
		host.DefaultDir,
		host.SortOrder,
		resetHostKey,
		time.Now().Unix(),
		host.ID,
	)
	return affectedOne(result, err)
}

func (store *Store) SetHostKey(hostID int64, fingerprint string) error {
	var result sql.Result
	var err error
	result, err = store.database.Exec(`UPDATE hosts SET host_key = ? WHERE id = ?`, fingerprint, hostID)
	return affectedOne(result, err)
}

func (store *Store) DeleteHost(hostID int64) error {
	var result sql.Result
	var err error
	result, err = store.database.Exec(`DELETE FROM hosts WHERE id = ?`, hostID)
	return affectedOne(result, err)
}
