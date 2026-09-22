// confirmProto.go 确认框载荷定义 + 旧文本前缀协议解码（兼容层）。
//
// 确认卡载荷已迁移到协议 ask_user 帧的 payload 字段（AskStructured
// 结构化下发，见 confirm.go）；本文件保留 ConfirmPayload 定义与
// DecodeConfirmPayload——旧格式（[confirm]{json}\n问题文本 前缀内嵌）
// 仍在历史会话回放中存在，需要时用于解析。
package tools

import (
	"encoding/json"
	"strings"
)

const confirmPrefix = "[confirm]"

// DecodeConfirmPayload 尝试从 ask_user 的 question 里解析 confirm 载荷。
// 不是 confirm 协议返回 ok=false（普通 AskUser 提问）。
// 引擎侧也导出给可能的 CLI 模式用；前端另有对应 JS 解析。
func DecodeConfirmPayload(question string) (ConfirmPayload, bool) {
	if !strings.HasPrefix(question, confirmPrefix) {
		return ConfirmPayload{}, false
	}
	rest := question[len(confirmPrefix):]
	nl := strings.Index(rest, "\n")
	if nl < 0 {
		return ConfirmPayload{}, false
	}
	var p ConfirmPayload
	if err := json.Unmarshal([]byte(rest[:nl]), &p); err != nil {
		return ConfirmPayload{}, false
	}
	return p, true
}

// ConfirmPayload 确认卡的结构化载荷。批量 confirm（questions 数组）时
// 每个问题一次 ask，Index/Total 标记队列位置（前端 1/N、2/N 展示）。
type ConfirmPayload struct {
	Question string   `json:"question"`
	Mode     string   `json:"mode"` // single | multi | confirm
	Choices  []string `json:"choices,omitempty"`
	Detail   string   `json:"detail,omitempty"`
	Index    int      `json:"index,omitempty"` // 批量中的第几个（1 起）
	Total    int      `json:"total,omitempty"` // 批量总数（单问时 0）
}
