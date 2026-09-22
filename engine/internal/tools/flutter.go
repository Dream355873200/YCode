// Package tools 提供 Flutter 开发领域的自定义工具，
// 注册到 goagent 引擎中供 LLM 调用。
package tools

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
)

// FlutterInput 是 flutter 工具的输入参数。
type FlutterInput struct {
	// Action 要执行的 Flutter CLI 动作
	Action string `json:"action" desc:"要执行的动作" enum:"analyze,test,pubget,devices,build,run" required:"true"`
	// ProjectDir Flutter 项目目录（包含 pubspec.yaml）
	ProjectDir string `json:"project_dir" desc:"Flutter 项目目录（包含 pubspec.yaml 的绝对路径）" required:"true"`
	// TimeoutSec 命令超时秒数，默认 300
	TimeoutSec int `json:"timeout_sec,omitempty" desc:"命令超时秒数，默认 300"`
}

// flutterActions 支持的动作 → 实际命令参数。
// run = 部署到设备并启动（flutter run 内部自动 gradle 构建 + adb install -r +
// 拉起 app）；--machine 输出 JSON 事件流，app.started 即部署完成。
var flutterActions = map[string][]string{
	"analyze": {"analyze", "--no-pub"},
	"test":    {"test", "--reporter", "compact"},
	"pubget":  {"pub", "get"},
	"devices": {"devices"},
	"build":   {"build", "apk", "--debug"},
	"run":     {"run", "--machine", "-d", "attached"}, // attached = 第一台在线设备
}

// NewFlutterTool 返回封装 Flutter CLI 的工具定义。
// analyze/test/pubget/devices 是开发回环的核心命令，均无破坏性，
// 归为 ReadOnly；build 耗时较长但也安全，同样允许。
func NewFlutterTool() (name string, def goagent.ToolDef) {
	return "flutter", goagent.ToolDef{
		Description: "执行 Flutter CLI 命令（analyze/test/pubget/devices/build/run）。" +
			"生成或修改代码后必须调用 action=analyze 检查；报错时应读取输出并修复代码后重新 analyze，直到零 error。" +
			"【部署到手机测试必用 action=run】——构建+安装+启动一条龙，等 app.started 事件即返回（进程自动转后台），" +
			"返回后可直接用 tap/ui_tree/screenshot 测试。禁止用 Bash 跑 flutter run（交互式进程会永久阻塞）。" +
			"【长命令自动后台】action=test/build 是分钟级命令：立即返回后台任务 ID，不阻塞你继续工作——" +
			"先去做别的，稍后用 TaskOutput 工具（传任务 ID）取结果；不再需要用 TaskStop 终止。",
		Input:       FlutterInput{},
		Permission:  goagent.ReadOnly,
		Concurrent:  false, // flutter 命令会锁 build 目录，串行执行
		Execute: func(ctx goagent.Context, in FlutterInput) (string, error) {
			// 会话工作目录兜底：模型没传 project_dir 时用 ctx.WorkDir
			//（单引擎多项目下按会话扎根，见 goagent.WithSessionWorkDir）。
			if in.ProjectDir == "" {
				in.ProjectDir = ctx.WorkDir
			}
			// run 特殊路径：长驻进程，等 JSON 事件流里 app.started 即返回（app 已装上手机）
			if in.Action == "run" {
				return flutterRun(ctx, in)
			}
			args, ok := flutterActions[in.Action]
			if !ok {
				return "", fmt.Errorf("不支持的动作 %q，可选: analyze/test/pubget/devices/build/run", in.Action)
			}
			if in.Action != "devices" && in.ProjectDir == "" {
				return "", fmt.Errorf("project_dir 不能为空（devices 动作除外）")
			}
			// 超时默认：test/build 是分钟级命令（冷缓存编译 3-8 分钟），
			// 其余秒级。挂死的测试永不退出——超时是兜底不是常态。
			timeout := 300
			if in.Action == "test" {
				timeout = 600
			}
			if in.Action == "build" {
				timeout = 900
			}
			if in.TimeoutSec > 0 {
				timeout = in.TimeoutSec
			}

			// 长命令（test/build）后台执行：立即返回任务 ID，agent 循环
			// 不阻塞——模型先做别的（写代码/读文件），稍后 TaskOutput 取
			// 结果。短命令（analyze/pubget/devices）保持前台同步。
			if (in.Action == "test" || in.Action == "build") && BgTaskManager != nil {
				return runBackground(ctx, in.ProjectDir,
					fmt.Sprintf("flutter %s", in.Action),
					time.Duration(timeout)*time.Second,
					"flutter", args...)
			}

			out, err := runForeground(ctx.Context, in.ProjectDir, time.Duration(timeout)*time.Second, "flutter", args...)
			var sb strings.Builder
			sb.WriteString(fmt.Sprintf("$ flutter %s (dir=%s)\n", strings.Join(args, " "), in.ProjectDir))
			sb.WriteString(out)
			_ = err // runForeground 已把退出状态写进 out 尾部
			return sb.String(), nil
		},
	}
}

// flutterRun 部署并启动（action=run）：spawn flutter run --machine -d <serial>，
// 逐行读 JSON 事件流，等 app.started（gradle 构建 + adb install + 拉起完成）
// 即返回——进程转后台继续跑（热重载可用），不阻塞 agent。
func flutterRun(ctx goagent.Context, in FlutterInput) (string, error) {
	if in.ProjectDir == "" {
		return "", fmt.Errorf("project_dir 不能为空")
	}
	dev, err := adbDevice(ctx.Context)
	if err != nil {
		return "", fmt.Errorf("无设备可部署（%v）——插手机或让用户点桌面壳的「部署运行」", err)
	}
	timeout := 300
	if in.TimeoutSec > 0 {
		timeout = in.TimeoutSec
	}
	// 进程必须独立于本次工具调用存活（否则 ctx 取消时 app 被杀）——
	// 等待 app.started 用独立计时器，spawn 用 WithoutCancel 的父 ctx
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx.Context), time.Duration(timeout)*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cctx, "flutter", "run", "--machine", "-d", dev)
	// 部署完成后接管进程生命周期：脱离 cctx（否则 defer cancel 会杀掉 app）
	cmd.Cancel = func() error { return nil } // 超时触发 cancel 时不杀进程（由 Wait 后台管理）
	cmd.Dir = in.ProjectDir
	// stderr 合并进收集（构建/安装失败的详情多在 stderr——只看 stdout 会丢一半诊断）
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("flutter run 启动失败: %v", err)
	}

	// 读事件流直到 app.started / 超时 / 进程退出。
	// app.stop / app.error 在 app.started 之前出现 → 启动失败，提前止损
	//（不必干等超时，agent 拿着失败原因立刻能排障）。
	started := false
	failed := ""
	var lastLines []string
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	done := make(chan struct{})
	go func() {
		for sc.Scan() {
			line := sc.Text()
			lastLines = append(lastLines, line)
			if len(lastLines) > 20 {
				lastLines = lastLines[len(lastLines)-20:]
			}
			if strings.Contains(line, `"app.started"`) {
				started = true
				break
			}
			if strings.Contains(line, `"app.error"`) {
				// 解析 app.error 的事件正文（失败原因）
				if i := strings.Index(line, `"params"`); i >= 0 {
					failed = line[i:]
				} else {
					failed = line
				}
				break
			}
			if strings.Contains(line, `"app.stop"`) {
				failed = "app.stop（应用未启动即停止——常见：adb install 失败/设备杀后台/VM Service 端口被占用）"
				break
			}
		}
		close(done)
	}()

	select {
	case <-done:
	case <-cctx.Done():
		_ = cmd.Process.Kill()
		return "", fmt.Errorf("等待部署超时（%ds）——最近输出:\n%s\nstderr:\n%s",
			timeout, strings.Join(lastLines, "\n"), errBuf.String())
	}

	if !started {
		_ = cmd.Process.Kill()
		return fmt.Sprintf("flutter run 启动失败。原因: %s\n最近输出:\n%s\nstderr:\n%s",
			failed, strings.Join(lastLines, "\n"), errBuf.String()), nil
	}
	// 进程后台续跑（ctx 取消时 CommandContext 的 Done 会杀掉它——保住 Hot Reload 通道
	// 需要进程独立于请求生命周期，这里起 goroutine 等待退出只做日志）
	go func() { _, _ = cmd.Process.Wait(); }()
	return fmt.Sprintf("已部署到 %s 并启动（app.started）——进程后台运行，可用 flutter run 的 daemon 协议热重载；现在可用 tap/ui_tree 等工具测试", dev), nil
}
