// flai-engine 是 amobileCreater 产品的执行引擎：
// 基于 goagent（GitHub: Dream355873200/GoAgent）构建的 Flutter AI 开发 daemon。
//
// 以 HTTP/SSE 服务形态运行，供桌面壳（Electron）或 CLI 调用。
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
	// 具名导入即触发 builtin init()（注册 Read/Write/Edit 等内置工具 provider）；
	// ManagementTools（含 Skill 工具）也需要具名引用。
	builtin "github.com/Dream355873200/GoAgent/builtin"
	"github.com/Dream355873200/GoAgent/skill"

	"github.com/amobileCreater/engine/internal/tools"
)

// autoApprover 无人值守模式的审批器：全部放行并记录日志。
// MVP 阶段引擎在本地沙箱项目目录内工作，读写均限于该项目；
// 后续接入桌面壳时替换为转发到 UI 的 HTTP 审批器（/approve 端点已就绪）。
type autoApprover struct{}

func (autoApprover) Approve(toolName, input string, p goagent.Permission) (allow, alwaysAllow bool) {
	log.Printf("[approve] 自动放行: %s (perm=%s)", toolName, p)
	return true, false
}

// domainRulesPath 是引擎领域规范（反偷懒条款 / analyze 循环 / 安全基线）。
// 不用 WithSystemPrompt：那会整体覆盖 goagent 的七段默认提示词体系
// （identity/doing_tasks/using_tools/tone…），导致模型行为退化。
// 领域规范经 WithProjectContext 以「项目级规范文件」身份注入（等同 CLAUDE.md）。
var domainRulesPath string
var deviceCtxPath string  // 动态设备状态上下文（每次 /chat 刷新，WithProjectContext 现读现用）
var globalSkillsDir string // 全局 skill 目录（仓库 knowledge/skills/，母本唯一真源）

func init() {
	_, file, _, _ := runtime.Caller(0)
	domainRulesPath = filepath.Join(filepath.Dir(file), "AGENTS.md")
	deviceCtxPath = filepath.Join(filepath.Dir(file), "DEVICE.md")
	// 全局 skill：从 main.go 位置上溯找仓库根（cmd/flai-engine/ → engine/ → 仓库根）。
	// FLAI_GLOBAL_SKILLS 可覆盖（打包发行时指向安装目录）。
	if envOr("FLAI_GLOBAL_SKILLS", "") != "" {
		globalSkillsDir = os.Getenv("FLAI_GLOBAL_SKILLS")
	} else {
		globalSkillsDir = filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(file))), "knowledge", "skills")
	}
}

// refreshDeviceCtx 探测 adb 设备并写 DEVICE.md（会话上下文文件）。
// 模型每次会话看到最新状态：有设备 → 优先装机实测；无设备 → 声明跳过。
func refreshDeviceCtx() {
	status := tools.DeviceStatus()
	content := fmt.Sprintf("# 当前设备状态（自动探测，每次会话刷新）\n\n%s\n", status)
	_ = os.WriteFile(deviceCtxPath, []byte(content), 0o644)
}

func main() {
	addr := flag.String("addr", envOr("FLAI_ADDR", "127.0.0.1:8420"), "HTTP 监听地址")
	apiKey := flag.String("api-key", os.Getenv("FLAI_API_KEY"), "LLM API 密钥")
	baseURL := flag.String("base-url", envOr("FLAI_BASE_URL", "http://localhost:11434/v1"), "OpenAI 兼容 API 地址")
	model := flag.String("model", envOr("FLAI_MODEL", "qwen2.5:7b"), "模型名称")
	contextWindow := flag.Int("context-window", envOrInt("FLAI_CONTEXT_WINDOW", 1_000_000), "模型上下文窗口 token 数（决定压缩阈值，须与真实模型一致）")
	maxOutput := flag.Int("max-output-tokens", envOrInt("FLAI_MAX_OUTPUT_TOKENS", 393216), "模型最大输出 token 数（推理模型的 reasoning 也占此额度，默认 4096 会导致正文被截断）")
	flag.Parse()

	app := goagent.New(
		goagent.ProviderConfig{
			Type:            "openai", // OpenAI 兼容协议：Ollama/OpenRouter/GLM/DeepSeek 等均可用
			Model:           *model,
			APIKey:          *apiKey,
			BaseURL:         *baseURL,
			ContextWindow:   *contextWindow, // 不设则 provider 默认 32768 → 压缩阈值 ~10K，历史被疯狂裁剪导致模型原地打转
			MaxOutputTokens: *maxOutput,     // 不设则 provider 默认 4096 → 推理模型思考占满后正文为空，表现为「探索完就停」
		},
		goagent.WithProjectContext(domainRulesPath), // 领域规范注入（不覆盖默认 prompt 体系）
		goagent.WithProjectContext(deviceCtxPath),   // 动态设备状态（每次会话现读现用）
		goagent.WithBuiltinTools(),                  // Read/Write/Edit/Glob/Grep/Bash/WebSearch 等
		goagent.WithTaskTools(),                     // TaskCreate/TaskUpdate/TaskList → 左栏任务流数据源
		goagent.WithPlanTools(),                     // EnterPlanMode/ExitPlanMode → Agent 计划页签（计划存 .yume/plans/）
		goagent.WithApprover(autoApprover{}),
		goagent.WithMaxTurns(80),
		goagent.WithCostTracking(),
	)

	// 注册 Flutter 领域工具
	name, def := tools.NewFlutterTool()
	app.Tool(name, def)

	// 注册复合自动化测试工具集（L3 语义树/L4 视觉/L6 网络联调）：
	// ui_tree / tap / swipe / type / back / wait_for / screenshot /
	// screen_diff / logcat / net
	for _, t := range []struct{ name string; def goagent.ToolDef }{
		reg(tools.NewUITreeTool()), reg(tools.NewTapTool()), reg(tools.NewSwipeTool()),
		reg(tools.NewTypeTool()), reg(tools.NewBackTool()), reg(tools.NewWaitForTool()),
		reg(tools.NewScreenshotTool()), reg(tools.NewScreenDiffTool()),
		reg(tools.NewLogcatTool()), reg(tools.NewNetTool()),
		reg(tools.NewTestReportTool()),
	} {
		app.Tool(t.name, t.def)
	}
	// L5 视觉裁决：仅 FLAI_VISION=1 注册（模型必须支持图片输入；
	// 不支持时工具不存在，模型不会尝试调用）
	if tools.VisionEnabled() {
		n, d := tools.NewVisionAskTool()
		app.Tool(n, d)
		fmt.Println("  视觉裁决: 已启用（FLAI_VISION=1）")
	}

	// 中断链路：桌面壳「⏹ 终止」按钮 → POST /interrupt → 取消正在执行的任务
	app.SetInterruptHandler(goagent.NewInterruptHandler())

	// Skill 系统：项目 .yume/commands/ + 全局 knowledge/skills/ 双层发现。
	// 全局目录是 skill 母本的唯一真源（testing.md 等更新即时生效，老项目
	// 无需同步拷贝）；项目同名 skill 覆盖全局（Discover 先扫项目后扫全局，
	// 后者 map 覆盖前者——除内置外）。每 30s 重扫兜底会话中途新增的文件。
	skillReg := skill.NewRegistry(wdOrEmpty(), globalSkillsDir)
	_ = skillReg.Discover()
	for _, t := range builtin.ManagementTools(builtin.ManagementDeps{SkillRegistry: skillReg}) {
		app.Tool(t.Name, t.Def)
	}
	go func() {
		t := time.NewTicker(30 * time.Second)
		defer t.Stop()
		for range t.C {
			_ = skillReg.Discover()
		}
	}()

	// 动态设备状态：每 10s 刷新 DEVICE.md（会话上下文现读现用——模型开工即知
	// 有无设备，有则优先装机实测）
	refreshDeviceCtx()
	go func() {
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		for range t.C {
			refreshDeviceCtx()
		}
	}()

	fmt.Printf("flai-engine 启动\n  模型: %s @ %s\n  监听: http://%s\n", *model, *baseURL, *addr)
	if err := app.RunHTTP(*addr); err != nil {
		log.Fatalf("HTTP 服务退出: %v", err)
	}
}

// wdOrEmpty 当前工作目录（引擎 cwd = 绑定的项目目录；拿不到给空串）。
func wdOrEmpty() string {
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return wd
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// reg 适配 (name, def) 双返回值工具构造器到表格初始化。
func reg(name string, def goagent.ToolDef) struct{ name string; def goagent.ToolDef } {
	return struct{ name string; def goagent.ToolDef }{name, def}
}

func envOrInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
