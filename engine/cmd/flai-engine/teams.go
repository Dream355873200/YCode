// teams.go — Teams v3：用户创建的常驻团队（会话编排层）。
//
// 定稿架构（docs/pipeline-teams-plan.md Teams v3）：成员 = 主 agent 同款
// 会话，差异只在配置——角色卡（system prompt 覆写）、工具白名单（会话
// 工具过滤）、权限模式（会话级覆写，成员 auto / leader accept_edits）。
// 团队本身不是新运行时，只是 .yume/teams/<name>/team.json 定义 + 一组
// 引擎会话（team-<name>-<member>）+ 群聊总线（chat.jsonl）。
//
// 存储：
//
//	<项目>/.yume/teams/<name>/team.json   定义：目标 + leader + 成员表
//	<项目>/.yume/teams/<name>/chat.jsonl  群聊消息总线（事件驱动，不刷屏）
//
// 跨会话驱动：
//   - team_dispatch(team, member, task)：向成员会话注入 user 消息并跑一轮
//     （RunSession），成员进度经 EmitSubAgentProgress 透出到分派方的
//     工具卡；成员忙 → 排队（steering queue 车道）
//   - 群聊 POST：无 @ → leader 插话（忙走 guide 车道，闲则拉起其会话）；
//     @成员 → 路由该成员
//   - 成员权限请求（auto 模式下的危险操作）：转发进群聊（用户终审，标注
//     来源成员），并插话通知 leader 兜底判断
//
// 递归防护：成员工具白名单由 team.json 显式列出，"team" 工具集（分派
// 工具）只授予 leader，成员配置里出现即拒绝创建。
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
	"github.com/Dream355873200/GoAgent/message"
)

// ---- 实体 ----

// TeamMember 团队成员定义（team.json）。
type TeamMember struct {
	Name     string   `json:"name"`               // 成员标识（team-<name>-<member> 会话）
	Role     string   `json:"role"`               // 角色卡：身份/职责/产出规范
	Toolsets []string `json:"toolsets,omitempty"` // 工具白名单（工具集词；base 恒可见）
}

// TeamLeader 队长定义。
type TeamLeader struct {
	Role     string   `json:"role"`
	Toolsets []string `json:"toolsets,omitempty"` // 额外工具集（team 工具集自动授予）
	Mode     string   `json:"mode,omitempty"`     // 权限模式（默认 accept_edits）
}

// Team 团队实体。
type Team struct {
	Name      string       `json:"name"`
	Dir       string       `json:"dir"`  // 项目目录（存储根）
	Goal      string       `json:"goal"` // 团队目标（注入所有成员的共享背景）
	Leader    TeamLeader   `json:"leader"`
	Members   []TeamMember `json:"members"`
	CreatedAt time.Time    `json:"created_at"`
}

// member 成员（含 leader）统一内部视图。
type member struct {
	name     string
	role     string
	toolsets []string
	isLeader bool
}

func (t *Team) iterMembers() []member {
	out := []member{{name: "leader", role: t.Leader.Role, toolsets: t.Leader.Toolsets, isLeader: true}}
	for _, m := range t.Members {
		out = append(out, member{name: m.Name, role: m.Role, toolsets: m.Toolsets})
	}
	return out
}

func (t *Team) find(name string) (member, bool) {
	for _, m := range t.iterMembers() {
		if m.name == name {
			return m, true
		}
	}
	return member{}, false
}

// TeamChatMsg 群聊消息（chat.jsonl 一行一条）。
type TeamChatMsg struct {
	TS        time.Time `json:"ts"`
	From      string    `json:"from"`         // user | leader | <member> | system
	To        string    `json:"to,omitempty"` // leader | <member>
	Type      string    `json:"type"`         // chat | dispatch | result | steer | system | permission
	Text      string    `json:"text"`
	RequestID string    `json:"request_id,omitempty"` // type=permission 时供 /approve 回传
}

// ---- 会话绑定注册表 ----

// teamBinding 成员会话 → 团队成员的运行期绑定（会话钩子据此注入角色卡/
// 工具白名单/权限模式/工作目录）。引擎重启后首次访问团队路由时重建。
type teamBinding struct {
	team      *Team
	member    member
	sessionID string
}

type teamRegistry struct {
	mu       sync.RWMutex
	bySess   map[string]teamBinding
	activity map[string]string    // sessionID → 当前活动一句话
	live     map[string][]liveEvt // sessionID → 最近事件（成员时间线实时段）
}

type liveEvt struct {
	TS   time.Time `json:"ts"`
	Type string    `json:"type"`
	Text string    `json:"text"`
}

var teamsReg = &teamRegistry{
	bySess:   map[string]teamBinding{},
	activity: map[string]string{},
	live:     map[string][]liveEvt{},
}

const liveBufMax = 300

func (r *teamRegistry) register(t *Team) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range t.iterMembers() {
		r.bySess[teamSessionID(t.Name, m.name)] = teamBinding{team: t, member: m, sessionID: teamSessionID(t.Name, m.name)}
	}
}

func (r *teamRegistry) binding(sessionID string) (teamBinding, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	b, ok := r.bySess[sessionID]
	return b, ok
}

func (r *teamRegistry) setActivity(sessionID, text string) {
	r.mu.Lock()
	r.activity[sessionID] = text
	r.mu.Unlock()
}

func (r *teamRegistry) pushLive(sessionID string, ev liveEvt) {
	r.mu.Lock()
	defer r.mu.Unlock()
	buf := append(r.live[sessionID], ev)
	if len(buf) > liveBufMax {
		buf = buf[len(buf)-liveBufMax:]
	}
	r.live[sessionID] = buf
}

// ---- 存储与解析 ----

var teamNameRe = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,31}$`)

func teamSessionID(team, memberName string) string { return "team-" + team + "-" + memberName }

func teamRoot(dir string) string        { return filepath.Join(dir, ".yume", "teams") }
func teamDirOf(dir, name string) string { return filepath.Join(teamRoot(dir), name) }

// loadTeam 读单个团队定义并注册其会话绑定（幂等；引擎重启后由路由触达重建）。
func loadTeam(dir, name string) (*Team, error) {
	if !teamNameRe.MatchString(name) {
		return nil, fmt.Errorf("团队名不合法")
	}
	b, err := os.ReadFile(filepath.Join(teamDirOf(dir, name), "team.json"))
	if err != nil {
		return nil, err
	}
	var t Team
	if err := json.Unmarshal(b, &t); err != nil {
		return nil, fmt.Errorf("team.json 解析失败: %w", err)
	}
	t.Dir = dir
	teamsReg.register(&t)
	return &t, nil
}

// listTeams 项目下的全部团队（按创建时间序）。
func listTeams(dir string) []*Team {
	entries, err := os.ReadDir(teamRoot(dir))
	if err != nil {
		return nil
	}
	var out []*Team
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if t, err := loadTeam(dir, e.Name()); err == nil {
			out = append(out, t)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// ---- 群聊存储 ----

var chatMu sync.Mutex

func appendChat(t *Team, msg TeamChatMsg) {
	chatMu.Lock()
	defer chatMu.Unlock()
	if msg.TS.IsZero() {
		msg.TS = time.Now()
	}
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(teamDirOf(t.Dir, t.Name), "chat.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

func readChat(t *Team, after int) []TeamChatMsg {
	b, err := os.ReadFile(filepath.Join(teamDirOf(t.Dir, t.Name), "chat.jsonl"))
	if err != nil {
		return []TeamChatMsg{}
	}
	out := []TeamChatMsg{}
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		if line == "" {
			continue
		}
		var m TeamChatMsg
		if json.Unmarshal([]byte(line), &m) == nil {
			out = append(out, m)
		}
	}
	if after > 0 && after < len(out) {
		out = out[after:]
	}
	return out
}

// ---- 会话钩子（main.go 经 Option 注入）----

// teamSessionDir 成员/队长会话的项目目录（WithSessionWorkDir 包装用）。
func teamSessionDir(sessionID string) string {
	if b, ok := teamsReg.binding(sessionID); ok {
		return b.team.Dir
	}
	return ""
}

// teamToolVisible 成员工具白名单：team 工具集按绑定授予（leader 恒有、
// 成员恒无——递归防护），其余按成员 toolsets 判断，base 工具恒可见。
// 插件工具（子代理/MCP）v1 不对团队成员开放。
func teamToolVisible(b teamBinding, toolName string) bool {
	if ts, owned := toolsetOwner[toolName]; owned {
		if ts == "team" {
			return b.member.isLeader
		}
		for _, s := range b.member.toolsets {
			if s == ts {
				return true
			}
		}
		return false
	}
	if _, owned, _ := pluginTools.lookup(toolName); owned {
		return false
	}
	return true
}

// teamRoleCard 成员/队长的角色卡（WithSessionRoleCard 注入 system prompt）。
func teamRoleCard(sessionID string) string {
	b, ok := teamsReg.binding(sessionID)
	if !ok {
		return ""
	}
	var sb strings.Builder
	if b.member.isLeader {
		sb.WriteString("# 角色卡：团队队长\n\n你是团队「" + b.team.Name + "」的队长（leader）。\n\n" + b.member.role + "\n\n## 职责\n" +
			"- 拆解目标（团队目标：" + b.team.Goal + "），用 team_dispatch 工具把子任务分派给成员（可在同一轮并行分派多个）\n" +
			"- 汇总成员产出，直接输出结论文本（Markdown）——会进入团队群聊\n" +
			"- 成员的审批请求会以插话通知你；需要用户决策的，直接说明即可，用户会在团队面板处理\n" +
			"- 你向用户汇报，不直接操作成员的工具域之外的事务\n")
	} else {
		sb.WriteString("# 角色卡：团队成员 " + b.member.name + "\n\n你是团队「" + b.team.Name + "」的成员。\n\n" + b.member.role + "\n\n## 协作规范\n" +
			"- 团队目标：" + b.team.Goal + "\n" +
			"- 任务由队长通过分派下达；完成后直接输出结果文本（Markdown），会回传队长并进入群聊\n" +
			"- 遇到需要用户审批的危险操作会自动升级，等待即可；不要尝试联系用户\n" +
			"- 你没有创建 pipeline 或团队的能力，也不要越权执行其他成员的职责\n")
	}
	sb.WriteString("\n成员间交付默认 Markdown 片段；供 UI 渲染的结构化字段用内嵌 JSON 围栏。\n")
	return sb.String()
}

// teamPermMode 会话级权限模式（WithSessionPermissionMode）：成员统一
// accept_edits（auto——普通操作不弹卡，危险操作升级）；leader 按 team.json
// 配置（默认 accept_edits）。
func teamPermMode(sessionID string) (goagent.PermissionModeOption, bool) {
	b, ok := teamsReg.binding(sessionID)
	if !ok {
		return 0, false
	}
	mode := b.team.Leader.Mode
	if !b.member.isLeader {
		mode = "accept_edits" // 成员统一 auto
	}
	switch mode {
	case "bypass":
		return goagent.PermissionBypass, true
	case "plan":
		return goagent.PermissionPlanOnly, true
	case "default":
		return goagent.PermissionDefault, true
	case "deny_all":
		return goagent.PermissionDenyAll, true
	default: // "" / accept_edits / auto
		return goagent.PermissionAcceptEdits, true
	}
}

// ---- 跨会话驱动 ----

// teamBusy 成员会话是否正在运行。
func teamBusy(sessionID string) bool {
	mgr := engineApp.Sessions()
	return mgr != nil && mgr.IsBusy(sessionID)
}

// runMemberSession 驱动成员会话跑一轮（阻塞至结束），透出进度到分派方
// 工具流并记录实时事件；返回成员最终产出文本。
func runMemberSession(ctx goagent.Context, b teamBinding, input string) (string, error) {
	sid := b.sessionID
	teamsReg.setActivity(sid, "启动中")
	teamsReg.pushLive(sid, liveEvt{TS: time.Now(), Type: "run_start", Text: input})

	// 权限请求转发：成员 auto 模式下的危险操作 → 群聊（用户终审）+ leader 插话。
	if enginePermHandler != nil {
		sub, cancelSub := enginePermHandler.Subscribe(sid)
		done := make(chan struct{})
		defer func() { cancelSub(); <-done }()
		go func() {
			defer close(done)
			for req := range sub {
				appendChat(b.team, TeamChatMsg{From: "system", To: b.member.name, Type: "permission",
					Text:      fmt.Sprintf("成员 %s 请求批准：%s（%s）", b.member.name, req.Description, req.ToolName),
					RequestID: req.RequestID})
				notifyLeader(b.team, fmt.Sprintf("[审批升级] 成员 %s 请求批准：%s（%s）。若可由你兜底请在下次分派时自行处理；需要用户决策的无需动作，用户会在团队面板看到审批卡。", b.member.name, req.Description, req.ToolName))
			}
		}()
	}

	// 进度透出节流：text delta 聚合成 activity 一句话。
	var textBuf strings.Builder
	flushText := func(status string) {
		s := textBuf.String()
		if s == "" {
			return
		}
		goagent.EmitSubAgentProgress(ctx, sid, b.member.name, status, firstLine64(s))
		teamsReg.setActivity(sid, firstLine64(s))
	}

	var finalText string
	for ev := range engineApp.RunSession(ctx, sid, input) {
		switch ev.Type {
		case goagent.EventTextDelta:
			textBuf.WriteString(ev.Text)
			if textBuf.Len() > 200 { // 够一句话就刷
				flushText("running")
				textBuf.Reset()
			}
		case goagent.EventToolStart:
			flushText("running")
			textBuf.Reset()
			activity := ev.ToolName
			if len(ev.ToolInput) > 0 {
				activity += " " + firstLine64(string(ev.ToolInput))
			}
			teamsReg.setActivity(sid, activity)
			teamsReg.pushLive(sid, liveEvt{TS: time.Now(), Type: "tool_start", Text: activity})
			goagent.EmitSubAgentProgress(ctx, sid, b.member.name, "running", activity)
		case goagent.EventToolDone:
			teamsReg.pushLive(sid, liveEvt{TS: time.Now(), Type: "tool_done", Text: firstLine64(ev.ToolResult)})
			goagent.EmitSubAgentProgress(ctx, sid, b.member.name, "running", firstLine64(ev.ToolResult))
		case goagent.EventError:
			teamsReg.pushLive(sid, liveEvt{TS: time.Now(), Type: "error", Text: ev.Error.Error()})
			teamsReg.setActivity(sid, "")
			return "", fmt.Errorf("成员 %s 运行失败: %w", b.member.name, ev.Error)
		case goagent.EventInterrupted:
			teamsReg.pushLive(sid, liveEvt{TS: time.Now(), Type: "interrupted", Text: ev.Text})
			return "", fmt.Errorf("成员 %s 已被中断", b.member.name)
		case goagent.EventDone:
			finalText = lastAssistantText(ev.Messages)
			teamsReg.pushLive(sid, liveEvt{TS: time.Now(), Type: "run_done", Text: firstLine64(finalText)})
		}
	}
	flushText("done")
	teamsReg.setActivity(sid, "")
	return finalText, nil
}

// notifyLeader 给 leader 递一条消息：忙 → guide 车道插话；闲 → 排队并
// 拉起 leader 会话（后台，结果进群聊）。
func notifyLeader(t *Team, text string) {
	lsid := teamSessionID(t.Name, "leader")
	appendChat(t, TeamChatMsg{From: "system", To: "leader", Type: "steer", Text: text})
	if hub := engineApp.Steering(); hub != nil {
		if teamBusy(lsid) {
			_ = hub.Steer(lsid, text)
			return
		}
		hub.Enqueue(lsid, text)
	}
	go drainToChat(t, "leader", lsid, "")
}

// routeToTeamMember 用户 @成员：忙 → 插话；闲 → 拉起其会话。
func routeToTeamMember(t *Team, m member, text string) error {
	b, ok := teamsReg.binding(teamSessionID(t.Name, m.name))
	if !ok {
		return fmt.Errorf("成员 %s 未注册", m.name)
	}
	sid := b.sessionID
	if teamBusy(sid) {
		if hub := engineApp.Steering(); hub != nil {
			_ = hub.Steer(sid, text)
			appendChat(t, TeamChatMsg{From: "user", To: m.name, Type: "steer", Text: text})
			return nil
		}
		return fmt.Errorf("成员 %s 正在运行且插话通道不可用", m.name)
	}
	appendChat(t, TeamChatMsg{From: "user", To: m.name, Type: "chat", Text: text})
	if hub := engineApp.Steering(); hub != nil {
		hub.Enqueue(sid, text)
	}
	go drainToChat(t, m.name, sid, "")
	return nil
}

// drainToChat 后台驱动一个会话跑一轮，最终产出写回群聊（群聊路由用；
// team_dispatch 不走这里——它的产出作为工具结果返回分派方）。
func drainToChat(t *Team, from, sid, input string) {
	var finalText string
	for ev := range engineApp.RunSession(context.Background(), sid, input) {
		if ev.Type == goagent.EventDone {
			finalText = lastAssistantText(ev.Messages)
		} else if ev.Type == goagent.EventError {
			appendChat(t, TeamChatMsg{From: "system", Type: "system", Text: from + " 运行失败: " + ev.Error.Error()})
			return
		}
	}
	if strings.TrimSpace(finalText) != "" {
		appendChat(t, TeamChatMsg{From: from, Type: "chat", Text: finalText})
	}
}

// ---- 工具 ----

// installTeam team 工具集：team_dispatch / team_status / team_read。
// 只装一次；可见性由会话过滤决定（leader 恒有，成员恒无，主会话按模式）。
func installTeam(app *goagent.App) {
	app.Tool("team_dispatch", goagent.ToolDef{
		Description: "向团队成员分派一个子任务（跨会话驱动）：任务注入成员会话并运行至完成，" +
			"成员产出作为本工具结果返回；成员执行过程实时透出。成员忙时任务排队。" +
			"可在同一轮并行多次调用以并行分派。",
		Input: teamDispatchInput{},
		// 分派本身走会话 Gate 审批；成员内部工具不重复过门。
		Permission: goagent.Normal,
		Concurrent: true,
		Execute: func(ctx goagent.Context, in teamDispatchInput) (string, error) {
			t, err := resolveCallerTeam(ctx, in.Team)
			if err != nil {
				return "", err
			}
			m, ok := t.find(in.Member)
			if !ok || m.isLeader {
				return "", fmt.Errorf("成员 %q 不存在（可分派对象：%s）", in.Member, memberNames(t))
			}
			b, ok := teamsReg.binding(teamSessionID(t.Name, m.name))
			if !ok {
				return "", fmt.Errorf("成员 %s 未注册", m.name)
			}
			appendChat(t, TeamChatMsg{From: dispatchCallerName(ctx, t), To: m.name, Type: "dispatch", Text: in.Task})
			if teamBusy(b.sessionID) {
				if hub := engineApp.Steering(); hub != nil {
					hub.Enqueue(b.sessionID, in.Task)
					return "成员 " + m.name + " 正在运行，任务已排队（将在其当前任务结束后执行）", nil
				}
				return "", fmt.Errorf("成员 %s 正在运行", m.name)
			}
			out, err := runMemberSession(ctx, b, in.Task)
			if err != nil {
				appendChat(t, TeamChatMsg{From: "system", Type: "system", Text: err.Error()})
				return "", err
			}
			appendChat(t, TeamChatMsg{From: m.name, To: dispatchCallerName(ctx, t), Type: "result", Text: out})
			return out, nil
		},
	})
	app.Tool("team_status", goagent.ToolDef{
		Description: "查看团队状态：各成员忙闲、当前活动、最近群聊消息。",
		Input:       teamStatusInput{},
		Permission:  goagent.ReadOnly,
		Execute: func(ctx goagent.Context, in teamStatusInput) (string, error) {
			t, err := resolveCallerTeam(ctx, in.Team)
			if err != nil {
				return "", err
			}
			var sb strings.Builder
			for _, m := range t.iterMembers() {
				sid := teamSessionID(t.Name, m.name)
				status := "idle"
				if teamBusy(sid) {
					status = "running"
				}
				sb.WriteString(fmt.Sprintf("- %s [%s] %s\n", m.name, status, teamsReg.activityOf(sid)))
			}
			chat := readChat(t, 0)
			if n := 10; len(chat) > n {
				chat = chat[len(chat)-n:]
			}
			sb.WriteString("\n最近群聊：\n")
			for _, c := range chat {
				sb.WriteString(fmt.Sprintf("[%s] %s→%s (%s): %s\n", c.TS.Format("15:04"), c.From, c.To, c.Type, firstLine64(c.Text)))
			}
			return sb.String(), nil
		},
	})
	app.Tool("team_read", goagent.ToolDef{
		Description: "读取成员的产出与历史摘要（从其持久会话提取最近若干条消息）。",
		Input:       teamReadInput{},
		Permission:  goagent.ReadOnly,
		Execute: func(ctx goagent.Context, in teamReadInput) (string, error) {
			t, err := resolveCallerTeam(ctx, in.Team)
			if err != nil {
				return "", err
			}
			if _, ok := t.find(in.Member); !ok {
				return "", fmt.Errorf("成员 %q 不存在", in.Member)
			}
			n := in.LastN
			if n <= 0 {
				n = 8
			}
			sess, err := engineApp.Sessions().Get(ctx, teamSessionID(t.Name, in.Member))
			if err != nil || sess == nil {
				return "成员 " + in.Member + " 还没有会话历史", nil
			}
			msgs := sess.Messages
			if len(msgs) > n {
				msgs = msgs[len(msgs)-n:]
			}
			var sb strings.Builder
			for _, msg := range msgs {
				text := messageTextOf(msg)
				if text == "" {
					continue
				}
				sb.WriteString(fmt.Sprintf("[%s] %s\n", msg.Role, firstLineN(text, 400)))
			}
			return sb.String(), nil
		},
	})
}

type teamDispatchInput struct {
	Team   string `json:"team" desc:"团队名"`
	Member string `json:"member" desc:"成员名"`
	Task   string `json:"task" desc:"子任务描述（含产出格式约定）"`
}
type teamStatusInput struct {
	Team string `json:"team" desc:"团队名"`
}
type teamReadInput struct {
	Team   string `json:"team" desc:"团队名"`
	Member string `json:"member" desc:"成员名"`
	LastN  int    `json:"last_n,omitempty" desc:"取最近 N 条消息（默认 8）"`
}

// resolveCallerTeam 按调用方会话的项目目录 + 团队名解析团队。
func resolveCallerTeam(ctx goagent.Context, name string) (*Team, error) {
	dir := ctx.WorkDir
	if dir == "" {
		dir = sessMap.resolve(ctx.SessionID)
	}
	if dir == "" {
		return nil, fmt.Errorf("无法解析团队 %q 的项目目录", name)
	}
	t, err := loadTeam(dir, name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("团队 %q 不存在", name)
		}
		return nil, err
	}
	return t, nil
}

// dispatchCallerName 分派方在群聊里的署名：leader 分派署 leader，
// 其他会话（主 agent）署 leader 之外的名字。
func dispatchCallerName(ctx goagent.Context, t *Team) string {
	if b, ok := teamsReg.binding(ctx.SessionID); ok && b.member.isLeader {
		return "leader"
	}
	return "leader" // 主 agent 代行队长职责时也记在 leader 名下（群聊语义：指挥方）
}

func memberNames(t *Team) string {
	names := []string{}
	for _, m := range t.iterMembers() {
		if !m.isLeader {
			names = append(names, m.name)
		}
	}
	return strings.Join(names, ", ")
}

func firstLine64(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 120 {
		s = s[:120] + "…"
	}
	return s
}

func firstLineN(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		s = s[:n] + "…"
	}
	return s
}

// lastAssistantText 取一轮消息里最后一条 assistant 的纯文本。
func lastAssistantText(msgs []message.Message) string {
	for i := len(msgs) - 1; i >= 0; i-- {
		if msgs[i].Role == message.RoleAssistant {
			return messageTextOf(msgs[i])
		}
	}
	return ""
}

func messageTextOf(m message.Message) string {
	var sb strings.Builder
	for _, c := range m.Content {
		if c.Type == "text" {
			sb.WriteString(c.Text)
		}
	}
	return sb.String()
}

// ---- HTTP 路由 ----

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func teamDetailJSON(t *Team) map[string]any {
	members := []map[string]any{}
	for _, m := range t.iterMembers() {
		sid := teamSessionID(t.Name, m.name)
		status := "idle"
		if teamBusy(sid) {
			status = "running"
		}
		toolsets := m.toolsets
		if m.isLeader {
			toolsets = append(append([]string{}, toolsets...), "team")
		}
		members = append(members, map[string]any{
			"name": m.name, "role": m.role, "toolsets": toolsets, "isLeader": m.isLeader,
			"sessionId": sid, "status": status, "activity": teamsReg.activityOf(sid),
		})
	}
	return map[string]any{"name": t.Name, "dir": t.Dir, "goal": t.Goal, "leaderMode": t.Leader.Mode, "members": members}
}

// teamsRoutes 团队端点（创建/列表/详情/群聊/插话/实时事件）。
func teamsRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /teams": func(w http.ResponseWriter, r *http.Request) {
			dir := r.URL.Query().Get("dir")
			if dir == "" {
				http.Error(w, "缺少 dir 参数", http.StatusBadRequest)
				return
			}
			out := []map[string]any{}
			for _, t := range listTeams(dir) {
				out = append(out, map[string]any{"name": t.Name, "goal": t.Goal, "members": len(t.Members) + 1})
			}
			writeJSON(w, map[string]any{"teams": out})
		},
		"POST /teams": func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				Dir     string       `json:"dir"`
				Name    string       `json:"name"`
				Goal    string       `json:"goal"`
				Leader  TeamLeader   `json:"leader"`
				Members []TeamMember `json:"members"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "请求体解析失败: "+err.Error(), http.StatusBadRequest)
				return
			}
			if !teamNameRe.MatchString(req.Name) {
				http.Error(w, "团队名须为小写字母开头的 [a-z0-9_-]", http.StatusBadRequest)
				return
			}
			if strings.TrimSpace(req.Leader.Role) == "" || len(req.Members) == 0 {
				http.Error(w, "需要 leader 角色卡与至少一名成员", http.StatusBadRequest)
				return
			}
			seen := map[string]bool{}
			for _, m := range req.Members {
				if !teamNameRe.MatchString(m.Name) || seen[m.Name] || m.Name == "leader" {
					http.Error(w, "成员名不合法或重复: "+m.Name, http.StatusBadRequest)
					return
				}
				if strings.TrimSpace(m.Role) == "" {
					http.Error(w, "成员 "+m.Name+" 缺少角色卡", http.StatusBadRequest)
					return
				}
				seen[m.Name] = true
				for _, ts := range m.Toolsets {
					if _, ok := toolsetRegistry[ts]; !ok {
						http.Error(w, "成员 "+m.Name+" 引用了未知工具集: "+ts, http.StatusBadRequest)
						return
					}
					if ts == "team" {
						http.Error(w, "成员不能持有 team 工具集（递归防护）", http.StatusBadRequest)
						return
					}
				}
			}
			for _, ts := range req.Leader.Toolsets {
				if _, ok := toolsetRegistry[ts]; !ok {
					http.Error(w, "leader 引用了未知工具集: "+ts, http.StatusBadRequest)
					return
				}
			}
			t := &Team{Name: req.Name, Dir: req.Dir, Goal: req.Goal, Leader: req.Leader, Members: req.Members, CreatedAt: time.Now()}
			d := teamDirOf(req.Dir, req.Name)
			if err := os.MkdirAll(d, 0o755); err != nil {
				http.Error(w, "创建团队目录失败: "+err.Error(), http.StatusInternalServerError)
				return
			}
			b, _ := json.MarshalIndent(t, "", "  ")
			if err := os.WriteFile(filepath.Join(d, "team.json"), b, 0o644); err != nil {
				http.Error(w, "写 team.json 失败: "+err.Error(), http.StatusInternalServerError)
				return
			}
			teamsReg.register(t)
			appendChat(t, TeamChatMsg{From: "system", Type: "system", Text: "团队已创建：" + req.Goal})
			writeJSON(w, teamDetailJSON(t))
		},
		"GET /teams/{name}": func(w http.ResponseWriter, r *http.Request) {
			t, err := loadTeam(r.URL.Query().Get("dir"), r.PathValue("name"))
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			writeJSON(w, teamDetailJSON(t))
		},
		"DELETE /teams/{name}": func(w http.ResponseWriter, r *http.Request) {
			dir, name := r.URL.Query().Get("dir"), r.PathValue("name")
			t, err := loadTeam(dir, name)
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			for _, m := range t.iterMembers() {
				_ = engineApp.Sessions().Delete(r.Context(), teamSessionID(name, m.name))
			}
			if err := os.RemoveAll(teamDirOf(dir, name)); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			writeJSON(w, map[string]any{"ok": true})
		},
		"GET /teams/{name}/chat": func(w http.ResponseWriter, r *http.Request) {
			t, err := loadTeam(r.URL.Query().Get("dir"), r.PathValue("name"))
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			after := 0
			fmt.Sscanf(r.URL.Query().Get("after"), "%d", &after)
			writeJSON(w, map[string]any{"messages": readChat(t, after), "total": len(readChat(t, 0))})
		},
		"POST /teams/{name}/chat": func(w http.ResponseWriter, r *http.Request) {
			t, err := loadTeam(r.URL.Query().Get("dir"), r.PathValue("name"))
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			var req struct {
				Text string `json:"text"`
				At   string `json:"at"` // 空 = 路由给 leader；@成员 = 该成员
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Text) == "" {
				http.Error(w, "需要 text", http.StatusBadRequest)
				return
			}
			if req.At == "" || req.At == "leader" {
				appendChat(t, TeamChatMsg{From: "user", To: "leader", Type: "chat", Text: req.Text})
				notifyLeader(t, "[群聊] 用户: "+req.Text)
				writeJSON(w, map[string]any{"ok": true, "routed": "leader"})
				return
			}
			m, ok := t.find(req.At)
			if !ok || m.isLeader {
				http.Error(w, "成员不存在: "+req.At, http.StatusBadRequest)
				return
			}
			if err := routeToTeamMember(t, m, "[群聊 @"+m.name+"] 用户: "+req.Text); err != nil {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			writeJSON(w, map[string]any{"ok": true, "routed": m.name})
		},
		"GET /teams/{name}/members/{member}/live": func(w http.ResponseWriter, r *http.Request) {
			t, err := loadTeam(r.URL.Query().Get("dir"), r.PathValue("name"))
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			name := r.PathValue("member")
			if _, ok := t.find(name); !ok {
				http.Error(w, "成员不存在", http.StatusNotFound)
				return
			}
			sid := teamSessionID(t.Name, name)
			teamsReg.mu.RLock()
			live := append([]liveEvt{}, teamsReg.live[sid]...)
			activity := teamsReg.activity[sid]
			teamsReg.mu.RUnlock()
			status := "idle"
			if teamBusy(sid) {
				status = "running"
			}
			writeJSON(w, map[string]any{"status": status, "activity": activity, "events": live})
		},
	}
}

// activityOf 读取成员当前活动（空串 = 无）。
func (r *teamRegistry) activityOf(sessionID string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.activity[sessionID]
}

// ---- main.go 接线辅助 ----

// newEnginePermHandler 创建并持有全局审批处理器（成员权限请求订阅用）。
func newEnginePermHandler() *goagent.PermissionHandler {
	enginePermHandler = goagent.NewPermissionHandler()
	return enginePermHandler
}

// teamAwareWorkDir WithSessionWorkDir 包装：团队成员会话扎根其团队项目，
// 其余按 session-map 解析。
func teamAwareWorkDir(sessionID string) string {
	if dir := teamSessionDir(sessionID); dir != "" {
		return dir
	}
	return sessMap.resolve(sessionID)
}

// teamAwarePromptDir 团队会话不用模式提示词组（身份由角色卡承载，内置
// 通用 Agent 提示词打底）。
func teamAwarePromptDir(sessionID string) string {
	if _, ok := teamsReg.binding(sessionID); ok {
		return ""
	}
	return sessionPromptDir(sessionID)
}

// teamAwareContextFiles 团队会话不注入模式插件规范（角色卡即上下文）。
func teamAwareContextFiles(sessionID string) []string {
	if _, ok := teamsReg.binding(sessionID); ok {
		return nil
	}
	return sessionContextFiles(sessionID)
}

// teamAwareToolVisible 团队会话按成员白名单过滤，其余按模式过滤。
func teamAwareToolVisible(sessionID, toolName string) bool {
	if b, ok := teamsReg.binding(sessionID); ok {
		return teamToolVisible(b, toolName)
	}
	return sessionToolVisible(sessionID, toolName)
}
