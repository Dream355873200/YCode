// catalog.go 能力目录：一次加载全部模式与插件，按会话解析能力。
//
// 引擎进程内只有一份工具注册表，模式是会话级的：
//
//   - 工具：全部工具集启动时装一次；会话工具过滤器按「工具名 →
//     所属工具集 / 所属插件」判断该会话的模式是否启用，未归属的 base 工具恒可见。
//     插件子代理（Agent_<name>）与插件 MCP 工具（mcp__<server>__<tool>）归属插件
//   - 提示词：会话级提示词组目录（模式 prompts；空 = 内置通用 Agent 提示词）
//   - 规范：会话级项目上下文（模式插件的 rules + 工具集附带的动态上下文）
//   - 技能：每个模式一份注册表（插件技能 > 用户 skills/ > 内置 skills/），Skill
//     工具按会话取用；项目 .yume/commands/ 由 Skill 工具按会话工作目录现场读取，优先级最高
//
// 清单（mode.json / plugin.json / agents/*.md）逐项校验：坏项跳过并记入
// Errors，不拖垮其他项。POST /reload 重建目录后原子替换（见 reload.go）；
// 技能文件每 30s 重扫（新增/删除会话中途生效）。
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Dream355873200/GoAgent/skill"
)

// LoadError 目录加载中的单项错误（坏项被跳过，其余照常可用）。
type LoadError struct {
	Kind string `json:"kind"`           // mode | plugin | agent | mcp
	ID   string `json:"id,omitempty"`   // 出错项 id（目录不可读等整体错误为空）
	File string `json:"file,omitempty"` // 出错清单 / 目录路径
	Err  string `json:"error"`
}

// Catalog 已加载并校验的全部模式与插件（加载后不可变，reload 整体替换）。
type Catalog struct {
	Modes       []*Mode
	Plugins     []*Plugin
	DefaultMode string      // 未绑定模式的会话使用（--mode；不可用时回退首个可用模式）
	Errors      []LoadError // 被跳过的坏项

	modeByID map[string]*Mode
}

var catalogPtr atomic.Pointer[Catalog]

// catalog 当前能力目录快照（调用方在一次处理内复用同一快照，
// 避免 reload 替换时前后读到两份目录）。
func catalog() *Catalog { return catalogPtr.Load() }

func setCatalog(c *Catalog) { catalogPtr.Store(c) }

// toolsetOwner 工具名 → 所属工具集（由注册表静态派生）。
var toolsetOwner = func() map[string]string {
	m := map[string]string{}
	for ts, inst := range toolsetRegistry {
		for _, t := range inst.tools {
			if prev, dup := m[t]; dup {
				panic(fmt.Sprintf("工具 %q 同时归属工具集 %s 与 %s", t, prev, ts))
			}
			m[t] = ts
		}
	}
	return m
}()

// pluginToolTable 进程级插件工具归属表（跨 reload 存活——工具注册表也是进程级的）。
//
//	owner  工具名 → 所属插件（子代理装配 / MCP 工具连上时登记）
//	hidden 已下线的插件工具：goagent 注册表不支持删除，下线 = 对全部会话隐藏
type pluginToolTable struct {
	mu     sync.RWMutex
	owner  map[string]string
	hidden map[string]bool
}

var pluginTools = &pluginToolTable{owner: map[string]string{}, hidden: map[string]bool{}}

// claim 登记工具归属并解除隐藏。须在工具注册进 app 之前调用，否则注册
// 与登记之间的窗口里它会被当成 base 工具对所有会话可见。
func (t *pluginToolTable) claim(tool, pluginID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.owner[tool] = pluginID
	delete(t.hidden, tool)
}

// hide 下线工具（对全部会话不可见，直到再次 claim）。
func (t *pluginToolTable) hide(tool string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.hidden[tool] = true
}

// lookup 工具归属；hidden = 已下线。
func (t *pluginToolTable) lookup(tool string) (pluginID string, owned, hidden bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	pid, ok := t.owner[tool]
	return pid, ok, t.hidden[tool]
}

// LoadCatalog 加载全部插件与模式并逐项解析校验。坏插件、坏模式、引用
// 坏/缺插件的模式、命名冲突的后来者都跳过并记入 Errors；默认模式不可用时
// 回退到首个可用模式。只有一个可用模式都没有时返回错误。
func LoadCatalog(defaultMode string) (*Catalog, error) {
	plugins, errs := LoadPlugins()

	// 插件级命名空间：MCP 服务器名、子代理名全局唯一（二者都进工具名）；
	// 冲突时按 id 序后来者的该项被剔除
	agentOwner := map[string]string{}
	mcpOwner := map[string]string{}
	for _, p := range plugins {
		var servers []MCPServer
		for _, s := range p.MCPServers {
			if prev, dup := mcpOwner[s.Name]; dup {
				errs = append(errs, LoadError{Kind: "mcp", ID: s.Name, File: p.Dir,
					Err: fmt.Sprintf("MCP 服务器名 %q 同时出现在插件 %s 与 %s（后者已忽略）", s.Name, prev, p.ID)})
				continue
			}
			mcpOwner[s.Name] = p.ID
			servers = append(servers, s)
		}
		p.MCPServers = servers
		defs := []*AgentDef{}
		for _, d := range p.AgentDefs {
			tool := d.ToolName()
			if prev, dup := agentOwner[tool]; dup {
				errs = append(errs, LoadError{Kind: "agent", ID: d.Name, File: d.File,
					Err: fmt.Sprintf("子代理 %q 同时出现在插件 %s 与 %s（后者已忽略）", d.Name, prev, p.ID)})
				continue
			}
			if ts, clash := toolsetOwner[tool]; clash {
				errs = append(errs, LoadError{Kind: "agent", ID: d.Name, File: d.File,
					Err: fmt.Sprintf("子代理工具名 %s（插件 %s）与工具集 %s 的工具重名", tool, p.ID, ts)})
				continue
			}
			agentOwner[tool] = p.ID
			defs = append(defs, d)
		}
		p.AgentDefs = defs
	}

	pluginByID := map[string]*Plugin{}
	for _, p := range plugins {
		pluginByID[p.ID] = p
	}
	modes, modeErrs := loadModes()
	errs = append(errs, modeErrs...)
	c := &Catalog{Plugins: plugins, DefaultMode: defaultMode, Modes: []*Mode{}, modeByID: map[string]*Mode{}}
	for _, m := range modes {
		v, err := resolveMode(m, pluginByID)
		if err != nil {
			errs = append(errs, LoadError{Kind: "mode", ID: m.ID, File: m.Dir, Err: err.Error()})
			continue
		}
		m.Resolved = v
		c.Modes = append(c.Modes, m)
		c.modeByID[m.ID] = m
	}
	if len(c.Modes) == 0 {
		return nil, fmt.Errorf("没有可用的模式（%d 个错误: %v）", len(errs), errs)
	}
	if c.modeByID[defaultMode] == nil {
		c.DefaultMode = c.Modes[0].ID
		errs = append(errs, LoadError{Kind: "mode", ID: defaultMode,
			Err: fmt.Sprintf("默认模式 %q 不可用，已回退到 %s", defaultMode, c.DefaultMode)})
	}
	c.Errors = errs
	if c.Errors == nil {
		c.Errors = []LoadError{}
	}
	return c, nil
}

// errorsOf 指定类别的加载错误（/modes /plugins 附带展示）。
func (c *Catalog) errorsOf(kinds ...string) []LoadError {
	out := []LoadError{}
	for _, e := range c.Errors {
		if contains(kinds, e.Kind) {
			out = append(out, e)
		}
	}
	return out
}

// Mode 按 id 取模式（不存在返回 nil）。
func (c *Catalog) Mode(id string) *Mode { return c.modeByID[id] }

// UsedPlugins 被至少一个模式引用的插件（按 id 排序）。只有它们的子代理
// 与 MCP 服务器会被装配。
func (c *Catalog) UsedPlugins() []*Plugin {
	var out []*Plugin
	for _, p := range c.Plugins {
		if len(c.PluginUsedBy(p.ID)) > 0 {
			out = append(out, p)
		}
	}
	return out
}

// PluginUsedBy 引用该插件的模式 id 列表。
func (c *Catalog) PluginUsedBy(pluginID string) []string {
	used := []string{}
	for _, m := range c.Modes {
		if m.HasPlugin(pluginID) {
			used = append(used, m.ID)
		}
	}
	return used
}

// sessionMode 会话当前模式：session-map 绑定的模式，未绑定或已不存在
// 时回落默认模式（永不返回 nil）。
func sessionMode(sessionID string) *Mode {
	c := catalog()
	if id := sessMap.modeOf(sessionID); id != "" {
		if m := c.Mode(id); m != nil {
			return m
		}
	}
	return c.Mode(c.DefaultMode)
}

// sessionToolVisible 会话工具过滤器：归属某工具集的工具只对启用了该
// 工具集的模式可见；归属某插件的工具（子代理 / MCP）只对引用了该插件的
// 模式可见，已下线的对谁都不可见；base 工具恒可见。
func sessionToolVisible(sessionID, toolName string) bool {
	if ts, owned := toolsetOwner[toolName]; owned {
		return sessionMode(sessionID).HasToolset(ts)
	}
	if pid, owned, hidden := pluginTools.lookup(toolName); owned {
		return !hidden && sessionMode(sessionID).HasPlugin(pid)
	}
	return true
}

// sessionPromptDir 会话提示词组目录（空 = 内置通用提示词）。
func sessionPromptDir(sessionID string) string {
	return sessionMode(sessionID).Resolved.PromptDir
}

// sessionContextFiles 会话项目上下文（插件规范 + 工具集动态上下文）。
func sessionContextFiles(sessionID string) []string {
	return sessionMode(sessionID).Resolved.contextFiles
}

// userSkillsDir 用户全局技能目录（设置页新建技能写这里；空 = 无用户根）。
func userSkillsDir() string {
	if u := userRoot(); u != "" {
		return filepath.Join(u, "skills")
	}
	return ""
}

// globalSkillDirs 对全部模式生效的技能目录（用户 > 内置）。
func globalSkillDirs() []string {
	return []string{userSkillsDir(), globalSkillsDir}
}

// ---- 技能 ----

// skillCatalog 每个模式一份技能注册表（定期整体重建后原子替换）。
type skillCatalog struct {
	mu     sync.RWMutex
	byMode map[string]*skill.Registry
}

var skills = &skillCatalog{byMode: map[string]*skill.Registry{}}

// forSession 会话模式的技能注册表（Skill 工具的 SkillRegistryFn）。
func (sc *skillCatalog) forSession(sessionID string) *skill.Registry {
	id := sessionMode(sessionID).ID
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	return sc.byMode[id]
}

// rebuild 按当前技能文件重建全部模式的注册表。
func (sc *skillCatalog) rebuild() {
	c := catalog()
	next := make(map[string]*skill.Registry, len(c.Modes))
	for _, m := range c.Modes {
		reg := skill.NewRegistry("", "")
		// 优先级：插件（按模式引用顺序）> 用户全局 > 内置全局——先注册者占位
		for _, dir := range append(append([]string{}, m.Resolved.SkillDirs...), globalSkillDirs()...) {
			for _, s := range scanSkillDir(dir) {
				if reg.Get(s.Name) == nil {
					reg.Register(s)
				}
			}
		}
		next[m.ID] = reg
	}
	sc.mu.Lock()
	sc.byMode = next
	sc.mu.Unlock()
}

// watch 每 interval 重扫一次技能文件（会话中途新增/删除的技能生效）。
func (sc *skillCatalog) watch(interval time.Duration) {
	sc.rebuild()
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for range t.C {
			sc.rebuild()
		}
	}()
}

// scanSkillDir 扫描一个技能目录：平铺 <name>.md（README.md 除外）+
// 目录式 <name>/SKILL.md。
func scanSkillDir(dir string) []*skill.Skill {
	if dir == "" {
		return nil
	}
	tmp := skill.NewRegistry("", dir)
	_ = tmp.Discover()
	registerDirSkills(tmp, dir)
	var out []*skill.Skill
	for _, s := range tmp.List() {
		if strings.EqualFold(s.Name, "README") {
			continue
		}
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// skillsRoutes 技能清单端点：按来源（插件 / 全局）列出全部技能，
// 设置页据此展示各插件的技能与被哪些模式使用。
func skillsRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /skills": func(w http.ResponseWriter, r *http.Request) {
			type skillItem struct {
				Name        string `json:"name"`
				Description string `json:"description,omitempty"`
				WhenToUse   string `json:"whenToUse,omitempty"`
				Origin      string `json:"origin"`           // plugin | user | global
				Plugin      string `json:"plugin,omitempty"` // origin=plugin 时的插件 id
				FilePath    string `json:"filePath,omitempty"`
			}
			items := []skillItem{}
			add := func(origin, plugin, dir string) {
				for _, s := range scanSkillDir(dir) {
					items = append(items, skillItem{
						Name: s.Name, Description: s.Description, WhenToUse: s.WhenToUse,
						Origin: origin, Plugin: plugin, FilePath: s.FilePath,
					})
				}
			}
			for _, p := range catalog().Plugins {
				add("plugin", p.ID, p.SkillsPath())
			}
			add("user", "", userSkillsDir())
			add("global", "", globalSkillsDir)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"skills": items})
		},
	}
}
