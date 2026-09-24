// catalog.go 能力目录：一次加载全部模式与插件，按会话解析能力。
//
// 引擎进程内只有一份工具注册表，模式是会话级的：
//
//   - 工具：被任一模式引用的工具集装一次；会话工具过滤器按「工具名 →
//     所属工具集 / 所属插件」判断该会话的模式是否启用，未归属的 base 工具恒可见。
//     插件子代理（Agent_<name>）与插件 MCP 工具（mcp__<server>__<tool>）归属插件
//   - 提示词：会话级提示词组目录（模式 prompts；空 = 内置通用 Agent 提示词）
//   - 规范：会话级项目上下文（模式插件的 rules + 工具集附带的动态上下文）
//   - 技能：每个模式一份注册表（插件技能 > 全局 skills/），Skill 工具按会话取用；
//     项目 .yume/commands/ 由 Skill 工具按会话工作目录现场读取，优先级最高
//
// 清单（mode.json / plugin.json / agents/*.md）在启动时严格校验、加载后不变；
// 技能文件每 30s 重扫（新增/删除会话中途生效）。
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/Dream355873200/GoAgent/skill"
)

// Catalog 已加载并校验的全部模式与插件。
type Catalog struct {
	Modes       []*Mode
	Plugins     []*Plugin
	DefaultMode string // 未绑定模式的会话使用（--mode）

	modeByID  map[string]*Mode
	toolOwner map[string]string // 工具名 → 所属工具集（静态，启动时建好）

	ownerMu     sync.RWMutex
	pluginOwner map[string]string // 工具名 → 所属插件（子代理启动时登记；MCP 工具连上后登记）
}

// catalog 进程级能力目录（main 启动时装配；路由与会话解析器读它）。
var catalog *Catalog

// LoadCatalog 加载全部插件与模式并逐一解析校验。任一清单不合规、
// 引用悬空或默认模式不存在都返回错误（拒绝带病启动）。
func LoadCatalog(defaultMode string) (*Catalog, error) {
	plugins, err := LoadPlugins()
	if err != nil {
		return nil, err
	}
	pluginByID := map[string]*Plugin{}
	for _, p := range plugins {
		pluginByID[p.ID] = p
	}
	modes, err := loadModes()
	if err != nil {
		return nil, err
	}
	c := &Catalog{Modes: modes, Plugins: plugins, DefaultMode: defaultMode, modeByID: map[string]*Mode{}}
	if c.Plugins == nil {
		c.Plugins = []*Plugin{}
	}
	for _, m := range modes {
		v, err := resolveMode(m, pluginByID)
		if err != nil {
			return nil, err
		}
		m.Resolved = v
		c.modeByID[m.ID] = m
	}
	if c.modeByID[defaultMode] == nil {
		ids := make([]string, 0, len(modes))
		for _, m := range modes {
			ids = append(ids, m.ID)
		}
		return nil, fmt.Errorf("默认模式 %q 不存在（可用: %v）", defaultMode, ids)
	}
	c.toolOwner = map[string]string{}
	for ts, inst := range toolsetRegistry {
		for _, t := range inst.tools {
			if prev, dup := c.toolOwner[t]; dup {
				return nil, fmt.Errorf("工具 %q 同时归属工具集 %s 与 %s", t, prev, ts)
			}
			c.toolOwner[t] = ts
		}
	}
	// 插件级命名空间：MCP 服务器名、子代理名全局唯一（二者都进工具名）
	c.pluginOwner = map[string]string{}
	mcpOwner := map[string]string{}
	for _, p := range plugins {
		for _, s := range p.MCPServers {
			if prev, dup := mcpOwner[s.Name]; dup {
				return nil, fmt.Errorf("MCP 服务器名 %q 同时出现在插件 %s 与 %s", s.Name, prev, p.ID)
			}
			mcpOwner[s.Name] = p.ID
		}
		for _, d := range p.AgentDefs {
			tool := d.ToolName()
			if prev, dup := c.pluginOwner[tool]; dup {
				return nil, fmt.Errorf("子代理 %q 同时出现在插件 %s 与 %s", d.Name, prev, p.ID)
			}
			if ts, clash := c.toolOwner[tool]; clash {
				return nil, fmt.Errorf("子代理工具名 %s（插件 %s）与工具集 %s 的工具重名", tool, p.ID, ts)
			}
			c.pluginOwner[tool] = p.ID
		}
	}
	return c, nil
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

// setPluginOwner 登记工具归属插件（MCP 工具须在注册进 app 之前登记，
// 否则注册与登记之间的窗口里它会被当成 base 工具对所有会话可见）。
func (c *Catalog) setPluginOwner(tool, pluginID string) {
	c.ownerMu.Lock()
	defer c.ownerMu.Unlock()
	c.pluginOwner[tool] = pluginID
}

func (c *Catalog) pluginOf(tool string) (string, bool) {
	c.ownerMu.RLock()
	defer c.ownerMu.RUnlock()
	pid, ok := c.pluginOwner[tool]
	return pid, ok
}

// Toolsets 被至少一个模式引用的工具集（去重、排序——装配顺序确定）。
func (c *Catalog) Toolsets() []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range c.Modes {
		for _, ts := range m.Resolved.Toolsets {
			if !seen[ts] {
				seen[ts] = true
				out = append(out, ts)
			}
		}
	}
	sort.Strings(out)
	return out
}

// sessionMode 会话当前模式：session-map 绑定的模式，未绑定或已不存在
// 时回落默认模式（永不返回 nil）。
func sessionMode(sessionID string) *Mode {
	if id := sessMap.modeOf(sessionID); id != "" {
		if m := catalog.Mode(id); m != nil {
			return m
		}
	}
	return catalog.Mode(catalog.DefaultMode)
}

// sessionToolVisible 会话工具过滤器：归属某工具集的工具只对启用了该
// 工具集的模式可见；归属某插件的工具（子代理 / MCP）只对引用了该插件的
// 模式可见；base 工具恒可见。
func sessionToolVisible(sessionID, toolName string) bool {
	if ts, owned := catalog.toolOwner[toolName]; owned {
		return sessionMode(sessionID).HasToolset(ts)
	}
	if pid, owned := catalog.pluginOf(toolName); owned {
		return sessionMode(sessionID).HasPlugin(pid)
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
	next := make(map[string]*skill.Registry, len(catalog.Modes))
	for _, m := range catalog.Modes {
		reg := skill.NewRegistry("", "")
		// 优先级：插件（按模式引用顺序）> 全局——先注册者占位
		for _, dir := range append(append([]string{}, m.Resolved.SkillDirs...), globalSkillsDir) {
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
				Origin      string `json:"origin"`           // plugin | global
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
			for _, p := range catalog.Plugins {
				add("plugin", p.ID, p.SkillsPath())
			}
			add("global", "", globalSkillsDir)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"skills": items})
		},
	}
}
