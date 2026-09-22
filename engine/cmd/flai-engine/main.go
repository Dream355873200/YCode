// flai-engine 是 amobileCreater 产品的执行引擎：
// 基于 goagent（GitHub: Dream355873200/GoAgent）构建的 Flutter AI 开发 daemon。
//
// 以 HTTP/SSE 服务形态运行，供桌面壳（Electron）或 CLI 调用。
package main

import (
	"context"
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
	"github.com/Dream355873200/GoAgent/task"

	"github.com/amobileCreater/engine/internal/tools"
)

// domainRulesPath 是引擎领域规范（反偷懒条款 / 安全基线等），由模式包声明
// （modes/<id>/domain-rules.md，经 mode.json 的 engine.domainRules 指向）。
// 不用 WithSystemPrompt：那会整体覆盖 goagent 的七段默认提示词体系
// （identity/doing_tasks/using_tools/tone…），导致模型行为退化。
// 领域规范经 WithProjectContext 以「项目级规范文件」身份注入（等同 CLAUDE.md）。
var domainRulesPath string // 当前模式的领域规范（LoadMode 后赋值；空 = 不注入）
var deviceCtxPath string   // 动态设备状态上下文（每次 /chat 刷新，WithProjectContext 现读现用）
var globalSkillsDir string // 全局 skill 目录兜底（模式未声明 skillsDir 时回退）

// sessMap 会话→项目目录映射（main 创建；postcompact 等扩展端点按会话解析）。
var sessMap *sessionMap

func init() {
	_, file, _, _ := runtime.Caller(0)
	// DEVICE.md 是设备状态的会话上下文文件（flutter 模式专用，code 模式不写不注）
	deviceCtxPath = filepath.Join(filepath.Dir(file), "DEVICE.md")
	// 全局 skill 目录兜底（模式包未声明 skillsDir 时用；仓库根 knowledge/skills/）。
	// 从 main.go 位置定位仓库根：去掉文件名一层 + 上溯三级
	//（cmd/flai-engine/ → engine/ → 仓库根）。此前少上溯一级指到
	// engine/knowledge/skills（不存在），全局 skill 静默失效，此处修正。
	// FLAI_GLOBAL_SKILLS 可覆盖（打包发行时指向安装目录）。
	if envOr("FLAI_GLOBAL_SKILLS", "") != "" {
		globalSkillsDir = os.Getenv("FLAI_GLOBAL_SKILLS")
	} else {
		globalSkillsDir = filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(file)))), "knowledge", "skills")
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
	modeID := flag.String("mode", envOr("FLAI_MODE", "flutter"), "产品模式（modes/ 目录下的模式包 id，决定工具集/领域规范/技能目录）")
	flag.Parse()

	// 会话→项目映射：单引擎多项目的地基。桌面壳把每个 session 对应的
	// 项目路径写进 ~/.amobilecreater/session-map.json；引擎解析后注入
	// ctx.WorkDir——Bash 的 cmd.Dir、Read/Write/Edit 的相对路径、
	// flutter/测试工具的项目根全部按会话扎根（切项目不重启引擎）。
	sessMap = newSessionMap()

	// 任务存储按会话隔离（task 跟随 session）：落盘到各项目的
	// .yume/tasks/，闲置 10 分钟回收内存分区（数据保留在磁盘）。
	taskStore := task.NewSessionStore(task.SessionStoreConfig{
		DirFn:   func(sessionID string) string { return filepath.Join(sessMap.resolve(sessionID), ".yume", "tasks") },
		IdleTTL: 10 * time.Minute,
	})

	// 模式装配：领域工具集/领域规范/技能目录由模式包数据驱动（--mode 选择，
	// 缺省 flutter 保持既有行为；GET /modes 供桌面壳发现可用模式）。
	mode, err := LoadMode(*modeID)
	if err != nil {
		log.Fatalf("加载模式: %v", err)
	}
	domainRulesPath = mode.DomainRulesPath()

	// 模式无关的通用装配 + 按模式增补的领域装配（细节见下方 append 段注释）。
	// ProviderConfig 本身实现 Option，进切片统一展开。
	opts := []goagent.Option{
		goagent.ProviderConfig{
			Type:            "openai", // OpenAI 兼容协议：Ollama/OpenRouter/GLM/DeepSeek 等均可用
			Model:           *model,
			APIKey:          *apiKey,
			BaseURL:         *baseURL,
			ContextWindow:   *contextWindow, // 不设则 provider 默认 32768 → 压缩阈值 ~10K，历史被疯狂裁剪导致模型原地打转
			MaxOutputTokens: *maxOutput,     // 不设则 provider 默认 4096 → 推理模型思考占满后正文为空，表现为「探索完就停」
		},
		goagent.WithPromptDir(enginePromptDir()),                                    // 定制版系统提示词（engine/prompts/，缺的文件自动回退 goagent 嵌入默认值）
		goagent.WithBuiltinTools(),                                                  // Read/Write/Edit/Glob/Grep/Bash/WebSearch 等（base）
		goagent.WithTaskTools(),                                                     // TaskCreate/TaskUpdate/TaskList → 左栏任务流数据源
		goagent.WithTaskStore(taskStore),                                            // 按会话隔离 + 落盘 + 闲置回收
		goagent.WithPlanTools(),                                                     // EnterPlanMode/ExitPlanMode → Agent 计划页签（计划存 .yume/plans/）
		goagent.WithBgTaskTools(),                                                   // TaskOutput/TaskStop → 长命令后台执行
		goagent.WithSessionWorkDir(sessMap.resolve),                                 // 会话→项目目录（Bash/文件工具/领域工具按会话扎根）
		goagent.WithAskTools(),                                                      // AskUser 工具（开放提问）+ confirm 工具的回调底座
		goagent.WithSteering(),                                                      // 插话通道：对话「插话」按钮 / 编辑器写回通知走 guide 车道（工具批边界注入）
		goagent.WithPostCompactReminder(builtin.NewReadStateRehydrater()),           // 压缩后重水合最近已读文件（防 Edit 凭摘要残句拼 old_string）
		goagent.WithPostCompactReminder(assetRehydrater{resolve: sessMap.resolve}), // 压缩后重注 SPEC.md / 最新测试报告（范围契约与测试结论不失忆）
		goagent.WithApprover(goagent.NewPermissionHandler()), // 异步审批：permission_request 帧 → 前端审批卡（/approve 回传）
		goagent.WithPermissionMode(goagent.PermissionAcceptEdits), // 初始模式「自动编辑」：普通工具免问，危险操作问用户（UI 可切 plan/bypass）
		goagent.WithMaxTurns(80),
		goagent.WithCostTracking(),
		goagent.WithHTTPRoutes(userEditRoutes()), // 编辑器写回通知端点（/notify/user-edit，app 创建后经 engineApp 接线）
		goagent.WithHTTPRoutes(modesRoutes()),    // 模式发现端点（桌面壳渲染模式选择/新建项目表单）
	}
	if domainRulesPath != "" {
		opts = append(opts, goagent.WithProjectContext(domainRulesPath)) // 领域规范注入（不覆盖默认 prompt 体系）
	}
	// 领域工具集装配：按模式声明的 toolset 词查注册表分两段安装——
	// options 段并入装配列表（New 前），install 段待 app 创建后执行。
	// 未知词直接拒绝启动（mode.json 写错名字不能静默丢能力）。
	var installs []func(*goagent.App)
	for _, ts := range mode.Engine.Toolsets {
		installer, ok := toolsetRegistry[ts]
		if !ok {
			log.Fatalf("模式 %s 声明了未知工具集 %q（可用: %v）", mode.ID, ts, knownToolsets())
		}
		if installer.options != nil {
			opts = append(opts, installer.options()...)
		}
		if installer.install != nil {
			installs = append(installs, installer.install)
		}
	}

	app := goagent.New(opts...)

	// 领域装配后段：领域工具注册 / ReplaceTool / 运行期接线
	for _, install := range installs {
		install(app)
	}

	// 编辑器写回通知的 app 接线（路由已注册，handler 经此引用 app）
	engineApp = app

	// 对话内确认框：AskUserHandler（ask_user SSE 事件 → /askuser 回传），
	// confirm 工具（单选/多选/纯确认卡）经同一管道下发。
	// AskUser 用 ctx 感知注册：按 ctx.SessionID 把提问路由到发起 run 的
	// 活跃 SSE 连接——多轮会话后也不会被历史连接的残留消费者抢走帧。
	askHandler := goagent.NewAskUserHandler()
	app.SetAskUserHandler(askHandler)
	builtin.SetAskUserCallbackCtx(func(gctx goagent.Context, question string) (string, error) {
		// 传 gctx（内嵌 context.Context）：提问阻塞期间 run 被中断时，
		// /interrupt 的 cancel 会解除等待，避免会话卡死在提问上。
		return askHandler.AskSessionCtx(gctx, gctx.SessionID, question, nil)
	})

	// 对话内确认框：confirm 是模式无关的通用能力（单选/多选/纯确认卡，
	// 结构化载荷经 payload 字段下发；ctx 感知中断）。
	name, def := tools.NewConfirmTool(func(gctx goagent.Context, q string, payload map[string]any) (string, error) {
		return askHandler.AskSessionCtx(gctx, gctx.SessionID, q, payload)
	})
	app.Tool(name, def)

	// 中断链路：桌面壳「⏹ 终止」按钮 → POST /interrupt → 取消正在执行的任务
	app.SetInterruptHandler(goagent.NewInterruptHandler())

	// 任务分区闲置回收：每分钟扫一次，10 分钟没动静的分区逐出内存
	//（落盘数据保留，下次访问自动从磁盘恢复）。
	defer taskStore.StartSweeper(context.Background(), time.Minute)()

	// Skill 系统：项目 .yume/commands/ + 模式技能目录双层发现。模式包
	// 声明的 skillsDir 优先（flutter 指向 knowledge/skills/ 作为母本真源，
	// 更新即时生效、老项目无需同步拷贝）；未声明时回退全局兜底目录。
	// 项目同名 skill 覆盖模式层。每 30s 重扫兜底会话中途新增的文件。
	skillDir := mode.SkillsPath()
	if skillDir == "" {
		skillDir = globalSkillsDir
	}
	skillReg := skill.NewRegistry(wdOrEmpty(), skillDir)
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

	fmt.Printf("flai-engine 启动 · 模式 %s（%s）\n  模型: %s @ %s\n  监听: http://%s\n", mode.ID, mode.Name, *model, *baseURL, *addr)
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

// enginePromptDir 定制系统提示词目录（engine/prompts/）。
// 只放需要领域偏移的文件（identity/doing-tasks/tone-style/using-tools），
// 其余（actions/reminder/output-efficiency/compact/yolo）缺文件时 goagent
// 自动回退嵌入默认值——跟随库升级，不复制维护。
func enginePromptDir() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(file))), "prompts")
}

// reg 适配 (name, def) 双返回值工具构造器到表格初始化。
func reg(name string, def goagent.ToolDef) struct {
	name string
	def  goagent.ToolDef
} {
	return struct {
		name string
		def  goagent.ToolDef
	}{name, def}
}

func envOrInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
