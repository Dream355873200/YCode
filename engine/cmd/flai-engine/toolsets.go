// toolsets.go 原生工具集注册表：plugin.json 引用的 toolset 词 →
// 引擎侧具体装配动作的唯一权威映射。
//
// toolset 是能力分层的最底层（Go 代码实现的工具），插件引用它、模式经
// 插件间接获得它。注册表是机制（"怎么装"），清单是内容（"要什么"）：
// 新增工具集 = 写一个 install 函数 + 注册表加一行，tools 列出它注册的
// 全部工具名。plugin.json 出现表外的词视为清单错误，引擎拒绝启动。
//
// 装配是会话级的：被任一模式引用的工具集在进程内只装一次，工具归属
// （工具名 → 工具集）交给会话工具过滤器——会话只看得到自己模式启用的
// 工具集里的工具；不属于任何工具集的工具（base：文件/Bash/任务/计划/
// 提问…）对所有会话可见。
package main

import (
	"fmt"
	"log"
	"sort"
	"time"

	goagent "github.com/Dream355873200/GoAgent"

	"github.com/amobileCreater/engine/internal/tools"
)

// toolsetInstaller 一个工具集的完整装配。
//
//	options —— New 前段：观察者等进程级 Option（可空；对所有会话生效，
//	           须对未启用本工具集的会话无副作用）
//	install —— app 创建后的工具注册、ReplaceTool、运行期接线（可空）
//	context —— 启用本工具集的会话额外注入的上下文文件（可空）
//	tools   —— 本工具集注册的全部工具名（会话工具过滤的归属依据）
//	notes   —— 非工具资产说明（上下文注入 / Bash 加固等运行期机制）
type toolsetInstaller struct {
	options func() []goagent.Option
	install func(*goagent.App)
	context func() []string
	tools   []string
	notes   []string
}

// toolsetRegistry 工具集词 → 装配动作。这个 map 的 key 集合就是
// plugin.json toolsets 字段的合法词表（GET /modes 返回明细）。
var toolsetRegistry = map[string]toolsetInstaller{
	"flutter": {
		install: installFlutter,
		tools:   []string{"flutter"},
		notes: []string{
			"Bash 加固：拦截 flutter run/attach/daemon 交互式长驻命令（改走 flutter 工具 action=run；仅对启用本工具集的会话生效）",
			"flutter test/build 转后台任务：立即返回任务 ID，TaskOutput 取结果",
		},
	},
	"device": {
		options: deviceOptions,
		install: installDevice,
		context: func() []string { return []string{deviceCtxPath} },
		notes: []string{
			"DEVICE.md 动态设备状态上下文（10s 刷新，模型开工即知有无设备）",
			"设备锁：会话 run 结束自动释放，轮转时通知排队会话",
		},
	},
	"test-report": {
		install: installTestTools,
		tools: []string{
			"ui_tree", "tap", "swipe", "type", "back", "wait_for",
			"screenshot", "screen_diff", "logcat", "net", "test_report",
		},
	},
	"vision": {
		install: installVision,
		tools:   []string{"vision_ask"},
		notes:   []string{"仅 FLAI_VISION=1 时注册（模型须支持图片输入）"},
	},
}

// installFlutter Flutter 领域工具集：Bash 禁令 + flutter 工具 + bgtask 底座。
func installFlutter(app *goagent.App) {
	// Bash 领域禁令（代码层硬拦截）：flutter run/attach/daemon 是交互式
	// 长驻进程，经 Bash 跑会永久阻塞对话。必须走 flutter 工具的
	// action=run（等 app.started 即返回，进程自动转后台）。
	// 只对启用 flutter 工具集的会话生效（其他模式的会话没有 flutter 工具可指路）。
	app.ReplaceTool("Bash", wrapBash(func(sessionID string) bool {
		return sessionMode(sessionID).HasToolset("flutter")
	}))

	// 长命令后台执行：flutter test/build 经 bgtask 立即返回任务 ID，
	// 模型继续干别的，TaskOutput 取结果（引擎输出落盘 .yume/tasks/）。
	tools.BgTaskManager = app.BgTasks()

	// 注册 Flutter 领域工具
	name, def := tools.NewFlutterTool()
	app.Tool(name, def)
}

// deviceOptions 设备锁观察者（进程级：会话 run 结束释放该会话持有的锁，
// 未持锁的会话是空操作）。DEVICE.md 上下文走 context 字段按会话注入——
// 未启用 device 的模式上下文里不会出现设备状态的幽灵内容。
func deviceOptions() []goagent.Option {
	return []goagent.Option{
		goagent.WithObservers(deviceLockObserver{}), // 会话 run 结束释放设备锁（思考/写码期间不掉锁）
	}
}

// installDevice 设备锁轮转通知 + DEVICE.md 动态刷新。
func installDevice(app *goagent.App) {
	// 手机轮转到排队会话时注入系统消息，提醒那个 agent 回来继续测试
	//（不阻塞、不遗忘——期间它可以先干别的活）。
	tools.DeviceFreeFn = func(sessionID string) {
		log.Printf("[device] 锁轮转给会话 %s", sessionID)
		go notifyDeviceFree(app, sessionID)
	}

	// 每 10s 刷新 DEVICE.md（会话上下文现读现用——模型开工即知有无设备，
	// 有则优先装机实测）。
	refreshDeviceCtx()
	go func() {
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		for range t.C {
			refreshDeviceCtx()
		}
	}()
}

// installTestTools 设备联调测试工具集（L3 语义树/L4 视觉/L6 网络联调）：
// ui_tree / tap / swipe / type / back / wait_for / screenshot /
// screen_diff / logcat / net / test_report。
func installTestTools(app *goagent.App) {
	for _, t := range []struct {
		name string
		def  goagent.ToolDef
	}{
		reg(tools.NewUITreeTool()), reg(tools.NewTapTool()), reg(tools.NewSwipeTool()),
		reg(tools.NewTypeTool()), reg(tools.NewBackTool()), reg(tools.NewWaitForTool()),
		reg(tools.NewScreenshotTool()), reg(tools.NewScreenDiffTool()),
		reg(tools.NewLogcatTool()), reg(tools.NewNetTool()),
		reg(tools.NewTestReportTool()),
	} {
		app.Tool(t.name, t.def)
	}
}

// installVision L5 视觉裁决。仅 FLAI_VISION=1 时注册（模型必须支持图片
// 输入；不支持时工具不存在，模型不会尝试调用）。
func installVision(app *goagent.App) {
	if !tools.VisionEnabled() {
		return
	}
	n, d := tools.NewVisionAskTool()
	app.Tool(n, d)
	fmt.Println("  视觉裁决: 已启用（FLAI_VISION=1）")
}

// knownToolsets 注册表内的全部工具集词（排序后用于报错提示）。
func knownToolsets() []string {
	ids := make([]string, 0, len(toolsetRegistry))
	for k := range toolsetRegistry {
		ids = append(ids, k)
	}
	sort.Strings(ids)
	return ids
}
