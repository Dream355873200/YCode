// goals.go 对话目标（goal）：用户给一段对话设定一个目标，智能体逐轮推进，
// 每轮结束由验收（一次性模型调用）判断是否达成；未达成则带着「下一步」续跑，
// 直到达成、到达轮次上限或被用户暂停。
//
// 状态存在对话绑定里（session-map.json 的 goal 字段，引擎唯一写入）。续跑的
// 驱动在桌面壳：它在自己直播的那次运行收尾时调 /goal/verify，拿到续跑提示后
// 照常经 /chat 发送——续跑轮与普通轮一样实时可见。引擎重启时没有进行中的
// 驱动，启动即把 active 的目标转为 paused（用户点「继续」恢复）。
//
//	POST   /threads/{id}/goal          设定（替换）目标 {objective, maxIterations?}
//	POST   /threads/{id}/goal/pause    暂停（计时冻结）
//	POST   /threads/{id}/goal/resume   继续（计时恢复）
//	POST   /threads/{id}/goal/verify   验收本轮 → {goal, continue, prompt}
//	DELETE /threads/{id}/goal          清除目标
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Dream355873200/GoAgent/message"
	"github.com/Dream355873200/GoAgent/task"
)

const (
	goalActive   = "active"
	goalPaused   = "paused"
	goalVerified = "verified"

	defaultGoalIterations = 8
	maxGoalIterations     = 30
)

// threadGoal 对话目标。
type threadGoal struct {
	Objective    string      `json:"objective"`
	Status       string      `json:"status"`                 // active | paused | verified
	Iteration    int         `json:"iteration"`              // 当前（尚未验收）轮次，从 1 起
	MaxIter      int         `json:"maxIterations"`          // 轮次上限：到达后自动暂停
	ElapsedMs    int64       `json:"elapsedMs"`              // 已累计的推进时长（不含进行中的一段）
	ActiveSince  int64       `json:"activeSince,omitempty"`  // 进行中一段的起点（毫秒；暂停/达成后为 0）
	CreatedAt    int64       `json:"createdAt"`              // 设定时间
	PausedReason string      `json:"pausedReason,omitempty"` // 自动暂停的原因（到达上限 / 引擎重启 / 运行中断）
	Checks       []goalCheck `json:"checks,omitempty"`       // 每轮验收记录
}

// goalCheck 一轮验收。
type goalCheck struct {
	Iteration  int    `json:"iteration"`
	Passed     bool   `json:"passed"`
	Reason     string `json:"reason"`
	NextAction string `json:"nextAction,omitempty"`
	At         int64  `json:"at"`
}

// clone 深拷贝（绑定在 snapshot 间按值传递，目标是指针，修改前必须拷贝）。
func (g *threadGoal) clone() *threadGoal {
	if g == nil {
		return nil
	}
	c := *g
	c.Checks = append([]goalCheck(nil), g.Checks...)
	return &c
}

// freeze 把进行中的一段计入累计时长。
func (g *threadGoal) freeze(now int64) {
	if g.ActiveSince > 0 {
		g.ElapsedMs += now - g.ActiveSince
		g.ActiveSince = 0
	}
}

func newGoal(objective string, maxIter int, now int64) *threadGoal {
	if maxIter <= 0 {
		maxIter = defaultGoalIterations
	}
	if maxIter > maxGoalIterations {
		maxIter = maxGoalIterations
	}
	return &threadGoal{
		Objective: objective, Status: goalActive, Iteration: 1, MaxIter: maxIter,
		ActiveSince: now, CreatedAt: now,
	}
}

// goalVerdict 验收模型的结构化输出。
type goalVerdict struct {
	Passed     bool   `json:"passed"`
	Reason     string `json:"reason"`
	NextAction string `json:"next_action"`
}

// parseVerdict 解析验收输出；解析不了时按达成处理（fail open）——宁可提前
// 收尾，也不能因验收器故障让对话无限续跑。
func parseVerdict(out string) goalVerdict {
	s := stripFence(stripThink(out))
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i {
		var v goalVerdict
		if json.Unmarshal([]byte(s[i:j+1]), &v) == nil {
			v.Reason = clampRunes(strings.TrimSpace(v.Reason), 120)
			v.NextAction = clampRunes(strings.TrimSpace(v.NextAction), 80)
			return v
		}
	}
	return goalVerdict{Passed: true, Reason: "验收结果无法解析，按已完成处理"}
}

// applyVerdict 记录一轮验收并推进状态；返回是否续跑。
func applyVerdict(g *threadGoal, v goalVerdict, now int64) bool {
	g.Checks = append(g.Checks, goalCheck{
		Iteration: g.Iteration, Passed: v.Passed, Reason: v.Reason, NextAction: v.NextAction, At: now,
	})
	if v.Passed {
		g.Status, g.PausedReason = goalVerified, ""
		g.freeze(now)
		return false
	}
	if g.Iteration >= g.MaxIter {
		g.Status, g.PausedReason = goalPaused, fmt.Sprintf("已到达 %d 轮上限", g.MaxIter)
		g.freeze(now)
		return false
	}
	g.Iteration++
	return true
}

// continuationPrompt 续跑轮的输入。
func continuationPrompt(g *threadGoal, v goalVerdict) string {
	var sb strings.Builder
	sb.WriteString("继续推进目标（第 ")
	sb.WriteString(fmt.Sprint(g.Iteration))
	sb.WriteString(" 轮）：")
	sb.WriteString(g.Objective)
	if v.Reason != "" {
		sb.WriteString("\n\n上一轮验收未通过：")
		sb.WriteString(v.Reason)
	}
	if v.NextAction != "" {
		sb.WriteString("\n下一步：")
		sb.WriteString(v.NextAction)
	}
	return sb.String()
}

const goalVerifySystemPrompt = "你是目标验收员。根据给出的对话证据与任务清单，判断智能体是否已经完全达成用户设定的目标。" +
	"只认已经发生、可被证据支持的结果；计划、承诺或「接下来会做」都不算完成；证据不足时判为未达成。" +
	"只输出一个 JSON 对象：{\"passed\": true 或 false, \"reason\": \"一句话说明判断依据\", " +
	"\"next_action\": \"未达成时下一步最该做的一件事（祈使句，30 字内）；达成时留空\"}。不要输出任何其他内容。"

// goalEvidence 验收证据：任务清单 + 最近的对话正文（只取文本，按字数截断）。
func goalEvidence(ctx context.Context, sid string) string {
	var sb strings.Builder
	if engineApp != nil {
		if store := engineApp.TaskStore(); store != nil {
			if r, ok := store.(task.SessionRouter); ok {
				store = r.ForSession(sid)
			}
			if list := store.List(); len(list) > 0 {
				sb.WriteString("任务清单：\n")
				for _, t := range list {
					sb.WriteString(fmt.Sprintf("- [%s] %s\n", t.Status, t.Subject))
				}
				sb.WriteString("\n")
			}
		}
		if mgr := engineApp.Sessions(); mgr != nil {
			if sess, err := mgr.Get(ctx, sid); err == nil && sess != nil {
				var parts []string
				for i := len(sess.Messages) - 1; i >= 0 && len(parts) < 8; i-- {
					m := sess.Messages[i]
					text := strings.TrimSpace(messageTextOf(m))
					if m.IsMeta || text == "" {
						continue
					}
					role := "助手"
					if m.Role == message.RoleUser {
						role = "用户"
					}
					parts = append(parts, role+"：\n"+clipText(text, 2500))
				}
				sb.WriteString("最近的对话（由近及远）：\n")
				sb.WriteString(strings.Join(parts, "\n\n"))
			}
		}
	}
	return clipText(sb.String(), 14000)
}

// pauseActiveGoals 引擎启动时把进行中的目标转为暂停（续跑驱动随上一个进程消失）。
func pauseActiveGoals() {
	now := time.Now().UnixMilli()
	for id, b := range sessMap.snapshot() {
		if b.Goal == nil || b.Goal.Status != goalActive {
			continue
		}
		_, _ = sessMap.update(id, func(b *sessionBinding, exists bool) bool {
			if !exists || b.Goal == nil || b.Goal.Status != goalActive {
				return false
			}
			g := b.Goal.clone()
			g.Status, g.PausedReason = goalPaused, "引擎重启后暂停"
			g.freeze(now)
			b.Goal = g
			return true
		})
	}
}

// mutateGoal 对话目标的读-改-写（fn 收到拷贝；返回 false = 不写）。
func mutateGoal(id string, fn func(g *threadGoal) (*threadGoal, error)) (*threadGoal, int, error) {
	var code int
	var ferr error
	b, err := sessMap.update(id, func(b *sessionBinding, exists bool) bool {
		if !exists {
			code, ferr = http.StatusNotFound, fmt.Errorf("对话不存在: %s", id)
			return false
		}
		next, e := fn(b.Goal.clone())
		if e != nil {
			code, ferr = http.StatusConflict, e
			return false
		}
		b.Goal = next
		return true
	})
	if ferr != nil {
		return nil, code, ferr
	}
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	return b.Goal, http.StatusOK, nil
}

func goalRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	reply := func(w http.ResponseWriter, g *threadGoal, code int, err error) {
		if err != nil {
			httpErr(w, code, err.Error())
			return
		}
		writeJSON(w, map[string]any{"ok": true, "goal": g})
	}
	return map[string]func(http.ResponseWriter, *http.Request){
		"POST /threads/{id}/goal": func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				Objective     string `json:"objective"`
				MaxIterations int    `json:"maxIterations"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Objective) == "" {
				httpErr(w, http.StatusBadRequest, "需要 objective")
				return
			}
			g, code, err := mutateGoal(r.PathValue("id"), func(*threadGoal) (*threadGoal, error) {
				return newGoal(clampRunes(strings.TrimSpace(req.Objective), 400), req.MaxIterations, time.Now().UnixMilli()), nil
			})
			reply(w, g, code, err)
		},
		"POST /threads/{id}/goal/pause": func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				Reason string `json:"reason"` // 自动暂停的原因（运行中断等）；手动暂停留空
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			g, code, err := mutateGoal(r.PathValue("id"), func(g *threadGoal) (*threadGoal, error) {
				if g == nil || g.Status != goalActive {
					return nil, fmt.Errorf("没有进行中的目标")
				}
				g.Status, g.PausedReason = goalPaused, clampRunes(strings.TrimSpace(req.Reason), 60)
				g.freeze(time.Now().UnixMilli())
				return g, nil
			})
			reply(w, g, code, err)
		},
		// POST /threads/{id}/goal/resume 继续：当前轮已验收过（如到达上限后暂停）则
		// 进入下一轮并按需放宽上限；返回续跑提示（桌面壳发送以重新开工）。
		"POST /threads/{id}/goal/resume": func(w http.ResponseWriter, r *http.Request) {
			var prompt string
			g, code, err := mutateGoal(r.PathValue("id"), func(g *threadGoal) (*threadGoal, error) {
				if g == nil || g.Status != goalPaused {
					return nil, fmt.Errorf("没有已暂停的目标")
				}
				last := goalVerdict{}
				if n := len(g.Checks); n > 0 {
					c := g.Checks[n-1]
					last = goalVerdict{Reason: c.Reason, NextAction: c.NextAction}
					if c.Iteration == g.Iteration {
						g.Iteration++
					}
				}
				if g.Iteration > g.MaxIter {
					g.MaxIter = min(g.Iteration+defaultGoalIterations-1, maxGoalIterations)
				}
				g.Status, g.PausedReason, g.ActiveSince = goalActive, "", time.Now().UnixMilli()
				prompt = continuationPrompt(g, last)
				return g, nil
			})
			if err != nil {
				httpErr(w, code, err.Error())
				return
			}
			writeJSON(w, map[string]any{"ok": true, "goal": g, "prompt": prompt})
		},
		"DELETE /threads/{id}/goal": func(w http.ResponseWriter, r *http.Request) {
			g, code, err := mutateGoal(r.PathValue("id"), func(*threadGoal) (*threadGoal, error) { return nil, nil })
			reply(w, g, code, err)
		},
		// POST /threads/{id}/goal/verify 验收刚结束的这一轮。只有 active 的目标验收；
		// 续跑时返回 continue=true 与续跑提示（桌面壳照常经 /chat 发送）。
		"POST /threads/{id}/goal/verify": func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			b, ok := sessMap.lookup(id)
			if !ok {
				httpErr(w, http.StatusNotFound, "对话不存在: "+id)
				return
			}
			if b.Goal == nil || b.Goal.Status != goalActive {
				writeJSON(w, map[string]any{"ok": true, "goal": b.Goal, "continue": false})
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
			defer cancel()
			out, err := quickComplete(ctx, goalVerifySystemPrompt,
				"目标："+b.Goal.Objective+"\n\n"+goalEvidence(ctx, id), 800)
			verdict := goalVerdict{Passed: true, Reason: "验收调用失败，按已完成处理"}
			if err == nil {
				verdict = parseVerdict(out)
			}
			var cont bool
			var prompt string
			g, code, merr := mutateGoal(id, func(g *threadGoal) (*threadGoal, error) {
				if g == nil || g.Status != goalActive {
					return nil, fmt.Errorf("目标已不在进行中")
				}
				cont = applyVerdict(g, verdict, time.Now().UnixMilli())
				if cont {
					prompt = continuationPrompt(g, verdict)
				}
				return g, nil
			})
			if merr != nil {
				httpErr(w, code, merr.Error())
				return
			}
			writeJSON(w, map[string]any{"ok": true, "goal": g, "continue": cont, "prompt": prompt, "verdict": verdict})
		},
	}
}
