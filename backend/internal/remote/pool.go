package remote

import "context"
import "fmt"
import "log"
import "maps"
import "slices"
import "sync"
import "time"

import "sshfilebrowser/internal/secret"
import "sshfilebrowser/internal/store"
import "sshfilebrowser/internal/xio"

// 空闲这么久没人用的连接会被回收
const idleTimeout time.Duration = 10 * time.Minute

// slot 一台服务器一个;mutex 保证同时只有一个请求在建连,其它请求等它的结果
type slot struct {
	mutex    sync.Mutex
	conn     *Conn
	users    int
	lastUsed time.Time
}

type Pool struct {
	store *store.Store
	box   *secret.Box
	mutex sync.Mutex
	slots map[int64]*slot
	stop  chan struct{}
}

func NewPool(database *store.Store, box *secret.Box) *Pool {
	var pool *Pool = &Pool{
		store: database,
		box:   box,
		slots: map[int64]*slot{},
		stop:  make(chan struct{}),
	}
	go pool.reapLoop()
	return pool
}

func (pool *Pool) slotFor(hostID int64) *slot {
	pool.mutex.Lock()
	defer pool.mutex.Unlock()
	var found *slot = pool.slots[hostID]
	if found == nil {
		found = &slot{}
		pool.slots[hostID] = found
	}
	return found
}

// Get 取连接并加引用计数,用完必须调用返回的 release;用着的连接不会被回收
func (pool *Pool) Get(ctx context.Context, hostID int64) (*Conn, func(), error) {
	var current *slot = pool.slotFor(hostID)
	current.mutex.Lock()
	defer current.mutex.Unlock()
	if current.conn != nil && !current.conn.Alive() {
		xio.Close(current.conn, "失效的 SSH 连接")
		current.conn = nil
	}
	if current.conn == nil {
		var conn *Conn
		var err error
		conn, err = pool.dial(ctx, hostID)
		if err != nil {
			return nil, nil, err
		}
		current.conn = conn
	}
	current.users++
	current.lastUsed = time.Now()
	var conn *Conn = current.conn
	var once sync.Once
	var release func() = func() {
		once.Do(func() {
			current.mutex.Lock()
			current.users--
			current.lastUsed = time.Now()
			current.mutex.Unlock()
		})
	}
	return conn, release, nil
}

func (pool *Pool) dial(ctx context.Context, hostID int64) (*Conn, error) {
	var host store.Host
	var err error
	host, err = pool.store.GetHost(hostID)
	if err != nil {
		return nil, fmt.Errorf("读取服务器配置: %w", err)
	}
	var options DialOptions
	options, err = pool.dialOptions(host)
	if err != nil {
		return nil, err
	}
	var conn *Conn
	conn, err = Dial(ctx, options)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrConnect, err)
	}
	// 首次连接:记住指纹,以后不一致就拒绝连接
	if host.HostKey == "" {
		err = pool.store.SetHostKey(hostID, conn.info.HostKey)
		if err != nil {
			log.Printf("保存主机指纹: %v", err)
		}
	}
	return conn, nil
}

func (pool *Pool) dialOptions(host store.Host) (DialOptions, error) {
	var options DialOptions = DialOptions{
		Address:  host.Address,
		Port:     host.Port,
		Username: host.Username,
		AuthType: host.AuthType,
		HostKey:  host.HostKey,
	}
	var err error
	options.Password, err = pool.box.Open(host.Secret)
	if err != nil {
		return options, err
	}
	options.Passphrase, err = pool.box.Open(host.Passphrase)
	if err != nil {
		return options, err
	}
	return options, nil
}

// Test 用表单里的参数试连一次,不进连接池
func (pool *Pool) Test(ctx context.Context, options DialOptions) (Info, error) {
	var conn *Conn
	var err error
	conn, err = Dial(ctx, options)
	if err != nil {
		return Info{}, err
	}
	defer xio.Close(conn, "测试连接")
	return conn.info, nil
}

// Forget 服务器配置被修改或删除时断开旧连接;正在用的请求会自然失败
func (pool *Pool) Forget(hostID int64) {
	pool.mutex.Lock()
	var current *slot = pool.slots[hostID]
	delete(pool.slots, hostID)
	pool.mutex.Unlock()
	if current == nil {
		return
	}
	current.mutex.Lock()
	defer current.mutex.Unlock()
	if current.conn != nil {
		xio.Close(current.conn, "SSH 连接")
		current.conn = nil
	}
}

func (pool *Pool) reapLoop() {
	var ticker *time.Ticker = time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-pool.stop:
			return
		case <-ticker.C:
			pool.reap()
		}
	}
}

func (pool *Pool) reap() {
	pool.mutex.Lock()
	var hostIDs []int64 = slices.Sorted(maps.Keys(pool.slots))
	var slots []*slot = make([]*slot, 0, len(hostIDs))
	var index int
	for index = 0; index < len(hostIDs); index++ {
		slots = append(slots, pool.slots[hostIDs[index]])
	}
	pool.mutex.Unlock()
	for index = 0; index < len(slots); index++ {
		var current *slot = slots[index]
		// 正在建连的 slot 跳过,下一轮再看
		if !current.mutex.TryLock() {
			continue
		}
		if current.conn != nil && current.users <= 0 && time.Since(current.lastUsed) > idleTimeout {
			xio.Close(current.conn, "空闲 SSH 连接")
			current.conn = nil
		}
		current.mutex.Unlock()
	}
}

func (pool *Pool) Close() {
	close(pool.stop)
	pool.mutex.Lock()
	defer pool.mutex.Unlock()
	var hostIDs []int64 = slices.Sorted(maps.Keys(pool.slots))
	var index int
	for index = 0; index < len(hostIDs); index++ {
		var current *slot = pool.slots[hostIDs[index]]
		if current.conn != nil {
			xio.Close(current.conn, "SSH 连接")
		}
	}
	clear(pool.slots)
}
