package task

import "context"
import "encoding/hex"
import "cmp"
import "log"
import "maps"
import "slices"
import "sync"
import "time"

import "sshfilebrowser/internal/secret"

const StatusRunning string = "running"
const StatusDone string = "done"
const StatusFailed string = "failed"
const StatusCanceled string = "canceled"

// 内存里最多保留这么多已结束的任务
const keepFinished int = 100

// Touched 任务改动过的目录,前端据此刷新打开着的标签页
type Touched struct {
	HostID int64  `json:"hostId"`
	Dir    string `json:"dir"`
}

type Task struct {
	ID         string    `json:"id"`
	Kind       string    `json:"kind"`
	Title      string    `json:"title"`
	Status     string    `json:"status"`
	Progress   float64   `json:"progress"` // -1 表示无法估计
	Message    string    `json:"message"`
	Error      string    `json:"error"`
	Touched    []Touched `json:"touched"`
	CreatedAt  int64     `json:"createdAt"`
	FinishedAt int64     `json:"finishedAt"`

	cancel context.CancelFunc
}

type Report func(progress float64, message string)

type Manager struct {
	mutex sync.Mutex
	tasks map[string]*Task
}

func NewManager() *Manager {
	return &Manager{tasks: map[string]*Task{}}
}

// Start 在后台执行 work;任务不依赖 HTTP 请求,浏览器关掉也会继续跑完
func (manager *Manager) Start(kind string, title string, touched []Touched, work func(ctx context.Context, report Report) error) Task {
	var ctx context.Context
	var cancel context.CancelFunc
	ctx, cancel = context.WithCancel(context.Background())
	var created *Task = &Task{
		ID:        hex.EncodeToString(secret.RandomBytes(8)),
		Kind:      kind,
		Title:     title,
		Status:    StatusRunning,
		Progress:  -1,
		Touched:   touched,
		CreatedAt: time.Now().UnixMilli(),
		cancel:    cancel,
	}
	manager.mutex.Lock()
	manager.tasks[created.ID] = created
	var snapshot Task = *created
	manager.mutex.Unlock()
	var report Report = func(progress float64, message string) {
		manager.mutex.Lock()
		created.Progress = progress
		created.Message = message
		manager.mutex.Unlock()
	}
	go func() {
		defer cancel()
		var err error = work(ctx, report)
		manager.mutex.Lock()
		defer manager.mutex.Unlock()
		created.FinishedAt = time.Now().UnixMilli()
		created.Status = StatusDone
		created.Progress = 1
		if err != nil && ctx.Err() != nil {
			created.Status = StatusCanceled
		}
		if err != nil && ctx.Err() == nil {
			created.Status = StatusFailed
			created.Error = err.Error()
			log.Printf("任务 %s 失败: %v", created.Title, err)
		}
		manager.prune()
	}()
	return snapshot
}

func (manager *Manager) List() []Task {
	manager.mutex.Lock()
	defer manager.mutex.Unlock()
	var ids []string = slices.Sorted(maps.Keys(manager.tasks))
	var tasks []Task = make([]Task, 0, len(ids))
	var index int
	for index = 0; index < len(ids); index++ {
		tasks = append(tasks, *manager.tasks[ids[index]])
	}
	slices.SortFunc(tasks, func(left Task, right Task) int {
		return cmp.Compare(right.CreatedAt, left.CreatedAt)
	})
	return tasks
}

func (manager *Manager) Cancel(taskID string) bool {
	manager.mutex.Lock()
	defer manager.mutex.Unlock()
	var found *Task = manager.tasks[taskID]
	if found == nil || found.Status != StatusRunning {
		return false
	}
	found.cancel()
	return true
}

// Remove 只移除已结束的任务;taskID 为空时清空全部已结束任务
func (manager *Manager) Remove(taskID string) {
	manager.mutex.Lock()
	defer manager.mutex.Unlock()
	var ids []string = slices.Sorted(maps.Keys(manager.tasks))
	var index int
	for index = 0; index < len(ids); index++ {
		var current *Task = manager.tasks[ids[index]]
		if current.Status == StatusRunning {
			continue
		}
		if taskID == "" || taskID == current.ID {
			delete(manager.tasks, current.ID)
		}
	}
}

// prune 调用方已持有锁
func (manager *Manager) prune() {
	var finished []*Task = []*Task{}
	var ids []string = slices.Sorted(maps.Keys(manager.tasks))
	var index int
	for index = 0; index < len(ids); index++ {
		if manager.tasks[ids[index]].Status != StatusRunning {
			finished = append(finished, manager.tasks[ids[index]])
		}
	}
	if len(finished) <= keepFinished {
		return
	}
	slices.SortFunc(finished, func(left *Task, right *Task) int {
		return cmp.Compare(left.FinishedAt, right.FinishedAt)
	})
	for index = 0; index < len(finished)-keepFinished; index++ {
		delete(manager.tasks, finished[index].ID)
	}
}
