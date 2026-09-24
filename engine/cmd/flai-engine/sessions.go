// sessions.go 引擎侧会话绑定（单引擎多项目、多模式并存的核心）。
//
// 桌面壳维护 ~/.amobilecreater/session-map.json：
//
//	{"<sessionID>": {"dir": "<项目绝对路径>", "mode": "<模式 id>"}}
//
// （旧格式 {"<sessionID>": "<项目绝对路径>"} 仍兼容，模式取默认。）
// 引擎按需读取（mtime 缓存）：/chat 带 session_id 时，WithSessionWorkDir
// 解析出项目路径注入 ctx，Bash/Read/Write/领域工具全部扎根到对应项目；
// 模式决定该会话可见的工具、提示词组、规范与技能——切项目、切模式都
// 只是改绑定，引擎不重启。
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// sessionBinding 一个会话的绑定。
type sessionBinding struct {
	Dir  string `json:"dir"`
	Mode string `json:"mode,omitempty"`
}

// sessionMap 会话绑定表（带 mtime 缓存的文件读取）。
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

// modeOf 返回 sessionID 绑定的模式 id；未注册/未指定返回空串（调用方取默认模式）。
func (sm *sessionMap) modeOf(sessionID string) string {
	return sm.binding(sessionID).Mode
}

func (sm *sessionMap) binding(sessionID string) sessionBinding {
	if sessionID == "" {
		return sessionBinding{}
	}
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.reloadLocked()
	return sm.m[sessionID]
}

// reloadLocked 文件 mtime 变化时重读（桌面壳每次建会话/切模式都会写这个文件）。
func (sm *sessionMap) reloadLocked() {
	st, err := os.Stat(sm.path)
	if err != nil || sm.m != nil && st.ModTime().Equal(sm.modTime) {
		return
	}
	sm.modTime = st.ModTime()
	b, err := os.ReadFile(sm.path)
	if err != nil {
		return
	}
	raw := map[string]json.RawMessage{}
	if json.Unmarshal(b, &raw) != nil {
		return
	}
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
