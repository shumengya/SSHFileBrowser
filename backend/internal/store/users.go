package store

import "crypto/sha256"
import "database/sql"
import "encoding/hex"
import "errors"
import "fmt"
import "time"

type User struct {
	ID           int64
	Username     string
	PasswordHash string
}

func (store *Store) CountUsers() (int, error) {
	var count int = 0
	var err error = store.database.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("统计用户: %w", err)
	}
	return count, nil
}

func (store *Store) CreateUser(username string, passwordHash string) (int64, error) {
	var result sql.Result
	var err error
	result, err = store.database.Exec(
		`INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`,
		username,
		passwordHash,
		time.Now().Unix(),
	)
	if err != nil {
		return 0, fmt.Errorf("创建用户: %w", err)
	}
	return result.LastInsertId()
}

func (store *Store) FindUserByName(username string) (User, error) {
	var user User = User{}
	var err error = store.database.QueryRow(
		`SELECT id, username, password_hash FROM users WHERE username = ?`,
		username,
	).Scan(&user.ID, &user.Username, &user.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return user, ErrNotFound
	}
	if err != nil {
		return user, fmt.Errorf("查询用户: %w", err)
	}
	return user, nil
}

func (store *Store) UpdatePassword(userID int64, passwordHash string) error {
	var result sql.Result
	var err error
	result, err = store.database.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, userID)
	return affectedOne(result, err)
}

// 库里只存令牌的 SHA-256,数据库泄露也无法冒用会话
func hashToken(token string) string {
	var sum [32]byte = sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (store *Store) CreateSession(token string, userID int64, expires time.Time) error {
	var _, err = store.database.Exec(
		`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
		hashToken(token),
		userID,
		expires.Unix(),
	)
	if err != nil {
		return fmt.Errorf("创建会话: %w", err)
	}
	return nil
}

func (store *Store) FindSessionUser(token string) (User, error) {
	var user User = User{}
	var err error = store.database.QueryRow(
		`SELECT users.id, users.username, users.password_hash FROM sessions
		 JOIN users ON users.id = sessions.user_id
		 WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
		hashToken(token),
		time.Now().Unix(),
	).Scan(&user.ID, &user.Username, &user.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return user, ErrNotFound
	}
	if err != nil {
		return user, fmt.Errorf("查询会话: %w", err)
	}
	return user, nil
}

func (store *Store) DeleteSession(token string) error {
	var _, err = store.database.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hashToken(token))
	if err != nil {
		return fmt.Errorf("删除会话: %w", err)
	}
	return nil
}

func (store *Store) DeleteUserSessions(userID int64) error {
	var _, err = store.database.Exec(`DELETE FROM sessions WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("清理会话: %w", err)
	}
	return nil
}

func (store *Store) PurgeExpiredSessions() error {
	var _, err = store.database.Exec(`DELETE FROM sessions WHERE expires_at <= ?`, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("清理过期会话: %w", err)
	}
	return nil
}
