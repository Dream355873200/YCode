// agents.go 插件子代理：plugins/<id>/agents/<name>.md → Agent_<name> 工具。
//
// 子代理是主 agent 可委派的独立 agent 循环（独立历史、独立工具集、跑完只
// 回传结论），适合「多步检索/探索」这类会撑爆主对话上下文的任务。定义是
// 纯数据——一个 markdown 文件，frontmatter 声明元数据，正文即系统提示：
//
//	---
//	name: explore
//	description: 只读探索代码库，回答「X 在哪 / 怎么实现的」
//	tools: Read, Glob, Grep
//	maxTurns: 30
//	---
//	你是代码探索助手……
//
// 约束（装配时校验，违反的子代理被跳过并记入目录错误）：
//   - name 全局唯一，限 [A-Za-z0-9_-]；description、tools、正文必填
//   - tools 逗号分隔；只能引用只读工具（子代理的工具调用不经主循环审批），
//     且须是 base 工具或本插件工具集里的工具
//
// 工具名 Agent_<name> 归属声明它的插件：只有引用该插件的模式的会话可见。
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	goagent "github.com/Dream355873200/GoAgent"
	"github.com/Dream355873200/GoAgent/agent"
)

// AgentDef 一个插件子代理定义（frontmatter + 正文）。
type AgentDef struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Tools       []string `json:"tools"`
	MaxTurns    int      `json:"maxTurns,omitempty"`
	File        string   `json:"file"`
	Prompt      string   `json:"-"` // 正文（系统提示）
}

// ToolName 子代理在工具注册表里的名字。
func (d *AgentDef) ToolName() string { return "Agent_" + d.Name }

// idPattern MCP 服务器名 / 子代理名的合法字符集（进工具名，须满足函数名约束）。
var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// loadAgentDefs 读取插件 agents 目录下全部 <name>.md（README.md 除外，按名排序）。
func loadAgentDefs(pluginID, dir string) ([]*AgentDef, error) {
	if dir == "" {
		return nil, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("插件 %s: agents 目录不可读: %w", pluginID, err)
	}
	var defs []*AgentDef
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") || strings.EqualFold(e.Name(), "README.md") {
			continue
		}
		d, err := parseAgentDef(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("插件 %s: %w", pluginID, err)
		}
		defs = append(defs, d)
	}
	sort.Slice(defs, func(i, j int) bool { return defs[i].Name < defs[j].Name })
	return defs, nil
}

// parseAgentDef 解析单个子代理文件（结构校验；工具存在性与权限在装配时校验）。
func parseAgentDef(path string) (*AgentDef, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	body, fm := parseFrontmatter(string(data))
	d := &AgentDef{
		Name:        fm["name"],
		Description: fm["description"],
		File:        path,
		Prompt:      strings.TrimSpace(body),
	}
	if d.Name == "" {
		d.Name = strings.TrimSuffix(filepath.Base(path), ".md")
	}
	if !idPattern.MatchString(d.Name) {
		return nil, fmt.Errorf("子代理 %s: name %q 只能含字母、数字、_、-", path, d.Name)
	}
	if d.Description == "" {
		return nil, fmt.Errorf("子代理 %s: 缺少 description（主 agent 据此决定何时委派）", d.Name)
	}
	if d.Prompt == "" {
		return nil, fmt.Errorf("子代理 %s: 正文（系统提示）为空", d.Name)
	}
	for _, t := range strings.Split(fm["tools"], ",") {
		if t = strings.TrimSpace(t); t != "" {
			d.Tools = append(d.Tools, t)
		}
	}
	if len(d.Tools) == 0 {
		return nil, fmt.Errorf("子代理 %s: 缺少 tools（逗号分隔的只读工具名）", d.Name)
	}
	if v := fm["maxTurns"]; v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return nil, fmt.Errorf("子代理 %s: maxTurns %q 须为正整数", d.Name, v)
		}
		d.MaxTurns = n
	}
	return d, nil
}

// installedAgents 已注册进 app 的子代理工具名（跨 reload 对账用）。
var installedAgents = map[string]bool{}

// syncAgents 按目录对账插件子代理：被模式引用的插件的子代理注册（或覆盖）
// 为 Agent_<name> 工具；上一版装过、这一版不在（插件移除 / 未被引用 /
// 校验失败）的下线隐藏。校验失败的子代理记入返回的错误，不影响其他项。
// 须在全部工具（base + 工具集）注册之后调用——引用的工具要已存在。
// 调用方串行（启动 / reloadMu）。
func syncAgents(app *goagent.App, c *Catalog) []LoadError {
	var errs []LoadError
	want := map[string]bool{}
	for _, p := range c.UsedPlugins() {
		for _, d := range p.AgentDefs {
			def, err := buildAgentTool(app, p, d)
			if err != nil {
				errs = append(errs, LoadError{Kind: "agent", ID: d.Name, File: d.File, Err: err.Error()})
				continue
			}
			pluginTools.claim(d.ToolName(), p.ID) // 先登记归属，再注册
			app.ReplaceTool(d.ToolName(), def)
			want[d.ToolName()] = true
		}
	}
	for name := range installedAgents {
		if !want[name] {
			pluginTools.hide(name)
		}
	}
	installedAgents = want
	return errs
}

// buildAgentTool 校验子代理引用的工具（已注册、只读、工具集工具须属于本插件
// 引用的工具集）并构造工具定义。
func buildAgentTool(app *goagent.App, p *Plugin, d *AgentDef) (goagent.ToolDef, error) {
	for _, t := range d.Tools {
		if ts, owned := toolsetOwner[t]; owned && !contains(p.Toolsets, ts) {
			return goagent.ToolDef{}, fmt.Errorf("子代理 %s（插件 %s）: 工具 %s 属于工具集 %s，插件未引用该工具集", d.Name, p.ID, t, ts)
		}
		perm, ok := app.ToolPermission(t)
		if !ok {
			return goagent.ToolDef{}, fmt.Errorf("子代理 %s（插件 %s）: 工具 %s 未注册", d.Name, p.ID, t)
		}
		if perm != goagent.ReadOnly {
			return goagent.ToolDef{}, fmt.Errorf("子代理 %s（插件 %s）: 工具 %s 不是只读工具——子代理的工具调用不经审批，只能交出只读工具", d.Name, p.ID, t)
		}
	}
	tools, err := app.AgentTools(d.Tools...)
	if err != nil {
		return goagent.ToolDef{}, fmt.Errorf("子代理 %s（插件 %s）: %w", d.Name, p.ID, err)
	}
	def := app.AgentTool(agent.Definition{
		Name:         d.Name,
		Description:  d.Description,
		SystemPrompt: d.Prompt,
		Tools:        tools,
		MaxTurns:     d.MaxTurns,
	})
	// 工具已逐个校验为只读 → 子代理整体只读：计划模式可用、可与其他工具并行
	def.Permission = goagent.ReadOnly
	def.Effect = goagent.EffectReadOnly
	return def, nil
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
