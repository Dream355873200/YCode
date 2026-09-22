// sessions.go 引擎侧会话→项目映射（单引擎多项目的核心）。
//
// 桌面壳维护 ~/.amobilecreater/session-map.json（{"<sessionID>": "<项目绝对路径>"}），
// 引擎按需读取（mtime 缓存）：/chat 带 session_id 时，WithSessionWorkDir
// 解析出该项目路径注入 ctx，Bash/Read/Write/flutter/测试工具全部扎根
// 到对应项目目录——切项目只是切 session，引擎不重启。
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// sessionMap 会话→项目映射（带 mtime 缓存的文件读取）。
type sessionMap struct {
	mu      sync.Mutex
	path    string
	modTime time.Time
	m       map[string]string
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
	if sessionID == "" {
		return ""
	}
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.reloadLocked()
	return sm.m[sessionID]
}

// reloadLocked 文件 mtime 变化时重读（桌面壳每次建会话都会写这个文件）。
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
	m := map[string]string{}
	if json.Unmarshal(b, &m) == nil {
		sm.m = m
	}
}
