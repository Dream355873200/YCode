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
//	agents/      子代理定义目录（声明位，装配待 agents 系统落地）
//
// 校验严格：id 必须等于目录名、引用的工具集必须在注册表、声明的
// 文件/目录必须存在——清单写错拒绝启动，不静默丢能力。
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

// MCPServer MCP server 声明（stdio 用 command/args/env，远程用 url，二选一）。
// 声明位：MCP client 落地前只做校验与展示，不连接。
type MCPServer struct {
	Name    string            `json:"name"`
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	URL     string            `json:"url,omitempty"`
}

// Plugin 一个能力插件（清单字段 + 解析后的绝对路径）。
type Plugin struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Toolsets    []string    `json:"toolsets,omitempty"`   // 原生工具集引用（toolsets.go 注册表的 key）
	Rules       string      `json:"rules,omitempty"`      // 领域规范文件（相对插件目录）
	Skills      string      `json:"skills,omitempty"`     // 技能目录（相对插件目录）
	Agents      string      `json:"agents,omitempty"`     // 子代理定义目录（相对插件目录；声明位）
	MCPServers  []MCPServer `json:"mcpServers,omitempty"` // MCP server 声明（声明位）
	SidePanels  []SidePanel `json:"sidePanels,omitempty"` // 右栏面板槽位（桌面壳消费）

	Dir string `json:"dir"` // 插件目录绝对路径（解析产物，非清单字段）
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

// pluginsDir 插件根目录定位：FLAI_PLUGINS_DIR > 应用根/plugins。
func pluginsDir() string {
	if v := os.Getenv("FLAI_PLUGINS_DIR"); v != "" {
		return v
	}
	return filepath.Join(appRoot(), "plugins")
}

// LoadPlugins 扫描插件根目录下全部插件包（按 id 排序；无 plugin.json 的
// 目录不是插件包，跳过）。任一清单不合规即返回错误。
func LoadPlugins() ([]*Plugin, error) {
	root := pluginsDir()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // 无插件目录 = 零插件
		}
		return nil, fmt.Errorf("插件目录不可读 %s: %w", root, err)
	}
	var plugins []*Plugin
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(root, e.Name())
		manifest := filepath.Join(dir, "plugin.json")
		if _, err := os.Stat(manifest); err != nil {
			continue
		}
		p, err := loadPlugin(dir, manifest)
		if err != nil {
			return nil, err
		}
		plugins = append(plugins, p)
	}
	sort.Slice(plugins, func(i, j int) bool { return plugins[i].ID < plugins[j].ID })
	return plugins, nil
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
	}
	for _, sp := range p.SidePanels {
		if sp.ID == "" || sp.Label == "" {
			return nil, fmt.Errorf("插件 %s: sidePanels 每项须有 id 与 label", p.ID)
		}
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

// pluginsRoutes 插件发现端点（设置页插件清单；附带引用该插件的模式）。
func pluginsRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /plugins": func(w http.ResponseWriter, r *http.Request) {
			type pluginItem struct {
				*Plugin
				UsedBy []string `json:"usedBy"`
			}
			items := []pluginItem{}
			for _, p := range catalog.Plugins {
				used := []string{}
				for _, m := range catalog.Modes {
					for _, pid := range m.Plugins {
						if pid == p.ID {
							used = append(used, m.ID)
						}
					}
				}
				items = append(items, pluginItem{Plugin: p, UsedBy: used})
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"plugins": items})
		},
	}
}
