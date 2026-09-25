// plugin.go 能力插件（plugin）：元能力的聚合层。
//
// 能力分层（自下而上，每层只引用下一层，不跨层直填）：
//
//	toolset  原生工具集（Go 代码，toolsets.go 注册表）——「能做什么」
//	skill / rules / MCP  声明层（markdown / json 纯数据）——「怎么做、守什么规矩」
//	plugin   聚合层：把一组 toolset 引用 + 技能目录 + 规范 + 面板槽位打包成可复用能力
//	mode     装配层：只引用提示词组与插件，不直接声明任何能力（见 mode.go）
//
// 插件 = plugins/<id>/ 目录，纯数据零代码：
//
//	plugin.json  插件清单（字段见 Plugin；未知字段即清单错误）
//	rules.md     领域规范（会话级注入项目上下文，等同 CLAUDE.md 地位）
//	skills/      技能目录（平铺 <name>.md 或目录式 <name>/SKILL.md）
//	agents/      子代理目录（<name>.md → Agent_<name> 工具，见 agents.go）
//
// mcpServers 声明的 MCP 服务器在引擎启动后后台连接，发现的工具以
// mcp__<server>__<tool> 注册（见 mcp.go）。子代理与 MCP 工具都归属声明
// 它的插件：只有引用该插件的模式的会话可见。
//
// 校验严格：id 必须等于目录名、引用的工具集必须在注册表、声明的
// 文件/目录必须存在。不合规的插件被跳过并记入目录错误（/catalog/errors），
// 不拖垮其他插件与模式。插件根：内置 appRoot/plugins + 用户 userRoot/plugins。
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
)

// SidePanel 右栏面板槽位声明（纯数据：id/label，引擎不解释，桌面壳按 id
// 绑定自己的面板组件；未知 id 桌面壳忽略）。
type SidePanel struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// MCPServer MCP 服务器声明（stdio 用 command/args/env，远程用 url + headers，
// 二选一）。name 全局唯一、限 [A-Za-z0-9_-]（进工具名 mcp__<name>__<tool>）。
// command/args/env/url/headers 中的 ${PLUGIN_DIR} 展开为插件目录，其余
// ${VAR} 取引擎进程环境变量（密钥不落清单）；stdio 进程工作目录为插件目录。
type MCPServer struct {
	Name    string            `json:"name"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	URL     string            `json:"url,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
}

// Plugin 一个能力插件（清单字段 + 解析后的绝对路径）。
type Plugin struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Toolsets    []string    `json:"toolsets,omitempty"`   // 原生工具集引用（toolsets.go 注册表的 key）
	Rules       string      `json:"rules,omitempty"`      // 领域规范文件（相对插件目录）
	Skills      string      `json:"skills,omitempty"`     // 技能目录（相对插件目录）
	Agents      string      `json:"agents,omitempty"`     // 子代理目录（相对插件目录）
	MCPServers  []MCPServer `json:"mcpServers,omitempty"` // MCP 服务器声明
	SidePanels  []SidePanel `json:"sidePanels,omitempty"` // 右栏面板槽位（桌面壳消费）

	Origin    string      `json:"origin"`    // bundled | user（解析产物，非清单字段）
	Dir       string      `json:"dir"`       // 插件目录绝对路径（解析产物，非清单字段）
	Disabled  bool        `json:"disabled"`  // 用户停用（解析产物，非清单字段；见 disabledSetFile）
	AgentDefs []*AgentDef `json:"agentDefs"` // agents 目录解析出的子代理（解析产物）
}

// pluginManifest plugin.json 的严格解码形状（不含解析产物字段）。
type pluginManifest struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Toolsets    []string    `json:"toolsets"`
	Rules       string      `json:"rules"`
	Skills      string      `json:"skills"`
	Agents      string      `json:"agents"`
	MCPServers  []MCPServer `json:"mcpServers"`
	SidePanels  []SidePanel `json:"sidePanels"`
}

// RulesPath 领域规范绝对路径（空 = 未声明）。
func (p *Plugin) RulesPath() string { return p.resolve(p.Rules) }

// SkillsPath 技能目录绝对路径（空 = 未声明）。
func (p *Plugin) SkillsPath() string { return p.resolve(p.Skills) }

// AgentsPath 子代理目录绝对路径（空 = 未声明）。
func (p *Plugin) AgentsPath() string { return p.resolve(p.Agents) }

func (p *Plugin) resolve(rel string) string {
	if rel == "" {
		return ""
	}
	return filepath.Join(p.Dir, filepath.FromSlash(rel))
}

// disabledSetFile 用户停用集：<userRoot>/plugins-disabled.json（id 数组）。
// 与清单解耦：停用是用户运行期决策，不改插件文件。
func disabledSetFile() string { return filepath.Join(userRoot(), "plugins-disabled.json") }

// loadDisabledSet 读停用集（文件缺失/损坏 = 空集，不阻塞加载）。
func loadDisabledSet() map[string]bool {
	b, err := os.ReadFile(disabledSetFile())
	if err != nil {
		return map[string]bool{}
	}
	var ids []string
	if json.Unmarshal(b, &ids) != nil {
		return map[string]bool{}
	}
	set := map[string]bool{}
	for _, id := range ids {
		set[id] = true
	}
	return set
}

// saveDisabledSet 写停用集（排序稳定；空集写空数组）。
func saveDisabledSet(set map[string]bool) error {
	ids := make([]string, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	b, err := json.MarshalIndent(ids, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(disabledSetFile()), 0o755); err != nil {
		return err
	}
	return os.WriteFile(disabledSetFile(), b, 0o644)
}

// LoadPlugins 扫描全部插件根（内置 → 用户，同 id 用户覆盖内置；无
// plugin.json 的目录不是插件包）。单个清单不合规只记错误跳过（按 id 排序）。
// 用户停用集内的插件照常加载但标记 Disabled——对模式隐形（见 resolveMode），
// 不参与装配（UsedPlugins），清单文件本身不动。
func LoadPlugins() ([]*Plugin, []LoadError) {
	byID := map[string]*Plugin{}
	var errs []LoadError
	disabled := loadDisabledSet()
	for _, root := range assetRoots("plugins", "FLAI_PLUGINS_DIR") {
		entries, err := os.ReadDir(root.Dir)
		if err != nil {
			if !os.IsNotExist(err) { // 无插件目录 = 零插件
				errs = append(errs, LoadError{Kind: "plugin", File: root.Dir, Err: fmt.Sprintf("插件目录不可读: %v", err)})
			}
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			dir := filepath.Join(root.Dir, e.Name())
			manifest := filepath.Join(dir, "plugin.json")
			if _, err := os.Stat(manifest); err != nil {
				continue
			}
			p, err := loadPlugin(dir, manifest)
			if err != nil {
				errs = append(errs, LoadError{Kind: "plugin", ID: e.Name(), File: manifest, Err: err.Error()})
				continue
			}
			p.Origin = root.Origin
			p.Disabled = disabled[p.ID]
			byID[p.ID] = p
		}
	}
	plugins := make([]*Plugin, 0, len(byID))
	for _, p := range byID {
		plugins = append(plugins, p)
	}
	sort.Slice(plugins, func(i, j int) bool { return plugins[i].ID < plugins[j].ID })
	return plugins, errs
}

// loadPlugin 严格解码并校验单个插件清单。
func loadPlugin(dir, manifest string) (*Plugin, error) {
	var m pluginManifest
	if err := decodeStrict(manifest, &m); err != nil {
		return nil, err
	}
	name := filepath.Base(dir)
	if m.ID == "" {
		m.ID = name
	}
	if m.ID != name {
		return nil, fmt.Errorf("插件 %s: id %q 必须与目录名一致", name, m.ID)
	}
	if m.Name == "" {
		return nil, fmt.Errorf("插件 %s: 缺少 name", m.ID)
	}
	p := &Plugin{
		ID: m.ID, Name: m.Name, Description: m.Description,
		Toolsets: m.Toolsets, Rules: m.Rules, Skills: m.Skills, Agents: m.Agents,
		MCPServers: m.MCPServers, SidePanels: m.SidePanels, Dir: dir,
	}
	for _, ts := range p.Toolsets {
		if _, ok := toolsetRegistry[ts]; !ok {
			return nil, fmt.Errorf("插件 %s: 未知工具集 %q（可用: %v）", p.ID, ts, knownToolsets())
		}
	}
	for field, path := range map[string]string{"rules": p.RulesPath(), "skills": p.SkillsPath(), "agents": p.AgentsPath()} {
		if path == "" {
			continue
		}
		if _, err := os.Stat(path); err != nil {
			return nil, fmt.Errorf("插件 %s: %s 指向的 %s 不存在", p.ID, field, path)
		}
	}
	for _, s := range p.MCPServers {
		if s.Name == "" || (s.Command == "") == (s.URL == "") {
			return nil, fmt.Errorf("插件 %s: mcpServers 每项须有 name，且 command 与 url 二选一", p.ID)
		}
		if !idPattern.MatchString(s.Name) {
			return nil, fmt.Errorf("插件 %s: MCP 服务器名 %q 只能含字母、数字、_、-", p.ID, s.Name)
		}
		if s.Command != "" && len(s.Headers) > 0 {
			return nil, fmt.Errorf("插件 %s: MCP 服务器 %s 是 stdio 形态，headers 只用于 url 形态", p.ID, s.Name)
		}
		if s.URL != "" && (len(s.Args) > 0 || len(s.Env) > 0) {
			return nil, fmt.Errorf("插件 %s: MCP 服务器 %s 是 url 形态，args/env 只用于 command 形态", p.ID, s.Name)
		}
	}
	for _, sp := range p.SidePanels {
		if sp.ID == "" || sp.Label == "" {
			return nil, fmt.Errorf("插件 %s: sidePanels 每项须有 id 与 label", p.ID)
		}
	}
	defs, err := loadAgentDefs(p.ID, p.AgentsPath())
	if err != nil {
		return nil, err
	}
	p.AgentDefs = defs
	if p.AgentDefs == nil {
		p.AgentDefs = []*AgentDef{}
	}
	return p, nil
}

// decodeStrict 读取 JSON 清单并严格解码（未知字段报错——拼错的字段名
// 不能被静默忽略）。
func decodeStrict(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("清单 %s 不合规: %w", path, err)
	}
	return nil
}

// pluginsRoutes 插件发现端点（设置页插件清单；附带引用该插件的模式与
// MCP 服务器运行状态）。
func pluginsRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /plugins": func(w http.ResponseWriter, r *http.Request) {
			type pluginItem struct {
				*Plugin
				RulesFile string            `json:"rulesFile,omitempty"` // 规范文件绝对路径（设置页预览）
				UsedBy    []string          `json:"usedBy"`
				MCPStatus []mcpServerStatus `json:"mcpStatus"`
			}
			c := catalog()
			items := []pluginItem{}
			for _, p := range c.Plugins {
				items = append(items, pluginItem{Plugin: p, RulesFile: p.RulesPath(), UsedBy: c.PluginUsedBy(p.ID), MCPStatus: mcpHub.forPlugin(p.ID)})
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"plugins": items, "errors": c.errorsOf("plugin", "agent", "mcp")})
		},
		// POST /plugins/{id}/enabled 插件启停（设置页开关）：写用户停用集
		// → 停用即撤销该插件全部已装配资产（子代理下线 / MCP 断开 / 工具
		// 隐藏）→ reload 对账收敛。不打断在跑的会话（下一轮生效）。
		"POST /plugins/{id}/enabled": func(w http.ResponseWriter, r *http.Request) {
			if engineApp == nil {
				http.Error(w, "引擎未就绪", http.StatusServiceUnavailable)
				return
			}
			id := r.PathValue("id")
			var req struct {
				Enabled bool `json:"enabled"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "请求体解析失败: "+err.Error(), http.StatusBadRequest)
				return
			}
			found := false
			for _, p := range catalog().Plugins {
				if p.ID == id {
					found = true
					break
				}
			}
			if !found {
				http.Error(w, "插件不存在: "+id, http.StatusNotFound)
				return
			}
			set := loadDisabledSet()
			if req.Enabled {
				delete(set, id)
			} else {
				set[id] = true
				pluginLifecycle.disposePlugin(id) // 立即下线其资产（撤销器兜住 MCP 连接）
			}
			if err := saveDisabledSet(set); err != nil {
				http.Error(w, "写停用集失败: "+err.Error(), http.StatusInternalServerError)
				return
			}
			c, err := reloadCatalog(engineApp)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnprocessableEntity)
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
				return
			}
			modes := make([]string, 0, len(c.Modes))
			for _, m := range c.Modes {
				modes = append(modes, m.ID)
			}
			writeJSON(w, map[string]any{"ok": true, "id": id, "enabled": req.Enabled, "modes": modes, "errors": c.Errors})
		},
	}
}
