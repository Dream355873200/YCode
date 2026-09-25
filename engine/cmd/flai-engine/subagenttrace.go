// subagenttrace.go — 插件子代理的运行轨迹：落盘目录 + 只读时间线端点。
//
// 子代理（Agent_<name> 工具）运行在独立循环里，思考/工具调用/文本产出
// 经 goagent 的 agent.Runner.OnEvent 以 JSONL 追加写入
// <项目>/.yume/subagents/<sessionID>/<toolUseID>.jsonl（WithSubAgentTraceDir
// 接线）。本文件提供目录解析与 GET 端点，右栏 SubAgentTracePane 据此
// 渲染只读工作过程时间线（复刻 ZCode 的子代理查看形态）。
package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"

	goagent "github.com/Dream355873200/GoAgent"
)

// subAgentTraceDir 子代理轨迹目录（WithSubAgentTraceDir 钩子；按会话分目录）。
func subAgentTraceDir(ctx goagent.Context) string {
	workDir := ctx.WorkDir
	if workDir == "" {
		workDir = teamSessionDir(ctx.SessionID)
	}
	if workDir == "" {
		workDir = sessMap.resolve(ctx.SessionID)
	}
	if workDir == "" {
		if wd, err := os.Getwd(); err == nil {
			workDir = wd
		} else {
			return ""
		}
	}
	if ctx.SessionID == "" {
		return "" // 无会话归属（SDK 直用）不落盘——找不到归属的轨迹没有查看入口
	}
	return filepath.Join(workDir, ".yume", "subagents", filepath.Base(ctx.SessionID))
}

// subTraceIDRe toolUseID / sessionID 白名单（进文件路径，防穿越）。
var subTraceIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// subagentTraceRoutes 子代理轨迹端点。
func subagentTraceRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		// GET /subagents/{session}/{toolUse}/trace → {trace: [...]}（JSONL → 数组；
		// 运行中轮询即实时跟随，结束定格）。
		"GET /subagents/{session}/{toolUse}/trace": func(w http.ResponseWriter, r *http.Request) {
			session, toolUse := r.PathValue("session"), r.PathValue("toolUse")
			if !subTraceIDRe.MatchString(session) || !subTraceIDRe.MatchString(toolUse) {
				http.Error(w, "参数不合法", http.StatusBadRequest)
				return
			}
			lines := readJSONL(filepath.Join(subAgentTraceRootFor(session), toolUse+".jsonl"))
			writeJSON(w, map[string]any{"trace": lines})
		},
	}
}

// subAgentTraceRootFor 会话的轨迹根目录（项目目录优先，回退引擎 cwd——
// 与 subAgentTraceDir 的解析保持一致，端点才能找回文件）。
func subAgentTraceRootFor(sessionID string) string {
	if dir := teamSessionDir(sessionID); dir != "" {
		return filepath.Join(dir, ".yume", "subagents", filepath.Base(sessionID))
	}
	if dir := sessMap.resolve(sessionID); dir != "" {
		return filepath.Join(dir, ".yume", "subagents", filepath.Base(sessionID))
	}
	if wd, err := os.Getwd(); err == nil {
		return filepath.Join(wd, ".yume", "subagents", filepath.Base(sessionID))
	}
	return ""
}

// readJSONL 读 JSONL 文件为对象数组（缺失/损坏 = 空数组）。
func readJSONL(path string) []any {
	b, err := os.ReadFile(path)
	if err != nil {
		return []any{}
	}
	out := []any{}
	for _, line := range splitLines(string(b)) {
		if line == "" {
			continue
		}
		var m any
		if json.Unmarshal([]byte(line), &m) == nil {
			out = append(out, m)
		}
	}
	return out
}

func splitLines(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	out = append(out, s[start:])
	return out
}
