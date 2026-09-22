// toolsets.go 领域工具集装配注册表：mode.json 声明的 toolset 词 →
// 引擎侧具体装配动作的唯一权威映射。
//
// toolset 是开关词（mode.json 声明"要什么"），注册表是机制（"怎么装"）：
// 机制进内核、内容进 mode。新增领域工具集 = 写一个 install 函数 + 注册表
// 加一行；mode.json 出现表外的词视为清单错误，引擎拒绝启动。
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
//	options —— New 前段：上下文注入 / 观察者等 Option 级装配（可空）
//	install —— app 创建后的工具注册、ReplaceTool、运行期接线（可空）
type toolsetInstaller struct {
	options func() []goagent.Option
	install func(*goagent.App)
}

// toolsetRegistry 工具集词 → 装配动作。这个 map 的 key 集合就是 mode.json
// toolsets 字段的合法词表（桌面壳/模式作者以 GET /modes 拿到的清单为准）。
var toolsetRegistry = map[string]toolsetInstaller{
	"flutter":     {install: installFlutter},
	"device":      {options: deviceOptions, install: installDevice},
	"test-report": {install: installTestTools},
	"vision":      {install: installVision},
}

// installFlutter Flutter 领域工具集：Bash 禁令 + flutter 工具 + bgtask 底座。
func installFlutter(app *goagent.App) {
	// Bash 领域禁令（代码层硬拦截）：flutter run/attach/daemon 是交互式
	// 长驻进程，经 Bash 跑会永久阻塞对话。必须走 flutter 工具的
	// action=run（等 app.started 即返回，进程自动转后台）。
	app.ReplaceTool("Bash", wrapBash())

	// 长命令后台执行：flutter test/build 经 bgtask 立即返回任务 ID，
	// 模型继续干别的，TaskOutput 取结果（引擎输出落盘 .yume/tasks/）。
	tools.BgTaskManager = app.BgTasks()

	// 注册 Flutter 领域工具
	name, def := tools.NewFlutterTool()
	app.Tool(name, def)
}

// deviceOptions 设备上下文 + 设备锁观察者（移动端领域配套；code 等无设备
// 概念的模式不注入，上下文里也就不会有 DEVICE.md 的幽灵内容）。
func deviceOptions() []goagent.Option {
	return []goagent.Option{
		goagent.WithProjectContext(deviceCtxPath),   // 动态设备状态（每次会话现读现用）
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
