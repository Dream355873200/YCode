package main

// provider/scripted 驱动的插件子代理回路测试（GoAgent v0.14 B6 测试基建）。
// 引擎此前只有目录/守卫级测试（catalog / bashguard / userassets），模型回路
// 从未被端到端验证过——scripted 让「子代理白名单在真实 agent 循环里被强制
// 执行」可以确定性验证：脚本模型按序应答，不用真 LLM、不烧 token。

import (
	"context"
	"testing"

	goagent "github.com/Dream355873200/GoAgent"
	"github.com/Dream355873200/GoAgent/provider/scripted"
)

// TestBuildAgentToolRejectsUnsafeTools 装配期护栏：未注册工具、非只读工具、
// 属于插件未引用工具集的工具，都要在构造子代理时被拒绝。
func TestBuildAgentToolRejectsUnsafeTools(t *testing.T) {
	app := goagent.New(goagent.WithProvider(scripted.New()))

	type lookupArgs struct {
		Query string `json:"query"`
	}
	app.ReplaceTool("doc_lookup", goagent.ToolDef{
		Description: "查文档（只读）",
		Input:       lookupArgs{},
		Permission:  goagent.ReadOnly,
		Execute:     func(goagent.Context, lookupArgs) (string, error) { return "文档内容", nil },
	})

	p := &Plugin{ID: "docs"}
	// 未注册的工具
	if _, err := buildAgentTool(app, p, &AgentDef{Name: "a1", Tools: []string{"no_such_tool"}}); err == nil {
		t.Fatal("未注册工具应被拒绝")
	}
	// 已注册但非只读（Normal = 首次询问）——子代理工具调用不经审批，必须拒收
	if _, err := buildAgentTool(app, p, &AgentDef{Name: "a2", Tools: []string{"doc_lookup", "write_file"}}); err == nil {
		t.Fatal("含非只读工具应被拒绝")
	}
	// 工具集工具且插件未引用该工具集（toolsetOwner 是注册表静态派生的全局）
	var owned string
	for name := range toolsetOwner {
		owned = name
		break
	}
	if owned != "" {
		if _, err := buildAgentTool(app, p, &AgentDef{Name: "a3", Tools: []string{owned}}); err == nil {
			t.Fatalf("工具集工具 %s 在插件未引用该工具集时应被拒绝", owned)
		}
	}
}

// TestPluginSubagentToolWhitelistEnforced 运行期护栏：子代理只能用白名单内
// 的工具——脚本让子代理先调白名单外的 write_file（应得到「未知工具」错误
// 结果而不是执行），再调白名单内的 doc_lookup（应真正执行）。
func TestPluginSubagentToolWhitelistEnforced(t *testing.T) {
	called := map[string]bool{}

	type lookupArgs struct {
		Query string `json:"query"`
	}
	type writeArgs struct {
		Path string `json:"path"`
		Body string `json:"body"`
	}

	// 主 agent：派发子代理后收尾；子代理（按系统提示分流）：先越权再合规
	m := scripted.New(
		scripted.Tool("Agent_researcher", map[string]any{"task": "研究 X"}),
		scripted.Text("完成"),
	)
	m.Route(scripted.SystemContains("研究子代理测试系统提示"),
		scripted.Tool("write_file", map[string]any{"path": "x.txt", "body": "越权"}),
		scripted.Tool("doc_lookup", map[string]any{"query": "X"}),
		scripted.Text("查完了"),
	)

	app := goagent.New(goagent.WithProvider(m))

	app.ReplaceTool("doc_lookup", goagent.ToolDef{
		Description: "查文档（只读）",
		Input:       lookupArgs{},
		Permission:  goagent.ReadOnly,
		Execute:     func(goagent.Context, lookupArgs) (string, error) { called["doc_lookup"] = true; return "文档内容", nil },
	})
	app.ReplaceTool("write_file", goagent.ToolDef{
		Description: "写文件（有副作用）",
		Input:       writeArgs{},
		Permission:  goagent.Normal,
		Execute:     func(goagent.Context, writeArgs) (string, error) { called["write_file"] = true; return "written", nil },
	})

	p := &Plugin{ID: "docs"}
	def, err := buildAgentTool(app, p, &AgentDef{
		Name:     "researcher",
		Prompt:   "研究子代理测试系统提示",
		Tools:    []string{"doc_lookup"},
		MaxTurns: 6,
	})
	if err != nil {
		t.Fatalf("buildAgentTool: %v", err)
	}
	app.ReplaceTool("Agent_researcher", def)

	for ev := range app.Run(context.Background(), "研究 X 主题") {
		if ev.Type == goagent.EventError {
			t.Fatalf("运行错误: %v", ev.Error)
		}
	}
	m.AssertDone(t)
	if called["write_file"] {
		t.Fatal("白名单外的写工具被执行了——子代理隔离失效")
	}
	if !called["doc_lookup"] {
		t.Fatal("白名单内的只读工具未被调用")
	}
}
