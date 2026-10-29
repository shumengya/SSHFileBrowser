package api

import "net/http"
import "path"
import "strings"

import "github.com/gin-gonic/gin"

import "sshfilebrowser/internal/remote"
import "sshfilebrowser/internal/store"

func (server *Server) listBookmarks(ctx *gin.Context) {
	var hostID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var bookmarks []store.Bookmark
	var err error
	bookmarks, err = server.store.ListBookmarks(hostID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, bookmarks)
}

func (server *Server) createBookmark(ctx *gin.Context) {
	var hostID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var input store.Bookmark = store.Bookmark{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	input.HostID = hostID
	input.Path, err = remote.CleanPath(input.Path)
	if err != nil {
		badRequest(ctx, "路径不合法")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		input.Name = path.Base(input.Path)
	}
	// 外键约束会拦住不存在的 hostId
	input.ID, err = server.store.CreateBookmark(input)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, input)
}

func (server *Server) deleteBookmark(ctx *gin.Context) {
	var hostID int64
	var bookmarkID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	bookmarkID, valid = paramID(ctx, "bookmarkId")
	if !valid {
		return
	}
	var err error = server.store.DeleteBookmark(hostID, bookmarkID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	ctx.JSON(http.StatusOK, gin.H{})
}
