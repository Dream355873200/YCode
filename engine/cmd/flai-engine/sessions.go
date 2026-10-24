// sessions.go 会话绑定表（单引擎多项目、多智能体并存的地基）。
//
// ~/.amobilecreater/session-map.json 记录每个会话（= 一段对话）的绑定：
//
//	{"<sessionID>": {"dir": "<项目绝对路径>", "mode": "<智能体 id>", "title": "…", …}}
//
// （旧格式 {"<sessionID>": "<项目绝对路径>"} 仍兼容，智能体取默认。）
// 引擎按需读取（mtime 缓存）：/chat 带 session_id 时，WithSessionWorkDir
// 解析出项目路径注入 ctx，Bash/Read/Write/领域工具全部扎根到对应项目；
// 智能体决定该会话可见的工具、提示词组、规范与技能。
//
// 引擎是这个文件的唯一写入方（对话注册表，见 threads.go）：每次写入都先
// 重读磁盘再改，临时文件 + 改名落盘，读方永远看不到写了一半的文件。
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// sessionBinding 一个会话的绑定（对话元数据也存在这里）。
type sessionBinding struct {
	Dir         string      `json:"dir"`
	Mode        string      `json:"mode,omitempty"`
	Title       string      `json:"title,omitempty"`
	TitleSource string      `json:"titleSource,omitempty"` // auto（首条消息截取）| ai（模型生成）| user（手动改名，永不覆盖）
	CreatedAt   int64       `json:"createdAt,omitempty"`   // Unix 毫秒
	Permission  string      `json:"permission,omitempty"`  // plan | default | accept_edits | bypass；空 = 全局默认
	Model       string      `json:"model,omitempty"`       // 会话级模型覆盖；空 = 全局默认
	Archived    bool        `json:"archived,omitempty"`
	Goal        *threadGoal `json:"goal,omitempty"` // 对话目标（见 goals.go）
}

// sessionMap 会话绑定表（带 mtime 缓存的文件读取 + 串行写入）。
type sessionMap struct {
	mu      sync.Mutex
	path    string
	modTime time.Time
	m       map[string]sessionBinding
}

func newSessionMap() *sessionMap {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return &sessionMap{path: filepath.Join(home, ".amobilecreater", "session-map.json")}
}

// resolve 返回 sessionID 对应的项目目录；未注册返回空串（回退进程 cwd）。
func (sm *sessionMap) resolve(sessionID string) string {
	return sm.binding(sessionID).Dir
}

// modeOf 返回 sessionID 绑定的智能体 id；未注册/未指定返回空串（调用方取默认）。
func (sm *sessionMap) modeOf(sessionID string) string {
	return sm.binding(sessionID).Mode
}

func (sm *sessionMap) binding(sessionID string) sessionBinding {
	if sessionID == "" {
		return sessionBinding{}
	}
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.loadLocked(false)
	return sm.m[sessionID]
}

// lookup 同 binding，另报告是否存在。
func (sm *sessionMap) lookup(sessionID string) (sessionBinding, bool) {
	if sessionID == "" {
		return sessionBinding{}, false
	}
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.loadLocked(false)
	b, ok := sm.m[sessionID]
	return b, ok
}

// snapshot 全部绑定的副本。
func (sm *sessionMap) snapshot() map[string]sessionBinding {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.loadLocked(false)
	out := make(map[string]sessionBinding, len(sm.m))
	for k, v := range sm.m {
		out[k] = v
	}
	return out
}

// update 读-改-写一条绑定：fn 收到当前值（不存在时为零值与 false），
// 返回 false 表示不写。返回写入后的值。
func (sm *sessionMap) update(sessionID string, fn func(b *sessionBinding, exists bool) bool) (sessionBinding, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.loadLocked(true)
	cur, ok := sm.m[sessionID]
	next := cur
	if !fn(&next, ok) {
		return cur, nil
	}
	sm.m[sessionID] = next
	if err := sm.writeLocked(); err != nil {
		if ok {
			sm.m[sessionID] = cur
		} else {
			delete(sm.m, sessionID)
		}
		return cur, err
	}
	return next, nil
}

// remove 删除绑定（不存在时为空操作）。
func (sm *sessionMap) remove(sessionIDs ...string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.loadLocked(true)
	changed := false
	for _, id := range sessionIDs {
		if _, ok := sm.m[id]; ok {
			delete(sm.m, id)
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return sm.writeLocked()
}

// loadLocked 读盘（force = 无视 mtime 缓存，写入前用来合并外部改动）。
func (sm *sessionMap) loadLocked(force bool) {
	st, err := os.Stat(sm.path)
	if err != nil {
		if sm.m == nil {
			sm.m = map[string]sessionBinding{}
		}
		return
	}
	if !force && sm.m != nil && st.ModTime().Equal(sm.modTime) {
		return
	}
	b, err := os.ReadFile(sm.path)
	if err != nil {
		if sm.m == nil {
			sm.m = map[string]sessionBinding{}
		}
		return
	}
	raw := map[string]json.RawMessage{}
	if json.Unmarshal(b, &raw) != nil {
		if sm.m == nil {
			sm.m = map[string]sessionBinding{}
		}
		return
	}
	sm.modTime = st.ModTime()
	m := make(map[string]sessionBinding, len(raw))
	for id, v := range raw {
		var dir string
		if json.Unmarshal(v, &dir) == nil {
			m[id] = sessionBinding{Dir: dir}
			continue
		}
		var sb sessionBinding
		if json.Unmarshal(v, &sb) == nil {
			m[id] = sb
		}
	}
	sm.m = m
}

// writeLocked 临时文件 + 改名落盘。
func (sm *sessionMap) writeLocked() error {
	b, err := json.MarshalIndent(sm.m, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(sm.path), 0o755); err != nil {
		return err
	}
	tmp := sm.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, sm.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if st, err := os.Stat(sm.path); err == nil {
		sm.modTime = st.ModTime()
	}
	return nil
}
