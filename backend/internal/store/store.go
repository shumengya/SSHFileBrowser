package store

import "database/sql"
import "errors"
import "fmt"
import "path/filepath"

import _ "modernc.org/sqlite"

var ErrNotFound error = errors.New("记录不存在")

type Store struct {
	database *sql.DB
}

const schema string = `
CREATE TABLE IF NOT EXISTS users (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	username      TEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
	token_hash TEXT PRIMARY KEY,
	user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hosts (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	name        TEXT NOT NULL,
	address     TEXT NOT NULL,
	port        INTEGER NOT NULL DEFAULT 22,
	username    TEXT NOT NULL,
	auth_type   TEXT NOT NULL,
	secret      BLOB,
	passphrase  BLOB,
	host_key    TEXT NOT NULL DEFAULT '',
	default_dir TEXT NOT NULL DEFAULT '',
	sort_order  INTEGER NOT NULL DEFAULT 0,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookmarks (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	host_id    INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
	name       TEXT NOT NULL,
	path       TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
`

func Open(dataDir string) (*Store, error) {
	// 用纯 Go 的 modernc 驱动,Windows 上不需要 CGO
	var source string = "file:" + filepath.ToSlash(filepath.Join(dataDir, "sshfilebrowser.db")) +
		"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	var database *sql.DB
	var err error
	database, err = sql.Open("sqlite", source)
	if err != nil {
		return nil, fmt.Errorf("打开数据库: %w", err)
	}
	// SQLite 只有一个写者,单连接最省心,也保证 pragma 对每次查询都生效
	database.SetMaxOpenConns(1)
	_, err = database.Exec(schema)
	if err != nil {
		return nil, fmt.Errorf("初始化表结构: %w", err)
	}
	return &Store{database: database}, nil
}

func (store *Store) Close() error {
	return store.database.Close()
}

// affectedOne 把"没有命中任何行"翻译成 ErrNotFound
func affectedOne(result sql.Result, err error) error {
	if err != nil {
		return err
	}
	var count int64
	count, err = result.RowsAffected()
	if err != nil {
		return fmt.Errorf("读取影响行数: %w", err)
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}
