// mode.go 产品模式（mode）：能力分层的装配层。
//
// 模式 = modes/<id>/mode.json，只做四件事：
//
//	prompts        引用一个提示词组（prompts/<name>/；省略 = 引擎内置通用 Agent 提示词）
//	plugins        引用一组能力插件（plugins/<id>/）——模式的全部能力都来自插件
//	projectFields  新建项目表单字段（桌面壳按声明渲染；必须含 folder 型 dir 字段）
//	scaffold       新建项目时的脚手架 id（桌面壳注册表；省略 = 打开已有目录）
//
// 模式不直接声明工具集/技能/规范/面板：这些由插件打包，模式按需组合。
// 引擎一次加载全部模式，模式是会话级的——每个会话按 session-map 绑定的
// mode 看到各自的工具、提示词、规范与技能，多模式会话并存互不干扰。
// 模式根：内置 appRoot/modes（FLAI_MODES_DIR 可替代）+ 用户 userRoot/modes（见 layout.go）。
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
)

// Mode 一个模式（清单字段 + 解析后的能力视图）。
type Mode struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Description   string         `json:"description,omitempty"`
	Prompts       string         `json:"prompts,omitempty"`  // 提示词组名（空 = 内置通用提示词）
	Plugins       []string       `json:"plugins"`            // 引用的插件 id（按序聚合）
	ProjectFields []ProjectField `json:"projectFields"`      // 新建项目表单字段（桌面壳消费）
	Scaffold      string         `json:"scaffold,omitempty"` // 脚手架 id（空 = 打开已有目录）

	Origin   string    `json:"origin"`   // bundled | user（解析产物，非清单字段）
	Dir      string    `json:"dir"`      // 模式包目录绝对路径（解析产物）
	Resolved *ModeView `json:"resolved"` // 插件聚合后的能力视图（解析产物，非清单字段）
}

// modeManifest mode.json 的严格解码形状。
type modeManifest struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Description   string         `json:"description"`
	Prompts       string         `json:"prompts"`
	Plugins       []string       `json:"plugins"`
	ProjectFields []ProjectField `json:"projectFields"`
	Scaffold      string         `json:"scaffold"`
}

// ProjectField 新建项目表单的一个字段。字段值原样交给桌面壳的脚手架
// （或直接写进项目注册表），引擎不解释语义。
type ProjectField struct {
	ID          string        `json:"id"`
	Label       string        `json:"label"`
	Type        string        `json:"type"` // text | textarea | folder | choice
	Required    bool          `json:"required,omitempty"`
	Placeholder string        `json:"placeholder,omitempty"`
	Hint        string        `json:"hint,omitempty"`
	Default     string        `json:"default,omitempty"`
	Options     []FieldOption `json:"options,omitempty"` // choice 专用
}

// FieldOption choice 字段的一个选项。
type FieldOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

var fieldTypes = map[string]bool{"text": true, "textarea": true, "folder": true, "choice": true}

// validateFields 表单字段校验：id 唯一、类型合法、choice 有选项且默认值
// 在选项内；必须有且只有 folder 型的 dir 字段（项目 = 目录）。
func validateFields(modeID string, fields []ProjectField) error {
	seen := map[string]bool{}
	for _, f := range fields {
		if f.ID == "" || f.Label == "" {
			return fmt.Errorf("模式 %s: projectFields 项缺少 id/label", modeID)
		}
		if seen[f.ID] {
			return fmt.Errorf("模式 %s: projectFields id %q 重复", modeID, f.ID)
		}
		seen[f.ID] = true
		if !fieldTypes[f.Type] {
			return fmt.Errorf("模式 %s: 字段 %s 类型 %q 非法（text|textarea|folder|choice）", modeID, f.ID, f.Type)
		}
		if f.ID == "dir" && f.Type != "folder" {
			return fmt.Errorf("模式 %s: dir 字段必须是 folder 类型", modeID)
		}
		if f.Type != "choice" {
			if len(f.Options) > 0 {
				return fmt.Errorf("模式 %s: 字段 %s 非 choice 类型不能声明 options", modeID, f.ID)
			}
			continue
		}
		if len(f.Options) == 0 {
			return fmt.Errorf("模式 %s: choice 字段 %s 缺少 options", modeID, f.ID)
		}
		okDefault := f.Default == ""
		for _, o := range f.Options {
			if o.Value == "" || o.Label == "" {
				return fmt.Errorf("模式 %s: 字段 %s 的选项缺少 value/label", modeID, f.ID)
			}
			okDefault = okDefault || o.Value == f.Default
		}
		if !okDefault {
			return fmt.Errorf("模式 %s: 字段 %s 默认值 %q 不在选项内", modeID, f.ID, f.Default)
		}
	}
	if !seen["dir"] {
		return fmt.Errorf("模式 %s: projectFields 必须声明 folder 型 dir 字段", modeID)
	}
	return nil
}

// ModeView 模式经插件聚合后的能力视图（去重保序：按插件引用顺序）。
// 引擎的会话级解析器与 /modes 端点共用同一份数据。
type ModeView struct {
	PromptDir  string      `json:"promptDir,omitempty"` // 提示词组绝对路径（空 = 内置）
	Toolsets   []string    `json:"toolsets"`            // 原生工具集
	Tools      []string    `json:"tools"`               // 领域工具名（工具集工具 + 子代理工具；MCP 工具见 /mcp）
	Rules      []string    `json:"rules"`               // 规范文件绝对路径（会话级注入）
	SkillDirs  []string    `json:"skillDirs"`           // 插件技能目录（全局 skills/ 另行追加）
	Agents     []string    `json:"agents"`              // 子代理名（工具名 Agent_<name>）
	MCPServers []MCPServer `json:"mcpServers"`          // MCP 服务器声明（连接状态见 /mcp）
	SidePanels []SidePanel `json:"sidePanels"`          // 右栏面板槽位

	contextFiles []string // 会话项目上下文 = Rules + 工具集附带的动态上下文
}

// HasToolset 模式是否启用某工具集。
func (m *Mode) HasToolset(name string) bool {
	return contains(m.Resolved.Toolsets, name)
}

// HasPlugin 模式是否引用某插件。
func (m *Mode) HasPlugin(id string) bool {
	return contains(m.Plugins, id)
}

// loadModes 扫描全部模式根（内置 → 用户，同 id 用户覆盖内置）并严格
// 解码清单（按 id 排序）。单个清单不合规只记错误跳过，不影响其他模式；
// 插件引用在 LoadCatalog 里解析校验。
func loadModes() ([]*Mode, []LoadError) {
	byID := map[string]*Mode{}
	var errs []LoadError
	for _, root := range assetRoots("modes", "FLAI_MODES_DIR") {
		entries, err := os.ReadDir(root.Dir)
		if err != nil {
			if !os.IsNotExist(err) {
				errs = append(errs, LoadError{Kind: "mode", File: root.Dir, Err: fmt.Sprintf("模式目录不可读: %v", err)})
			}
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			dir := filepath.Join(root.Dir, e.Name())
			manifest := filepath.Join(dir, "mode.json")
			if _, err := os.Stat(manifest); err != nil {
				continue // 无清单的目录不是模式包
			}
			m, err := loadMode(dir, manifest)
			if err != nil {
				errs = append(errs, LoadError{Kind: "mode", ID: e.Name(), File: manifest, Err: err.Error()})
				continue
			}
			m.Origin = root.Origin
			byID[m.ID] = m
		}
	}
	modes := make([]*Mode, 0, len(byID))
	for _, m := range byID {
		modes = append(modes, m)
	}
	sort.Slice(modes, func(i, j int) bool { return modes[i].ID < modes[j].ID })
	return modes, errs
}

// loadMode 严格解码并校验单个模式清单。
func loadMode(dir, manifest string) (*Mode, error) {
	var mm modeManifest
	if err := decodeStrict(manifest, &mm); err != nil {
		return nil, err
	}
	name := filepath.Base(dir)
	if mm.ID == "" {
		mm.ID = name
	}
	if mm.ID != name {
		return nil, fmt.Errorf("模式 %s: id %q 必须与目录名一致", name, mm.ID)
	}
	if mm.Name == "" {
		return nil, fmt.Errorf("模式 %s: 缺少 name", mm.ID)
	}
	if mm.Plugins == nil {
		mm.Plugins = []string{}
	}
	if err := validateFields(mm.ID, mm.ProjectFields); err != nil {
		return nil, err
	}
	return &Mode{
		ID: mm.ID, Name: mm.Name, Description: mm.Description,
		Prompts: mm.Prompts, Plugins: mm.Plugins,
		ProjectFields: mm.ProjectFields, Scaffold: mm.Scaffold, Dir: dir,
	}, nil
}

// resolveMode 把模式引用的插件聚合成能力视图。未知插件/提示词组、
// 重复引用都是清单错误。
func resolveMode(m *Mode, pluginByID map[string]*Plugin) (*ModeView, error) {
	v := &ModeView{
		Toolsets: []string{}, Tools: []string{}, Rules: []string{}, SkillDirs: []string{},
		Agents: []string{}, MCPServers: []MCPServer{}, SidePanels: []SidePanel{},
	}
	if m.Prompts != "" {
		if v.PromptDir = PromptGroupDir(m.Prompts); v.PromptDir == "" {
			return nil, fmt.Errorf("模式 %s: 提示词组 %q 不存在（可用: %v）", m.ID, m.Prompts, promptGroupNames())
		}
	}
	seenPlugin := map[string]bool{}
	seenToolset := map[string]bool{}
	seenPanel := map[string]bool{}
	for _, pid := range m.Plugins {
		if seenPlugin[pid] {
			return nil, fmt.Errorf("模式 %s: 插件 %q 重复引用", m.ID, pid)
		}
		seenPlugin[pid] = true
		p := pluginByID[pid]
		if p == nil {
			return nil, fmt.Errorf("模式 %s: 未知插件 %q（可用: %v）", m.ID, pid, pluginIDs(pluginByID))
		}
		for _, ts := range p.Toolsets {
			if seenToolset[ts] {
				continue
			}
			seenToolset[ts] = true
			v.Toolsets = append(v.Toolsets, ts)
			v.Tools = append(v.Tools, toolsetRegistry[ts].tools...)
		}
		if r := p.RulesPath(); r != "" {
			v.Rules = append(v.Rules, r)
		}
		if d := p.SkillsPath(); d != "" {
			v.SkillDirs = append(v.SkillDirs, d)
		}
		for _, d := range p.AgentDefs {
			v.Agents = append(v.Agents, d.Name)
			v.Tools = append(v.Tools, d.ToolName())
		}
		v.MCPServers = append(v.MCPServers, p.MCPServers...)
		for _, sp := range p.SidePanels {
			if !seenPanel[sp.ID] {
				seenPanel[sp.ID] = true
				v.SidePanels = append(v.SidePanels, sp)
			}
		}
	}
	v.contextFiles = append(v.contextFiles, v.Rules...)
	for _, ts := range v.Toolsets {
		if fn := toolsetRegistry[ts].context; fn != nil {
			v.contextFiles = append(v.contextFiles, fn()...)
		}
	}
	return v, nil
}

func pluginIDs(byID map[string]*Plugin) []string {
	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// modesRoutes 模式发现端点：全部模式（含聚合视图）+ 默认模式 +
// 工具集明细（工具名 + 运行期机制说明）。设置页与模式切换的数据源。
func modesRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /modes": func(w http.ResponseWriter, r *http.Request) {
			c := catalog()
			toolsets := map[string]map[string]any{}
			for id, ts := range toolsetRegistry {
				toolsets[id] = map[string]any{"tools": ts.tools, "notes": ts.notes}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"modes":       c.Modes,
				"defaultMode": c.DefaultMode,
				"toolsets":    toolsets,
				"errors":      c.errorsOf("mode"),
			})
		},
	}
}
