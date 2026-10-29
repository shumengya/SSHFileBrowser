package api

import "maps"
import "slices"
import "sync"
import "time"

const loginWindow time.Duration = 15 * time.Minute
const loginMaxFailures int = 5

// loginLimiter 按客户端 IP 统计登录失败,15 分钟内失败 5 次就暂时拒绝
type loginLimiter struct {
	mutex    sync.Mutex
	failures map[string][]time.Time
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{failures: map[string][]time.Time{}}
}

func (limiter *loginLimiter) recent(key string) []time.Time {
	var kept []time.Time = []time.Time{}
	var times []time.Time = limiter.failures[key]
	var index int
	for index = 0; index < len(times); index++ {
		if time.Since(times[index]) < loginWindow {
			kept = append(kept, times[index])
		}
	}
	return kept
}

func (limiter *loginLimiter) blocked(key string) bool {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	return len(limiter.recent(key)) >= loginMaxFailures
}

func (limiter *loginLimiter) fail(key string) {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	limiter.failures[key] = append(limiter.recent(key), time.Now())
	// 顺手清掉过期的记录,防止被刷爆内存
	if len(limiter.failures) > 10000 {
		var keys []string = slices.Sorted(maps.Keys(limiter.failures))
		var index int
		for index = 0; index < len(keys); index++ {
			if len(limiter.recent(keys[index])) == 0 {
				delete(limiter.failures, keys[index])
			}
		}
	}
}

func (limiter *loginLimiter) reset(key string) {
	limiter.mutex.Lock()
	defer limiter.mutex.Unlock()
	delete(limiter.failures, key)
}
