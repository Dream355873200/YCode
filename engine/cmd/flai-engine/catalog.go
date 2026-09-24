// catalog.go 能力目录：一次加载全部模式与插件，按会话解析能力。
//
// 引擎进程内只有一份工具注册表，模式是会话级的：
//
//   - 工具：被任一模式引用的工具集装一次；会话工具过滤器按「工具名 →
//     所属工具集」判断该会话的模式是否启用，未归属任何工具集的 base 工具恒可见
//   - 提示词：会话级提示词组目录（模式 prompts；空 = 内置通用 Agent 提示词）
//   - 规范：会话级项目上下文（模式插件的 rules + 工具集附带的动态上下文）
//   - 技能：每个模式一份注册表（插件技能 > 全局 skills/），Skill 工具按会话取用；
//     项目 .yume/commands/ 由 Skill 工具按会话工作目录现场读取，优先级最高
//
// 清单（mode.json / plugin.json）在启动时严格校验、加载后不变；
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
	toolOwner map[string]string // 工具名 → 所属工具集
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
	return c, nil
}

// Mode 按 id 取模式（不存在返回 nil）。
func (c *Catalog) Mode(id string) *Mode { return c.modeByID[id] }

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
// 工具集的模式可见；base 工具恒可见。
func sessionToolVisible(sessionID, toolName string) bool {
	ts, owned := catalog.toolOwner[toolName]
	if !owned {
		return true
	}
	return sessionMode(sessionID).HasToolset(ts)
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
