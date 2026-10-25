// threads.go 对话注册表：项目里的每段对话 = 一个引擎会话 + 一条绑定
// （session-map.json，见 sessions.go）。引擎是对话元数据的唯一写入方：
//
//	GET    /threads?dir=           对话列表（绑定 + 会话摘要 + 未决交互）
//	POST   /threads                创建（桌面壳在发出第一条消息时才创建，不留空壳）
//	POST   /threads/{id}           局部更新：标题 / 智能体 / 权限 / 归档
//	DELETE /threads/{id}           停止运行，删除历史、任务、子代理轨迹与绑定
//	POST   /assist/commit-message  由 diff 生成提交说明
//
// 标题：创建时取首条消息首行作临时标题（auto）；首轮运行结束后由模型生成
// 短标题（ai）；用户改过的（user）永不覆盖。
// 权限：对话级持久化（绑定的 permission），sessionPermMode 钩子解析；更新时
// 清掉运行时覆写，钩子即时作用到进行中的审批门。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"

	goagent "github.com/Dream355873200/GoAgent"
	"github.com/Dream355873200/GoAgent/message"
	"github.com/Dream355873200/GoAgent/observer"
	"github.com/Dream355873200/GoAgent/provider"
	"github.com/Dream355873200/GoAgent/session"
)

// engineAsk 提问处理器（main 创建；对话列表据此标注「等你回答」）。
var engineAsk *goagent.AskUserHandler

// threadView 对话列表项。
type threadView struct {
	ID          string      `json:"id"`
	Dir         string      `json:"dir"`
	Mode        string      `json:"mode"`
	Title       string      `json:"title"`
	TitleSource string      `json:"titleSource,omitempty"`
	CreatedAt   int64       `json:"createdAt"`
	UpdatedAt   int64       `json:"updatedAt"`
	State       string      `json:"state"` // idle | running | interrupted
	Turns       int         `json:"turns"`
	Pending     string      `json:"pending,omitempty"` // ask | approval
	Permission  string      `json:"permission,omitempty"`
	Model       string      `json:"model,omitempty"` // 会话级模型覆盖；空 = 全局默认
	Effort      string      `json:"effort,omitempty"` // 会话级思考档位；空 = 全局默认
	Archived    bool        `json:"archived,omitempty"`
	Goal        *threadGoal `json:"goal,omitempty"`
}

// isThreadID 会话是否是用户可见的对话（团队成员会话、Git 辅助会话不是）。
func isThreadID(id string) bool {
	return id != "" && id != "ephemeral" && !strings.HasPrefix(id, "team-") && !strings.HasSuffix(id, "-git")
}

var threadIDRe = regexp.MustCompile(`^[A-Za-z0-9\p{L}\p{N}_.-]{1,128}$`)

// normDir 路径归一：分隔符统一为 /、去尾部分隔符；盘符路径不区分大小写。
// 与桌面壳 dirs.ts 的 normalizeDir 一致。
func normDir(dir string) string {
	d := strings.TrimRight(strings.ReplaceAll(dir, `\`, "/"), "/")
	if len(d) >= 2 && d[1] == ':' && unicode.IsLetter(rune(d[0])) {
		return strings.ToLower(d)
	}
	return d
}

func sameDir(a, b string) bool { return normDir(a) == normDir(b) }

// dirHash FNV-1a 32 位（按 UTF-16 码元）→ 8 位十六进制。算法不可改：老项目的
// 首段对话 ID（amc-<目录名>-<哈希>）由旧版桌面壳按同一算法算出并已落盘。
func dirHash(dir string) string {
	h := uint32(0x811c9dc5)
	for _, u := range utf16.Encode([]rune(normDir(dir))) {
		h ^= uint32(u)
		h *= 0x01000193
	}
	return fmt.Sprintf("%08x", h)
}

// asciiSlug 目录名的 ASCII 片段（会话 ID 也进轨迹端点等路径白名单）。
func asciiSlug(s string, max int) string {
	var sb strings.Builder
	for _, r := range s {
		if sb.Len() >= max {
			break
		}
		if r < utf8.RuneSelf && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_') {
			sb.WriteRune(r)
		}
	}
	if sb.Len() == 0 {
		return "p"
	}
	return sb.String()
}

// newThreadID 新对话的会话 ID：amc-<目录名>-<目录哈希>-<时间戳36进制><随机>。
// 前缀与项目首段对话（amc-<目录名>-<哈希>）同族，便于按项目辨认。
func newThreadID(dir string) string {
	base := filepath.Base(filepath.Clean(dir))
	suffix := strconv.FormatInt(time.Now().UnixMilli(), 36) + strconv.FormatInt(int64(rand.IntN(36*36)), 36)
	return "amc-" + asciiSlug(base, 32) + "-" + dirHash(dir) + "-" + suffix
}

// clampRunes 截断到 n 个字符（超出加省略号）。
func clampRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:n])) + "…"
}

// provisionalTitle 首条消息 → 临时标题（首个非空行，压缩空白）。
func provisionalTitle(msg string) string {
	for _, line := range strings.Split(msg, "\n") {
		line = strings.Join(strings.Fields(line), " ")
		if line != "" {
			return clampRunes(line, 30)
		}
	}
	return ""
}

var thinkBlockRe = regexp.MustCompile(`(?s)<(think|thinking|analysis)>.*?</(think|thinking|analysis)>`)

// stripThink 去掉模型混在正文里的思考段（含未闭合的开头段）。
func stripThink(s string) string {
	s = thinkBlockRe.ReplaceAllString(s, "")
	for _, tag := range []string{"<think>", "<thinking>", "<analysis>"} {
		if i := strings.Index(s, tag); i >= 0 {
			s = s[:i]
		}
	}
	return strings.TrimSpace(s)
}

// cleanTitle 模型输出 → 标题：首个非空行，去引号、前缀与收尾标点，≤ 24 字。
func cleanTitle(s string) string {
	s = stripThink(s)
	line := ""
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			line = l
			break
		}
	}
	for _, p := range []string{"标题：", "标题:", "Title:", "title:", "#"} {
		line = strings.TrimSpace(strings.TrimPrefix(line, p))
	}
	for {
		next := strings.Trim(line, "\"'`“”‘’「」『』《》* ")
		next = strings.TrimRight(next, "。．.!！?？:：;；，,")
		if next == line {
			break
		}
		line = next
	}
	return clampRunes(strings.TrimSpace(line), 24)
}

// validPermission 对话权限取值（空 = 跟随全局）。
func validPermission(p string) bool {
	switch p {
	case "", "plan", "default", "accept_edits", "bypass":
		return true
	}
	return false
}

// permOption 权限字符串 → 引擎权限模式（未知/空返回 false）。
func permOption(p string) (goagent.PermissionModeOption, bool) {
	switch p {
	case "plan":
		return goagent.PermissionPlanOnly, true
	case "default":
		return goagent.PermissionDefault, true
	case "accept_edits", "auto":
		return goagent.PermissionAcceptEdits, true
	case "bypass":
		return goagent.PermissionBypass, true
	case "deny_all":
		return goagent.PermissionDenyAll, true
	}
	return 0, false
}

// sessionPermMode 会话级权限钩子：团队会话按团队配置，对话按其持久化权限。
func sessionPermMode(sessionID string) (goagent.PermissionModeOption, bool) {
	if m, ok := teamPermMode(sessionID); ok {
		return m, true
	}
	return permOption(sessMap.binding(sessionID).Permission)
}

// pendingOf 会话的未决交互：等你回答（ask）/ 等你审批（approval）。
func pendingOf(id string) string {
	if engineAsk != nil && engineAsk.PendingBySession(id) != nil {
		return "ask"
	}
	if enginePermHandler != nil && len(enginePermHandler.PendingBySession(id)) > 0 {
		return "approval"
	}
	return ""
}

// sessionSummaries 会话摘要（id → 摘要；会话系统不可用时为空）。
func sessionSummaries(ctx context.Context) map[string]*session.SessionSummary {
	out := map[string]*session.SessionSummary{}
	if engineApp == nil || engineApp.Sessions() == nil {
		return out
	}
	list, err := engineApp.Sessions().List(ctx)
	if err != nil {
		return out
	}
	for _, s := range list {
		out[s.ID] = s
	}
	return out
}

func sessionBusy(id string) bool {
	return engineApp != nil && engineApp.Sessions() != nil && engineApp.Sessions().IsBusy(id)
}

// viewOf 绑定 + 摘要 → 列表项。
func viewOf(id string, b sessionBinding, s *session.SessionSummary) threadView {
	v := threadView{
		ID: id, Dir: b.Dir, Mode: b.Mode, Title: b.Title, TitleSource: b.TitleSource,
		CreatedAt: b.CreatedAt, UpdatedAt: b.CreatedAt, State: "idle",
		Permission: b.Permission, Model: b.Model, Effort: b.Effort, Archived: b.Archived, Goal: b.Goal,
	}
	if v.Mode == "" {
		v.Mode = catalog().DefaultMode
	}
	if s != nil {
		if s.UpdatedAt > 0 {
			v.UpdatedAt = s.UpdatedAt
		}
		if v.CreatedAt == 0 {
			v.CreatedAt = s.CreatedAt
		}
		v.Turns = s.TurnCount
		if v.Turns == 0 && s.FirstMessage != "" {
			v.Turns = 1 // 会话摘要的轮数未必维护：有首条消息即视为已开始
		}
		if v.Title == "" {
			v.Title = provisionalTitle(s.FirstMessage)
		}
		if s.State == "running" {
			v.State = "interrupted"
		}
	}
	if sessionBusy(id) {
		v.State = "running"
	}
	v.Pending = pendingOf(id)
	if v.Title == "" {
		v.Title = "新对话"
	}
	return v
}

// listThreads 对话列表（dir 为空 = 全部项目），按最近更新倒序。
// 从未对话过的旧绑定（无历史、无标题）不列出——不留空壳。
func listThreads(ctx context.Context, dir string) []threadView {
	bindings := sessMap.snapshot()
	summaries := sessionSummaries(ctx)
	out := []threadView{}
	for id, b := range bindings {
		if !isThreadID(id) || b.Dir == "" || (dir != "" && !sameDir(b.Dir, dir)) {
			continue
		}
		s := summaries[id]
		if s == nil && b.Title == "" {
			continue
		}
		out = append(out, viewOf(id, b, s))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt != out[j].UpdatedAt {
			return out[i].UpdatedAt > out[j].UpdatedAt
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// threadOf 单个对话的列表项（不存在返回 false）。
func threadOf(ctx context.Context, id string) (threadView, bool) {
	b, ok := sessMap.lookup(id)
	if !ok {
		return threadView{}, false
	}
	return viewOf(id, b, sessionSummaries(ctx)[id]), true
}

// taskFileSafe 与 goagent task.SessionStore 的文件名净化一致。
var taskFileSafe = regexp.MustCompile(`[^A-Za-z0-9._-]`)

// removeThreadArtifacts 删除会话历史与项目内的附属文件（任务、子代理轨迹）。
func removeThreadArtifacts(ctx context.Context, id, dir string) {
	if engineApp != nil && engineApp.Sessions() != nil {
		_ = engineApp.Sessions().Delete(ctx, id)
	}
	if dir == "" {
		return
	}
	_ = os.Remove(filepath.Join(dir, ".yume", "tasks", "tasks-"+taskFileSafe.ReplaceAllString(id, "_")+".json"))
	_ = os.RemoveAll(filepath.Join(dir, ".yume", "subagents", filepath.Base(id)))
}

// stopSession 中断会话的运行并等待其退出（最多 3s）。
func stopSession(id string) {
	if !sessionBusy(id) {
		return
	}
	if engineInterrupt != nil {
		_ = engineInterrupt.Interrupt(id, "对话已删除")
	}
	for i := 0; i < 30 && sessionBusy(id); i++ {
		time.Sleep(100 * time.Millisecond)
	}
}

// ---- 模型辅助（一次性补全）----

// quickComplete 一次性补全（不进会话、不带工具）：标题 / 提交说明这类短产出。
func quickComplete(ctx context.Context, system, user string, maxTokens int) (string, error) {
	if engineApp == nil {
		return "", errors.New("引擎未就绪")
	}
	p := engineApp.Provider()
	if p == nil {
		return "", errors.New("没有可用的模型")
	}
	resp, err := p.Complete(ctx, &provider.Request{
		SystemPrompt: system,
		Messages:     []message.Message{message.NewUserMessage(user)},
		MaxTokens:    maxTokens,
	})
	if err != nil {
		return "", err
	}
	return stripThink(messageTextOf(resp.Message)), nil
}

const titleSystemPrompt = "你是对话标题生成器。根据用户的第一条消息与助手的回复，为这段任务起一个简短标题：" +
	"中文不超过 14 个字（英文不超过 6 个词），概括要做的事，不加引号、不加句末标点、不加任何解释。只输出标题本身。"

const commitSystemPrompt = "你是资深工程师，为下面的 git 改动写一条提交说明。格式：首行是不超过 60 个字符的摘要" +
	"（祈使语气，说清改了什么）；改动较多时空一行，再用 2~5 条「- 」开头的要点说明关键变化与原因。" +
	"语言跟随改动内容与代码注释的主要语言（默认中文）。只输出提交说明本身，不要代码块围栏。"

// stripFence 去掉模型给整段输出包的代码块围栏（含语言标注行）。
func stripFence(s string) string {
	s = strings.TrimSpace(s)
	if !strings.HasPrefix(s, "```") {
		return s
	}
	s = strings.TrimPrefix(s, "```")
	if i := strings.IndexByte(s, '\n'); i >= 0 && !strings.ContainsAny(strings.TrimSpace(s[:i]), " \t") {
		s = s[i+1:]
	}
	return strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), "```"))
}

func clipText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n] + "\n…（已截断）"
}

// firstExchange 对话的第一条用户消息与第一段助手正文（跳过元消息与工具结果）。
func firstExchange(ctx context.Context, id string) (user, reply string) {
	if engineApp == nil || engineApp.Sessions() == nil {
		return "", ""
	}
	sess, err := engineApp.Sessions().Get(ctx, id)
	if err != nil || sess == nil {
		return "", ""
	}
	for _, m := range sess.Messages {
		if m.IsMeta {
			continue
		}
		text := strings.TrimSpace(messageTextOf(m))
		if text == "" {
			continue
		}
		if m.Role == message.RoleUser && user == "" {
			user = text
		} else if m.Role == message.RoleAssistant && user != "" {
			return user, text
		}
	}
	return user, ""
}

var titleInflight sync.Map

// threadTitleObserver 对话首轮运行结束后生成标题（auto → ai；用户改过的不动）。
type threadTitleObserver struct {
	observer.NopObserver
}

func (threadTitleObserver) OnSessionEnd(_ context.Context, sessionID string, _ int) {
	if !isThreadID(sessionID) {
		return
	}
	b, ok := sessMap.lookup(sessionID)
	if !ok || b.TitleSource == "user" || b.TitleSource == "ai" {
		return
	}
	if _, busy := titleInflight.LoadOrStore(sessionID, true); busy {
		return
	}
	go func() {
		defer titleInflight.Delete(sessionID)
		generateThreadTitle(sessionID)
	}()
}

// generateThreadTitle 读首轮问答（等落盘，最多 8s）→ 模型生成标题 → 写回绑定。
func generateThreadTitle(id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()
	var user, reply string
	for i := 0; i < 8 && reply == ""; i++ {
		time.Sleep(time.Second)
		user, reply = firstExchange(ctx, id)
	}
	if user == "" || reply == "" {
		return
	}
	out, err := quickComplete(ctx, titleSystemPrompt, "用户：\n"+clipText(user, 1500)+"\n\n助手：\n"+clipText(reply, 1500), 512)
	if err != nil {
		log.Printf("[threads] 生成标题失败 %s: %v", id, err)
		return
	}
	title := cleanTitle(out)
	if title == "" {
		return
	}
	_, _ = sessMap.update(id, func(b *sessionBinding, exists bool) bool {
		if !exists || b.TitleSource == "user" {
			return false
		}
		b.Title, b.TitleSource = title, "ai"
		return true
	})
}

// ---- HTTP ----

func httpErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": msg})
}

func threadsRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /threads": func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, map[string]any{"threads": listThreads(r.Context(), r.URL.Query().Get("dir"))})
		},

		// POST /threads 创建对话。id 省略时引擎生成；显式 id 用于登记已有会话
		//（已存在则只补齐缺失字段）。message = 首条消息（取临时标题）。
		"POST /threads": func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				ID         string `json:"id"`
				Dir        string `json:"dir"`
				Mode       string `json:"mode"`
				Permission string `json:"permission"`
				Title      string `json:"title"`
				Message    string `json:"message"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				httpErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
				return
			}
			dir := strings.TrimSpace(req.Dir)
			if st, err := os.Stat(dir); dir == "" || err != nil || !st.IsDir() {
				httpErr(w, http.StatusBadRequest, "项目目录不存在: "+dir)
				return
			}
			mode := req.Mode
			if mode == "" {
				mode = catalog().DefaultMode
			}
			if catalog().Mode(mode) == nil {
				httpErr(w, http.StatusBadRequest, "智能体不存在: "+mode)
				return
			}
			if !validPermission(req.Permission) {
				httpErr(w, http.StatusBadRequest, "权限取值非法: "+req.Permission)
				return
			}
			id := req.ID
			if id == "" {
				id = newThreadID(dir)
			} else if !threadIDRe.MatchString(id) || strings.Contains(id, "..") || !isThreadID(id) {
				httpErr(w, http.StatusBadRequest, "对话 ID 非法: "+id)
				return
			}
			title, source := clampRunes(strings.TrimSpace(req.Title), 40), "user"
			if title == "" {
				title, source = provisionalTitle(req.Message), "auto"
			}
			var conflict bool
			b, err := sessMap.update(id, func(b *sessionBinding, exists bool) bool {
				if exists && b.Dir != "" && !sameDir(b.Dir, dir) {
					conflict = true
					return false
				}
				if !exists || b.Dir == "" {
					b.Dir = dir
				}
				if !exists || b.Mode == "" {
					b.Mode = mode
				}
				if b.CreatedAt == 0 {
					b.CreatedAt = time.Now().UnixMilli()
				}
				if b.Title == "" && title != "" {
					b.Title, b.TitleSource = title, source
				}
				if req.Permission != "" && (!exists || b.Permission == "") {
					b.Permission = req.Permission
				}
				return true
			})
			if conflict {
				httpErr(w, http.StatusConflict, "对话 ID 已属于其他项目: "+id)
				return
			}
			if err != nil {
				httpErr(w, http.StatusInternalServerError, "写入对话注册表失败: "+err.Error())
				return
			}
			writeJSON(w, viewOf(id, b, sessionSummaries(r.Context())[id]))
		},

		// POST /threads/{id} 局部更新（字段省略 = 不改）。
		"POST /threads/{id}": func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			var req struct {
				Title      *string `json:"title"`
				Mode       *string `json:"mode"`
				Permission *string `json:"permission"`
				Model      *string `json:"model"`
				Effort     *string `json:"effort"`
				Archived   *bool   `json:"archived"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				httpErr(w, http.StatusBadRequest, "请求体解析失败: "+err.Error())
				return
			}
			if req.Mode != nil && catalog().Mode(*req.Mode) == nil {
				httpErr(w, http.StatusBadRequest, "智能体不存在: "+*req.Mode)
				return
			}
			if req.Permission != nil && !validPermission(*req.Permission) {
				httpErr(w, http.StatusBadRequest, "权限取值非法: "+*req.Permission)
				return
			}
			var missing bool
			_, err := sessMap.update(id, func(b *sessionBinding, exists bool) bool {
				if !exists {
					missing = true
					return false
				}
				if req.Title != nil {
					if t := clampRunes(strings.TrimSpace(*req.Title), 40); t != "" {
						b.Title, b.TitleSource = t, "user"
					} else {
						b.Title, b.TitleSource = "", ""
					}
				}
				if req.Mode != nil {
					b.Mode = *req.Mode
				}
				if req.Permission != nil {
					b.Permission = *req.Permission
				}
				if req.Model != nil {
					b.Model = strings.TrimSpace(*req.Model) // 空 = 清除覆盖，回全局默认
				}
				if req.Effort != nil {
					b.Effort = strings.TrimSpace(*req.Effort) // 空 = 清除覆盖，回全局默认
				}
				if req.Archived != nil {
					b.Archived = *req.Archived
				}
				return true
			})
			if missing {
				httpErr(w, http.StatusNotFound, "对话不存在: "+id)
				return
			}
			if err != nil {
				httpErr(w, http.StatusInternalServerError, "写入对话注册表失败: "+err.Error())
				return
			}
			if req.Permission != nil && engineApp != nil {
				// 清运行时覆写：钩子按新的持久化权限重算，进行中的审批门立即生效
				engineApp.ClearSessionPermissionMode(id)
			}
			v, _ := threadOf(r.Context(), id)
			writeJSON(w, v)
		},

		// DELETE /threads/{id} 删除对话（连同项目首段对话遗留的 Git 辅助会话）。
		"DELETE /threads/{id}": func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			if !isThreadID(id) {
				httpErr(w, http.StatusBadRequest, "不是对话: "+id)
				return
			}
			b, ok := sessMap.lookup(id)
			if !ok {
				httpErr(w, http.StatusNotFound, "对话不存在: "+id)
				return
			}
			stopSession(id)
			if sessionBusy(id) {
				httpErr(w, http.StatusConflict, "对话仍在运行，稍后再试")
				return
			}
			helper := id + "-git"
			removeThreadArtifacts(r.Context(), id, b.Dir)
			removeThreadArtifacts(r.Context(), helper, b.Dir)
			if err := sessMap.remove(id, helper); err != nil {
				httpErr(w, http.StatusInternalServerError, "写入对话注册表失败: "+err.Error())
				return
			}
			writeJSON(w, map[string]any{"ok": true})
		},

		// POST /assist/commit-message {stat, diff} → {message}
		"POST /assist/commit-message": func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				Stat string `json:"stat"`
				Diff string `json:"diff"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Diff+req.Stat) == "" {
				httpErr(w, http.StatusBadRequest, "需要 diff")
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
			defer cancel()
			out, err := quickComplete(ctx, commitSystemPrompt,
				"改动统计：\n"+clipText(req.Stat, 4000)+"\n\n差异：\n"+clipText(req.Diff, 24000), 1024)
			if err != nil {
				httpErr(w, http.StatusBadGateway, "生成失败: "+err.Error())
				return
			}
			writeJSON(w, map[string]any{"ok": true, "message": stripFence(out)})
		},
	}
}
