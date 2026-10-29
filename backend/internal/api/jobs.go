package api

import "context"
import "fmt"
import "net/http"
import "path"
import "slices"

import "github.com/gin-gonic/gin"

import "sshfilebrowser/internal/remote"
import "sshfilebrowser/internal/task"

type pasteInput struct {
	SourceHostID int64    `json:"sourceHostId"` // 为 0 表示和目标同一台
	Paths        []string `json:"paths"`
	TargetDir    string   `json:"targetDir"`
	Move         bool     `json:"move"`
	Conflict     string   `json:"conflict"`
}

func describe(paths []string) string {
	if len(paths) == 1 {
		return path.Base(paths[0])
	}
	return fmt.Sprintf("%d 项", len(paths))
}

// paste 复制/移动作为后台任务执行,接口立即返回任务信息
func (server *Server) paste(ctx *gin.Context) {
	var input pasteInput = pasteInput{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	var valid bool
	input.Paths, valid = cleanPaths(ctx, input.Paths)
	if !valid {
		return
	}
	input.TargetDir, err = remote.CleanPath(input.TargetDir)
	if err != nil {
		badRequest(ctx, "目标路径不合法")
		return
	}
	if input.Conflict != remote.ConflictOverwrite && input.Conflict != remote.ConflictRename {
		input.Conflict = remote.ConflictSkip
	}
	var targetHostID int64
	targetHostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var sourceHostID int64 = input.SourceHostID
	if sourceHostID == 0 {
		sourceHostID = targetHostID
	}
	var target *remote.Conn
	var releaseTarget func()
	target, releaseTarget, err = server.pool.Get(ctx.Request.Context(), targetHostID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	var source *remote.Conn = target
	var releaseSource func() = func() {}
	if sourceHostID != targetHostID {
		source, releaseSource, err = server.pool.Get(ctx.Request.Context(), sourceHostID)
		if err != nil {
			releaseTarget()
			respondError(ctx, err)
			return
		}
	}
	var touched []task.Touched = []task.Touched{{HostID: targetHostID, Dir: input.TargetDir}}
	var verb string = "复制"
	if input.Move {
		verb = "移动"
		var index int
		for index = 0; index < len(input.Paths); index++ {
			var entry task.Touched = task.Touched{HostID: sourceHostID, Dir: path.Dir(input.Paths[index])}
			if !slices.Contains(touched, entry) {
				touched = append(touched, entry)
			}
		}
	}
	var title string = verb + " " + describe(input.Paths) + " 到 " + input.TargetDir
	var started task.Task = server.tasks.Start("paste", title, touched, func(work context.Context, report task.Report) error {
		defer releaseTarget()
		defer releaseSource()
		var transfer *remote.Transfer = &remote.Transfer{
			Source:    source,
			Target:    target,
			Paths:     input.Paths,
			TargetDir: input.TargetDir,
			Move:      input.Move,
			Conflict:  input.Conflict,
			Report:    remote.Progress(report),
		}
		return transfer.Run(work)
	})
	ctx.JSON(http.StatusOK, started)
}

type compressInput struct {
	Dir    string   `json:"dir"`
	Paths  []string `json:"paths"`
	Name   string   `json:"name"`
	Format string   `json:"format"`
}

func (server *Server) compress(ctx *gin.Context) {
	var input compressInput = compressInput{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	var valid bool
	input.Paths, valid = cleanPaths(ctx, input.Paths)
	if !valid {
		return
	}
	input.Dir, err = remote.CleanPath(input.Dir)
	if err != nil {
		badRequest(ctx, "路径不合法")
		return
	}
	var name string
	name, err = remote.CleanName(input.Name)
	if err != nil {
		badRequest(ctx, "压缩包名称不合法")
		return
	}
	var hostID int64
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var conn *remote.Conn
	var release func()
	conn, release, err = server.pool.Get(ctx.Request.Context(), hostID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	var archive string = path.Join(input.Dir, name)
	var touched []task.Touched = []task.Touched{{HostID: hostID, Dir: input.Dir}}
	var started task.Task = server.tasks.Start("compress", "压缩为 "+name, touched, func(work context.Context, report task.Report) error {
		defer release()
		report(-1, "正在压缩 "+describe(input.Paths))
		return conn.Compress(work, input.Dir, input.Paths, archive, input.Format)
	})
	ctx.JSON(http.StatusOK, started)
}

type extractInput struct {
	Path      string `json:"path"`
	DestDir   string `json:"destDir"`
	Overwrite bool   `json:"overwrite"`
}

func (server *Server) extract(ctx *gin.Context) {
	var input extractInput = extractInput{}
	var err error = ctx.ShouldBindJSON(&input)
	if err != nil {
		badRequest(ctx, "请求格式错误")
		return
	}
	var archive string
	archive, err = remote.CleanPath(input.Path)
	if err != nil {
		badRequest(ctx, "路径不合法")
		return
	}
	var destDir string
	destDir, err = remote.CleanPath(input.DestDir)
	if err != nil {
		badRequest(ctx, "解压目录必须是绝对路径")
		return
	}
	var hostID int64
	var valid bool
	hostID, valid = paramID(ctx, "hostId")
	if !valid {
		return
	}
	var conn *remote.Conn
	var release func()
	conn, release, err = server.pool.Get(ctx.Request.Context(), hostID)
	if err != nil {
		respondError(ctx, err)
		return
	}
	var touched []task.Touched = []task.Touched{{HostID: hostID, Dir: destDir}, {HostID: hostID, Dir: path.Dir(destDir)}}
	var started task.Task = server.tasks.Start("extract", "解压 "+path.Base(archive), touched, func(work context.Context, report task.Report) error {
		defer release()
		report(-1, "正在解压到 "+destDir)
		return conn.Extract(work, archive, destDir, input.Overwrite)
	})
	ctx.JSON(http.StatusOK, started)
}

func (server *Server) listTasks(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, server.tasks.List())
}

func (server *Server) cancelTask(ctx *gin.Context) {
	server.tasks.Cancel(ctx.Param("taskId"))
	ctx.JSON(http.StatusOK, gin.H{})
}

func (server *Server) removeTask(ctx *gin.Context) {
	server.tasks.Remove(ctx.Param("taskId"))
	ctx.JSON(http.StatusOK, gin.H{})
}

func (server *Server) clearTasks(ctx *gin.Context) {
	server.tasks.Remove("")
	ctx.JSON(http.StatusOK, gin.H{})
}
