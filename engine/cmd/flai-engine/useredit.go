// useredit.go 用户编辑器写回的通知端点（编辑器 Ctrl+S → AI 重读）。
//
// 桌面壳 CodeEditor 保存文件后 POST /notify/user-edit，按会话状态分流：
//  1. AI 任务运行中 → 插话通道 guide 车道（工具批结束边界注入，
//     当前任务立即看到，不打断执行）
//  2. AI 空闲 → injectSessionMessage 注入并跑一轮
//     （AI 主动 Read 刷新自己的文件视图，readstate 指纹随之更新）
//
// 防的是：AI 下一次 Edit 基于记忆里的旧内容 → old_string 匹配失败，
// 或更糟——Write 覆盖掉用户的手工修改。
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
)

// engineApp 保存 app 引用（路由在 goagent.New 期间注册，app 尚未存在，
// main 在 New 之后赋值——handler 执行时一定已就绪）。
var engineApp *goagent.App

// userEditRoutes 返回引擎扩展端点（经 goagent.WithHTTPRoutes 挂载）。
// 注意注册时机早于 app 创建：handler 内部经 engineApp 间接引用。
func userEditRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"POST /notify/user-edit": func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				SessionID string `json:"session_id"`
				File      string `json:"file"` // 绝对路径
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SessionID == "" || req.File == "" {
				http.Error(w, "session_id 和 file 必填", http.StatusBadRequest)
				return
			}
			// 文件名展示用短名；目录有助于 AI 定位就保留相对感（取末两段）
			short := shortFile(req.File)
			msg := fmt.Sprintf("[用户编辑] 用户在编辑器中手动保存了 %s（外部修改，不在对话历史里）。"+
				"继续操作该文件前必须先 Read 刷新内容——直接 Edit/Write 会基于陈旧内容失败或覆盖用户修改。"+
				"若用户的改动与你的工作冲突，优先尊重用户版本，必要时询问。", short)

			if engineApp == nil {
				http.Error(w, "引擎未就绪", http.StatusServiceUnavailable)
				return
			}

			// 任务运行中：插话通道（guide 车道）——工具批边界注入，当前
			// 任务立即看到；排队版通知（等下一条用户消息前缀注入）已废弃。
			if hub := engineApp.Steering(); hub != nil {
				if err := hub.Steer(req.SessionID, msg); err == nil {
					w.Write([]byte(`{"ok":true,"injected":true,"steered":true}`))
					return
				}
			}

			// 空闲：注入并跑一轮（AI 重读文件刷新视图）。
			if injectSessionMessage(engineApp, req.SessionID, msg) {
				w.Write([]byte(`{"ok":true,"injected":true}`))
				return
			}
			// 竞态窗口（检查空闲后恰被占用等）：短暂退避后重试插话通道。
			if hub := engineApp.Steering(); hub != nil {
				for i := 0; i < 3; i++ {
					time.Sleep(2 * time.Second)
					if err := hub.Steer(req.SessionID, msg); err == nil {
						w.Write([]byte(`{"ok":true,"injected":true,"steered":true}`))
						return
					}
				}
			}
			log.Printf("[user-edit] 会话 %s 注入失败（持续占用）", req.SessionID)
			w.Write([]byte(`{"ok":false,"injected":false}`))
		},
	}
}

// shortFile 取路径末两段（pages/home.dart），太短的退化文件名。
func shortFile(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	parts := strings.Split(strings.Trim(p, "/"), "/")
	if len(parts) >= 2 {
		return parts[len(parts)-2] + "/" + parts[len(parts)-1]
	}
	return p
}
