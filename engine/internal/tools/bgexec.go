// bgexec.go 长命令后台执行器：flutter test/build 这类分钟级命令不该阻塞
// agent 循环——立即返回任务 ID，模型先干别的，稍后用 TaskOutput 取结果。
//
// 实现基于 goagent 的 bgtask.Manager（任务状态 + 输出落盘 + TaskOutput/
// TaskStop 工具），这里只做「spawn 进程 → 流式追加输出 → 完成/失败回写」
// 的胶水。短命令（analyze/pubget）仍走前台同步路径。
package tools

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
	"github.com/Dream355873200/GoAgent/bgtask"
)

// BgTaskManager 引擎注入的 bgtask 管理器（main.go 里 WithBgTaskTools
// 启用后传入；nil 时长命令退化为前台同步执行）。
var BgTaskManager *bgtask.Manager

// runBackground 把命令注册为后台任务并 spawn：立即返回任务 ID 和取回方式。
// 返回的字符串是给模型的「怎么取结果」指引。
func runBackground(ctx goagent.Context, dir, description string, timeout time.Duration, name string, args ...string) (string, error) {
	if BgTaskManager == nil {
		return "", fmt.Errorf("后台任务系统未启用")
	}

	taskID, bgCtx, _ := BgTaskManager.RegisterShell(
		ctx.SessionID, strings.Join(append([]string{name}, args...), " "), description, "")

	cmd := exec.CommandContext(bgCtx, name, args...)
	cmd.Dir = dir
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	cmd.Stderr = cmd.Stdout // 合并到同一管道（builder 借 stderr 也行不通，直接合并）

	if err := cmd.Start(); err != nil {
		BgTaskManager.Fail(taskID, fmt.Errorf("启动失败: %v", err))
		return "", fmt.Errorf("%s 启动失败: %v", name, err)
	}

	// 独立于工具调用的 ctx（bgCtx 由 TaskStop/Kill 控制；工具 ctx 取消
	// 不该杀后台任务——那正是「先返回、稍后取」的意义）。
	// 超时 cancel 的所有权交给 goroutine（defer 在本函数返回时会误杀）。
	procCtx := bgCtx
	var timeoutCancel context.CancelFunc
	if timeout > 0 {
		procCtx, timeoutCancel = context.WithTimeout(bgCtx, timeout)
	}

	go func() {
		if timeoutCancel != nil {
			defer timeoutCancel()
		}
		buf := make([]byte, 32*1024)
		var pending strings.Builder
		lastFlush := time.Now()
		for {
			n, rerr := stdout.Read(buf)
			if n > 0 {
				pending.Write(buf[:n])
				// 节流追加（每 500ms 或攒够 8KB）：AppendOutput 每次落盘
				if time.Since(lastFlush) > 500*time.Millisecond || pending.Len() > 8192 {
					_ = BgTaskManager.AppendOutput(taskID, pending.String())
					pending.Reset()
					lastFlush = time.Now()
				}
			}
			if rerr != nil {
				break
			}
		}
		if pending.Len() > 0 {
			_ = BgTaskManager.AppendOutput(taskID, pending.String())
		}
		err := cmd.Wait()
		if procCtx.Err() == context.DeadlineExceeded {
			BgTaskManager.CompleteShell(taskID, -1, "（超时终止）")
			return
		}
		if err != nil {
			BgTaskManager.CompleteShell(taskID, 1, fmt.Sprintf("（退出错误: %v）", err))
			return
		}
		BgTaskManager.CompleteShell(taskID, 0, "")
	}()

	return fmt.Sprintf("已在后台启动: %s（任务 ID: %s，%s）\n"+
		"继续做其他工作，稍后用 TaskOutput 工具（task_id=%s）取结果；"+
		"任务失败或不再需要时用 TaskStop 终止。",
		description, taskID, fmtDuration(timeout), taskID), nil
}

func fmtDuration(d time.Duration) string {
	if d <= 0 {
		return "无超时限制"
	}
	return fmt.Sprintf("超时 %s", d)
}

// runForeground 前台同步执行（短命令）：输出截断保留尾部。
func runForeground(ctx context.Context, dir string, timeout time.Duration, name string, args ...string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, name, args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	s := string(out)
	const maxOut = 20000
	var sb strings.Builder
	if len(s) > maxOut {
		sb.WriteString(fmt.Sprintf("...（前面已截断 %d 字符）...\n", len(s)-maxOut))
		s = s[len(s)-maxOut:]
	}
	sb.WriteString(s)
	if err != nil {
		if cctx.Err() == context.DeadlineExceeded {
			sb.WriteString(fmt.Sprintf("\n[超时 %s — 命令仍在运行或被杀]", timeout))
		} else {
			sb.WriteString(fmt.Sprintf("\n[退出状态: %v]", err))
		}
	} else {
		sb.WriteString("\n[命令成功，退出码 0]")
	}
	return sb.String(), nil
}

// bgOutputDir 后台任务输出落盘目录（挂在项目 .yume/ 下）。
func bgOutputDir(projectDir string) string {
	d := filepath.Join(projectDir, ".yume", "bgtask")
	_ = os.MkdirAll(d, 0o755)
	return d
}
