// bashguard.go Bash 领域禁令（应用层硬拦截，代码级而非提示级）。
//
// flutter run/attach/daemon 是交互式长驻进程：经 Bash 跑会永久阻塞对话
// （模型停在工具调用里等不到返回）。引擎提供 flutter 工具的 action=run
// 特殊路径（--machine 事件流，app.started 即返回、进程转后台），所以
// 这些命令在 Bash 层直接拒绝——不是靠 skill 提示模型「别用」，是代码层
// 让它根本跑不起来。
package main

import (
	"context"
	"fmt"
	"regexp"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
	builtin "github.com/Dream355873200/GoAgent/builtin"
	"github.com/Dream355873200/GoAgent/reminder"
)

// bannedCmd 匹配 flutter(.exe)? run|attach|daemon|logs（复合命令中间出现也算）。
// 这四个都是交互式长驻命令：run/attach/daemon 驻进程等输入，logs 持续滚动
// 日志流永不退出——经 Bash 跑任何一个都会永久阻塞对话。
var bannedCmd = regexp.MustCompile(`(^|[\s&|;])flutter(\.exe|\.bat)?(\s+(run|attach|daemon|logs))\b`)

// wrapBash 返回带禁令的 Bash 工具定义：命中禁令直接报错并指路，
// 其余命令透传原实现（保留原描述/Schema/权限）。
func wrapBash() goagent.ToolDef {
	def := builtin.BashTool()
	orig := def.Execute.(func(goagent.Context, builtin.BashInput) (string, error))
	def.Execute = func(ctx goagent.Context, in builtin.BashInput) (string, error) {
		if bannedCmd.MatchString(in.Command) {
			return "", fmt.Errorf(
				"禁止用 Bash 执行 flutter run/attach/daemon/logs（交互式长驻进程会永久阻塞对话）。\n" +
					"部署到设备请用 flutter 工具：action=run（构建+安装+启动一条龙，等 app.started 即返回，进程自动转后台）。\n" +
					"如需看运行日志用 logcat 工具（tag=flutter）。",
			)
		}
		return orig(ctx, in)
	}
	return def
}

// notifyDeviceFree 设备锁轮转到排队会话时的回调：提醒该会话回来继续
// 测试（不遗忘）。
// 优先走插话通道（任务运行中 → guide 车道，工具批边界生效，无需等锁）；
// 空闲则注入并跑一轮；会话恰被占用（竞态）时退避重试。
func notifyDeviceFree(app *goagent.App, sessionID string) {
	// 统一 system-reminder 通道：环境提醒打标记（source=steer 由插话
	// 通道在注入时补上，这里传原始文本），不再用 "[系统通知]" 文本前缀。
	msg := "设备已空闲，轮到本会话了——请回来继续设备测试（ui_tree/tap/swipe/screenshot/logcat 现在可用）。"
	if hub := app.Steering(); hub != nil {
		if err := hub.Steer(sessionID, msg); err == nil {
			return
		}
	}
	// 空闲路径：直接作为新一轮输入注入——没有插话通道的包装层，
	// 在这里打 host 来源的 system-reminder 标记。
	wrapped := reminder.Wrap(reminder.SourceHost, msg)
	for i := 0; i < 5; i++ {
		if i > 0 {
			time.Sleep(10 * time.Second)
		}
		if injectSessionMessage(app, sessionID, wrapped) {
			return
		}
	}
}

// injectSessionMessage 向会话注入一条消息并跑一轮 agent。
// 返回是否注入成功：会话正被占用（Acquire 失败）时返回 false。
func injectSessionMessage(app *goagent.App, sessionID, msg string) bool {
	ok := make(chan bool, 1)
	go func() {
		injected := false
		for ev := range app.RunSession(context.Background(), sessionID, msg) {
			switch ev.Type {
			case goagent.EventError:
				// 会话占用中（Acquire 失败）等错误：注入未生效
				ok <- false
				return
			case goagent.EventToolStart, goagent.EventTextDelta, goagent.EventDone:
				injected = true
			}
		}
		ok <- injected
	}()
	return <-ok
}
