package store

import "database/sql"
import "fmt"
import "time"

import "sshfilebrowser/internal/xio"

type Bookmark struct {
	ID     int64  `json:"id"`
	HostID int64  `json:"hostId"`
	Name   string `json:"name"`
	Path   string `json:"path"`
}

func (store *Store) ListBookmarks(hostID int64) ([]Bookmark, error) {
	var rows *sql.Rows
	var err error
	rows, err = store.database.Query(
		`SELECT id, host_id, name, path FROM bookmarks WHERE host_id = ? ORDER BY id`,
		hostID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询收藏: %w", err)
	}
	defer xio.Close(rows, "查询结果")
	var bookmarks []Bookmark = []Bookmark{}
	for rows.Next() {
		var bookmark Bookmark = Bookmark{}
		err = rows.Scan(&bookmark.ID, &bookmark.HostID, &bookmark.Name, &bookmark.Path)
		if err != nil {
			return nil, fmt.Errorf("读取收藏: %w", err)
		}
		bookmarks = append(bookmarks, bookmark)
	}
	return bookmarks, rows.Err()
}

func (store *Store) CreateBookmark(bookmark Bookmark) (int64, error) {
	var result sql.Result
	var err error
	result, err = store.database.Exec(
		`INSERT INTO bookmarks (host_id, name, path, created_at) VALUES (?, ?, ?, ?)`,
		bookmark.HostID,
		bookmark.Name,
		bookmark.Path,
		time.Now().Unix(),
	)
	if err != nil {
		return 0, fmt.Errorf("新增收藏: %w", err)
	}
	return result.LastInsertId()
}

func (store *Store) DeleteBookmark(hostID int64, bookmarkID int64) error {
	var result sql.Result
	var err error
	result, err = store.database.Exec(`DELETE FROM bookmarks WHERE id = ? AND host_id = ?`, bookmarkID, hostID)
	return affectedOne(result, err)
}
