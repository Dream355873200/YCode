// flai-engine 是 amobileCreater 产品的执行引擎：
// 基于 goagent（GitHub: Dream355873200/GoAgent）构建的 AI 开发 daemon。
// 能力按「工具集 → 插件 → 模式」分层装配，模式是会话级的（见 catalog.go）。
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
	"github.com/Dream355873200/GoAgent/task"

	"github.com/amobileCreater/engine/internal/tools"
)

var deviceCtxPath string   // 动态设备状态上下文（device 工具集按会话注入，WithSessionProjectContext 现读现用）
var globalSkillsDir string // 全局 skill 目录（应用根 skills/，对所有模式生效）

// sessMap 会话绑定（项目目录 + 模式；main 创建，各会话级解析器读它）。
var sessMap *sessionMap

// enginePermHandler 审批处理器（teams.go 据此订阅成员会话的权限请求，
// 转发进群聊走用户终审）。
var enginePermHandler *goagent.PermissionHandler

func init() {
	_, file, _, _ := runtime.Caller(0)
	// DEVICE.md 是设备状态的会话上下文文件（仅注入启用 device 工具集的会话）
	deviceCtxPath = filepath.Join(filepath.Dir(file), "DEVICE.md")
	// 全局 skill 目录：应用根 skills/。资产随应用安装目录走（见 layout.go），
	// 不落用户家目录；FLAI_GLOBAL_SKILLS 可覆盖。
	if envOr("FLAI_GLOBAL_SKILLS", "") != "" {
		globalSkillsDir = os.Getenv("FLAI_GLOBAL_SKILLS")
	} else {
		globalSkillsDir = filepath.Join(appRoot(), "skills")
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
	modeID := flag.String("mode", envOr("FLAI_MODE", "code"), "默认模式（未绑定模式的会话使用；模式是会话级的，见 session-map.json）")
	flag.Parse()

	// 会话绑定：单引擎多项目、多模式并存的地基。桌面壳把每个 session
	// 对应的项目路径与模式写进 ~/.amobilecreater/session-map.json；引擎
	// 解析后注入 ctx.WorkDir——Bash 的 cmd.Dir、Read/Write/Edit 的相对路径、
	// 领域工具的项目根全部按会话扎根；模式决定会话可见的能力（见 catalog.go）。
	sessMap = newSessionMap()

	// 任务存储按会话隔离（task 跟随 session）：落盘到各项目的
	// .yume/tasks/，闲置 10 分钟回收内存分区（数据保留在磁盘）。
	// 团队成员会话扎根到其团队所在项目（teamSessionDir 优先）。
	taskStore := task.NewSessionStore(task.SessionStoreConfig{
		DirFn: func(sessionID string) string {
			if dir := teamSessionDir(sessionID); dir != "" {
				return filepath.Join(dir, ".yume", "tasks")
			}
			return filepath.Join(sessMap.resolve(sessionID), ".yume", "tasks")
		},
		IdleTTL: 10 * time.Minute,
	})

	// 能力目录：一次加载全部模式与插件（内置 + 用户资产根，逐项校验——
	// 坏项跳过并记错，只有无可用模式时拒绝启动）。模式是会话级的——
	// 不同会话可同时运行在不同模式下；POST /reload 热替换（见 reload.go）。
	configuredDefaultMode = *modeID
	cat, err := LoadCatalog(*modeID)
	if err != nil {
		log.Fatalf("加载模式/插件: %v", err)
	}
	setCatalog(cat)
	for _, e := range cat.Errors {
		log.Printf("[catalog] %s %s: %s", e.Kind, e.ID, e.Err)
	}

	// 模式无关的通用装配 + 会话级能力解析（细节见下方 append 段注释）。
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
		goagent.WithSessionPromptDir(teamAwarePromptDir),                           // 会话模式的提示词组（团队会话走角色卡，见 teams.go）
		goagent.WithSessionProjectContext(teamAwareContextFiles),                   // 会话模式的插件规范 + 工具集动态上下文（等同 CLAUDE.md 地位）
		goagent.WithSessionToolFilter(teamAwareToolVisible),                        // 会话只看得到本模式启用的工具集（团队会话按成员白名单）
		goagent.WithSessionRoleCard(teamRoleCard),                                  // 团队成员/队长会话的角色卡（身份层，见 teams.go）
		goagent.WithSessionPermissionMode(teamPermMode),                            // 团队会话的权限模式（成员 auto / leader 可配）
		goagent.WithBuiltinTools(),                                                 // Read/Write/Edit/Glob/Grep/Bash/WebSearch 等（base）
		goagent.WithTaskTools(),                                                    // TaskCreate/TaskUpdate/TaskList → 左栏任务流数据源
		goagent.WithTaskStore(taskStore),                                           // 按会话隔离 + 落盘 + 闲置回收
		goagent.WithPlanTools(),                                                    // EnterPlanMode/ExitPlanMode → Agent 计划页签（计划存 .yume/plans/）
		goagent.WithBgTaskTools(),                                                  // TaskOutput/TaskStop → 长命令后台执行
		goagent.WithSessionWorkDir(teamAwareWorkDir),                               // 会话→项目目录（Bash/文件工具/领域工具按会话扎根；团队成员扎根其团队项目）
		goagent.WithAskTools(),                                                     // AskUser 工具（开放提问）+ confirm 工具的回调底座
		goagent.WithSteering(),                                                     // 插话通道：对话「插话」按钮 / 编辑器写回通知走 guide 车道（工具批边界注入）
		goagent.WithPostCompactReminder(builtin.NewReadStateRehydrater()),          // 压缩后重水合最近已读文件（防 Edit 凭摘要残句拼 old_string）
		goagent.WithPostCompactReminder(assetRehydrater{resolve: sessMap.resolve}), // 压缩后重注 SPEC.md / 最新测试报告（范围契约与测试结论不失忆）
		goagent.WithApprover(newEnginePermHandler()),                               // 异步审批：permission_request 帧 → 前端审批卡（/approve 回传）
		goagent.WithPermissionMode(goagent.PermissionAcceptEdits),                  // 初始模式「自动编辑」：普通工具免问，危险操作问用户（UI 可切 plan/bypass）
		goagent.WithMaxTurns(80),
		goagent.WithCostTracking(),
		goagent.WithHTTPRoutes(userEditRoutes()), // 编辑器写回通知端点（/notify/user-edit，app 创建后经 engineApp 接线）
		goagent.WithHTTPRoutes(modesRoutes()),    // 模式发现端点（全部模式 + 聚合视图 + 工具集明细）
		goagent.WithHTTPRoutes(pluginsRoutes()),  // 插件发现端点（设置页插件清单 + MCP 状态）
		goagent.WithHTTPRoutes(mcpRoutes()),      // MCP 服务器状态端点
		goagent.WithHTTPRoutes(skillsRoutes()),   // 技能清单端点（按插件/全局归属）
		goagent.WithHTTPRoutes(promptsRoutes()),  // 提示词组端点（设置页管理提示词组）
		goagent.WithHTTPRoutes(reloadRoutes()),   // 能力目录热重载 + 目录错误
		goagent.WithHTTPRoutes(debugRoutes()),    // 诊断端点（卡死时导出 goroutine 调用栈）
		goagent.WithHTTPRoutes(teamsRoutes()),    // 团队端点（创建/列表/详情/群聊/插话/实时事件）
	}
	// 工具集装配：注册表内全部工具集进程内装一次（会话可见性由工具
	// 过滤器按模式裁剪——reload 后新模式引用任意工具集即生效）。options
	// 段并入装配列表（New 前），install 段待 app 创建后执行。
	var installs []func(*goagent.App)
	for _, ts := range knownToolsets() {
		installer := toolsetRegistry[ts]
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

	// Skill 系统：每个模式一份注册表（插件技能 > 全局 skills/），Skill 工具
	// 按会话模式取用（描述里的技能清单也随会话变化）；项目 .yume/commands/
	// 由 Skill 工具按会话工作目录现场读取、优先级最高。每 30s 重扫。
	skills.watch(30 * time.Second)
	for _, t := range builtin.ManagementTools(builtin.ManagementDeps{SkillRegistryFn: teamAwareSkillRegistry}) {
		app.Tool(t.Name, t.Def)
	}

	// 插件子代理：agents/*.md → Agent_<name>（只读工具集的独立 agent 循环，
	// 归属插件、按模式可见）。须在全部工具注册之后——引用的工具要已存在；
	// 校验失败的子代理跳过并记入目录错误。
	reloadMu.Lock()
	cat.Errors = append(cat.Errors, syncAgents(app, cat)...)
	reloadMu.Unlock()

	// 插件 MCP 服务器：后台并行连接，不阻塞启动；工具连上后按插件归属可见。
	syncPluginMCP(app, cat)
	defer stopPluginMCP()

	fmt.Printf("flai-engine 启动 · 默认模式 %s\n", cat.DefaultMode)
	for _, m := range cat.Modes {
		fmt.Printf("  模式 %s（%s）: 插件 %v · 工具集 %v · 子代理 %v\n", m.ID, m.Name, m.Plugins, m.Resolved.Toolsets, m.Resolved.Agents)
	}
	fmt.Printf("  模型: %s @ %s\n  监听: http://%s\n", *model, *baseURL, *addr)
	if err := app.RunHTTP(*addr); err != nil {
		stopPluginMCP()
		log.Fatalf("HTTP 服务退出: %v", err)
	}
}

// wdOrEmpty 当前工作目录（拿不到给空串）。
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
