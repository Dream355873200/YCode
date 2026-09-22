// device.go 复合自动化测试工具集（L3/L4/L6，能力开关含 L5）：
//
//	L3 语义树  ui_tree / tap / swipe / type / back / wait_for
//	L4 视觉    screenshot（稳定检测）/ screen_diff（像素对比，零模型）
//	L5 多模态  vision_ask —— 仅当环境变量 FLAI_VISION=1 注册（模型必须支持视觉，
//	           否则请求会被 API 拒绝；不支持时工具直接不存在，模型不会尝试）
//	L6 网络    net_reverse（前后端联调端口映射）/ net_record（录制断言）/
//	           net_mock（响应伪造，测异常分支）
//
// 交互通道：adb（shell input / uiautomator / screencap），不依赖投屏。
// 设备选择：FLAI_DEVICE 环境变量或自动取第一台在线设备。
package tools

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
	"github.com/Dream355873200/GoAgent/reminder"
)

// ---------- adb 基础 ----------

// ---------- 设备独占锁（多会话并发排队 + run 结束释放） ----------
// 手机是独占资源：多项目/多会话并行测试时，adb/scrcpy 同一时刻只能被一个
// agent 使用。锁绑定「会话本轮 run」：会话调用测试工具时获取并持有，
// run 结束（OnSessionEnd：正常完成/出错/被终止）立即释放、轮转给队首。
// 思考间隙、跑 analyze、写代码期间锁不掉——测试流程不会被中途顶掉。
// 拿不到锁的调用不阻塞——工具返回「设备忙，排队中」，agent 去做别的；
// 轮转到它时经 DeviceFreeFn 通知引擎，引擎注入系统消息提醒它回来测试。
// 闲置超时（2 分钟）只兜 run 挂死不回调的故障态。

var (
	adbMu sync.Mutex // 短临界区：input 命令串行（点击序列不乱序）

	deviceLock       sync.Mutex
	deviceHolderSess string   // 当前占用设备锁的 sessionID；空=空闲
	deviceQueue      []string // 排队等待的 sessionID（FIFO）
	holderLastUse    time.Time // 占用者最后一次使用设备的时间（闲置检测）
	holderTimer      *time.Timer

	// 测试工具集合：这些工具调用时进入/刷新设备锁周期
	deviceTools = map[string]bool{
		"ui_tree": true, "tap": true, "swipe": true, "type": true, "back": true,
		"wait_for": true, "screenshot": true, "screen_diff": true, "logcat": true,
		"net": true,
	}

	// DeviceFreeFn 设备锁轮转给新会话时回调（引擎注入系统消息提醒回来测试）
	DeviceFreeFn func(sessionID string)
	// DeviceBusyFn 会话排队时回调（引擎记录排队关系）
	DeviceBusyFn func(sessionID string)
	// DeviceAutoTimeout 闲置自动释放时长（崩溃兜底），默认 2 分钟。
	// 锁的常规释放走 OnSessionEnd（会话 run 结束立即释放轮转），
	// 这里只回收 run 挂死/回调丢失的极端故障态，不该在日常触发。
	DeviceAutoTimeout = 2 * time.Minute
)

// touchWrap 测试工具的 Execute 包装：进锁/刷新占用 + 时间线落盘。
// 获取到锁立即执行；拿不到锁返回「设备忙」让 agent 先做别的，
// 锁释放（run 结束 / 故障超时）时经 DeviceFreeFn 通知该会话回来。
// 注：锁在本轮 run 期间持续持有（OnSessionEnd 才释放）——一个测试
// 流程（tap→wait_for→screenshot…）连同中间的思考时间都不会被打断。
// 时间线：每次调用（含被拒的排队尝试）都追加 .yume/test-log.jsonl，
// 前端「测试」页签按它实时渲染步骤流。
func touchWrap(ctx goagent.Context, toolName string, input any, fn func() (string, error)) (string, error) {
	sid := ctx.SessionID
	start := time.Now()
	holder, queuePos := touchDevice(sid, toolName)
	if holder != sid {
		msg := fmt.Sprintf("设备被其他 Agent 占用中（排队位置 %d）——先去执行其他任务（写代码/看代码/整理报告），"+
			"设备空闲时系统会自动通知你回来继续测试", queuePos)
		testLogAppend(ctx, toolName, input, msg, false, time.Since(start).Milliseconds())
		// 统一 system-reminder 通道（source=tool）：拒绝原因是环境提醒，
		// 打标记后模型可辨识其非业务错误性质（时间线日志仍记原文）
		return "", fmt.Errorf("%s", reminder.Wrap(reminder.SourceTool, msg))
	}
	out, err := fn()
	testLogAppend(ctx, toolName, input, out, err == nil, time.Since(start).Milliseconds())
	return out, err
}

// ReleaseDevice 显式释放设备锁（引擎在会话测试阶段结束时调用，加快轮转）。
func ReleaseDevice(sessionID string) {
	releaseDevice(sessionID)
}

// TouchDeviceKeepAlive 刷新持锁会话的闲置计时（不获取锁、不排队）。
// 供 OnSessionStart 钩子使用：上一轮结束回调丢失时刷新计时，
// 交给超时兜底回收，避免双重持锁。非持锁会话调用无副作用。
func TouchDeviceKeepAlive(sessionID string) {
	if sessionID == "" {
		return
	}
	deviceLock.Lock()
	defer deviceLock.Unlock()
	if deviceHolderSess == sessionID {
		holderLastUse = time.Now()
		resetHolderTimerLocked()
	}
}

// ---------- 测试时间线落盘（工具层日志） ----------
//
// 每个测试工具调用的「意图 + 参数 + 结果」在 touchWrap 层捕获，追加到
// 项目的 .yume/test-log.jsonl（JSONL，每行 {ts, tool, input, result, ok}）。
// 前端「测试」页签轮询此文件实时呈现 AI 操作 App 的步骤与断言——
// 不依赖 SSE 事件流（切页面/重开应用不丢），与网络页签同构。

// testLogAppend 追加一条测试时间线记录（失败静默：日志不影响主流程）。
func testLogAppend(ctx context.Context, toolName string, input any, result string, ok bool, ms int64) {
	root := projectRootFrom(ctx)
	if root == "" {
		return
	}
	entry := map[string]any{
		"ts":    time.Now().Format("15:04:05"),
		"tool":  toolName,
		"input": input,
		"ok":    ok,
		"ms":    ms,
	}
	if len(result) > 300 {
		entry["result"] = result[:300] + "…"
	} else {
		entry["result"] = result
	}
	b, err := json.Marshal(entry)
	if err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(root, ".yume", "test-log.jsonl"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

// 返回 (获取到锁的 sessionID, 排队位置)。sessionID 为空（无会话上下文）直接放行。
func touchDevice(sessionID, toolName string) (string, int) {
	if sessionID == "" || !deviceTools[toolName] {
		return sessionID, 0
	}
	deviceLock.Lock()
	defer deviceLock.Unlock()
	if deviceHolderSess == "" {
		deviceHolderSess = sessionID
		holderLastUse = time.Now()
		resetHolderTimerLocked()
		return sessionID, 0
	}
	if deviceHolderSess == sessionID {
		holderLastUse = time.Now() // 同会话复用，刷新计时
		return sessionID, 0
	}
	// 被其他会话占用：进队
	for _, s := range deviceQueue {
		if s == sessionID {
			return "", queuePosLocked(sessionID)
		}
	}
	deviceQueue = append(deviceQueue, sessionID)
	if DeviceBusyFn != nil {
		DeviceBusyFn(sessionID)
	}
	return "", queuePosLocked(sessionID)
}

// releaseDevice 显式释放（引擎「终止测试」或投屏交互时调用）。
func releaseDevice(sessionID string) {
	deviceLock.Lock()
	defer deviceLock.Unlock()
	if deviceHolderSess != sessionID {
		return
	}
	if holderTimer != nil {
		holderTimer.Stop()
		holderTimer = nil
	}
	rotateLocked()
}

// rotateLocked 把锁轮转给队首；调用方必须已持有 deviceLock。
func rotateLocked() {
	deviceHolderSess = ""
	if len(deviceQueue) > 0 {
		next := deviceQueue[0]
		deviceQueue = deviceQueue[1:]
		deviceHolderSess = next
		holderLastUse = time.Now()
		resetHolderTimerLocked()
		if DeviceFreeFn != nil {
			DeviceFreeFn(next)
		}
	}
}

// resetHolderTimerLocked 重置闲置释放定时器；调用方必须已持有 deviceLock。
func resetHolderTimerLocked() {
	if holderTimer != nil {
		holderTimer.Stop()
	}
	holderTimer = time.AfterFunc(DeviceAutoTimeout, func() {
		deviceLock.Lock()
		defer deviceLock.Unlock()
		if deviceHolderSess == "" {
			return
		}
		if time.Since(holderLastUse) >= DeviceAutoTimeout {
			rotateLocked()
		}
	})
}

// queuePosLocked 当前会话在队列中的位置；调用方必须已持有 deviceLock。
func queuePosLocked(sessionID string) int {
	for i, s := range deviceQueue {
		if s == sessionID {
			return i + 1
		}
	}
	return 0
}

// adbName 返回"s=xxx"形式串行参数（多设备时用）
var adbBinPath string

// adbPath 解析 adb：FLAI_ADB > 项目内 tools/scrcpy/adb.exe（1.0.41，已验证）> PATH。
// 老版 adb（1.0.26）shell 通道行为异常，必须避开。
func adbPath() (string, error) {
	if adbBinPath != "" {
		return adbBinPath, nil
	}
	candidates := []string{os.Getenv("FLAI_ADB")}
	if root := projectRoot(); root != "" {
		candidates = append(candidates, filepath.Join(root, "tools", "scrcpy", "adb.exe"))
	}
	candidates = append(candidates, "adb")
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if c == "adb" || fileExists(c) {
			adbBinPath = c
			return c, nil
		}
	}
	return "", fmt.Errorf("未找到 adb（设 FLAI_ADB 或安装到 PATH）")
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// projectRoot 返回当前 Flutter 项目根（引擎 cwd 即项目目录；也可经
// FLAI_PROJECT_ROOT 显式指定——测试工具的 .yume/ 输出都挂在项目内）。
func projectRoot() string {
	if r := os.Getenv("FLAI_PROJECT_ROOT"); r != "" {
		return r
	}
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	// cwd 就是项目根（含 pubspec.yaml）；保险起见上溯两级找
	if fileExists(filepath.Join(wd, "pubspec.yaml")) {
		return wd
	}
	for i := 0; i < 2; i++ {
		wd = filepath.Dir(wd)
		if fileExists(filepath.Join(wd, "pubspec.yaml")) {
			return wd
		}
	}
	return ""
}

// projectRootFrom 按会话解析项目根：优先 ctx 注入的会话工作目录
//（单引擎多项目下每个 session 扎根各自的项目目录，见 WithSessionWorkDir），
// 无会话上下文时回退 projectRoot()（env/cwd，旧行为）。
func projectRootFrom(ctx context.Context) string {
	if wd := goagent.WorkDirFromContext(ctx); wd != "" {
		return wd
	}
	return projectRoot()
}

// DeviceStatus 探测当前 adb 设备，生成会话上下文用的状态文本。
// 注入 DEVICE.md 后模型开工即知设备状态；有设备时明确指示优先装机实测。
func DeviceStatus() string {
	bin, err := adbPath()
	if err != nil {
		return "- adb 不可用：设备验证不可用，回复中必须声明「未经设备验证」"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, "devices", "-l").CombinedOutput()
	if err != nil {
		return "- 设备探测失败：按无设备处理，回复中必须声明「未经设备验证」"
	}
	var online []string
	for _, line := range strings.Split(string(out), "\n")[1:] {
		f := strings.Fields(line)
		if len(f) >= 2 && f[1] == "device" {
			model := ""
			for _, w := range f {
				if strings.HasPrefix(w, "model:") {
					model = strings.TrimPrefix(w, "model:")
				}
			}
			if model != "" {
				online = append(online, fmt.Sprintf("%s（%s，serial %s）", model, f[0], f[0]))
			} else {
				online = append(online, f[0])
			}
		}
	}
	if len(online) == 0 {
		return "- 当前无设备连接：跳过设备验证，回复中必须声明「未经设备验证」（不要反复尝试 tap/ui_tree 等设备工具）"
	}
	return fmt.Sprintf(
		"- 在线设备：%s\n- 调度策略：有设备时优先真实安装测试——代码写完先 flutter 工具 action=run 部署到设备，\n"+
			"  再用 tap/ui_tree/screenshot 实测；不要只跑 analyze 就宣布完成",
		strings.Join(online, "、"))
}
func adbDevice(ctx context.Context) (string, error) {
	bin, err := adbPath()
	if err != nil {
		return "", err
	}
	if d := os.Getenv("FLAI_DEVICE"); d != "" {
		return d, nil
	}
	out, err := exec.CommandContext(ctx, bin, "devices").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("adb devices 失败: %v", err)
	}
	for _, line := range strings.Split(string(out), "\n")[1:] {
		f := strings.Fields(line)
		if len(f) >= 2 && f[1] == "device" {
			return f[0], nil
		}
	}
	return "", fmt.Errorf("无在线设备（插入手机并开启 USB 调试，或设 FLAI_DEVICE）")
}

// adb 设备命令执行（-s serial + 任意参数），返回 stdout。
func adbRun(ctx context.Context, args ...string) (string, error) {
	bin, err := adbPath()
	if err != nil {
		return "", err
	}
	dev, err := adbDevice(ctx)
	if err != nil {
		return "", err
	}
	full := append([]string{"-s", dev}, args...)
	out, err := exec.CommandContext(ctx, bin, full...).CombinedOutput()
	return string(out), err
}

// ---------- 工具 1：ui_tree（L3 语义树） ----------

type UITreeInput struct {
	// Grep 正则过滤（可选）：只保留 text/resource-id/content-desc 匹配的节点
	Grep string `json:"grep,omitempty" desc:"正则过滤节点（text/resource-id/content-desc 任一匹配）"`
}

// NewUITreeTool 语义树：uiautomator dump。Flutter 自绘控件在系统语义树中
// 仅在有语义标注（Semantics widget）时可见——所以它是「系统层」视图：
// 适合权限弹窗/系统对话框/原生页面；Flutter 页面内结构用 patrol_dump。
func NewUITreeTool() (string, goagent.ToolDef) {
	return "ui_tree", goagent.ToolDef{
		Description: "获取当前屏幕的 UI 语义树（uiautomator dump XML）。系统弹窗/权限框/原生控件" +
			"用它定位；Flutter 自绘页面若看不到控件，说明没有语义标注，应改用 patrol_dump 或截图。" +
			"节点属性：text/resource-id/content-desc/clickable/bounds。",
		Input:      UITreeInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in UITreeInput) (string, error) {
			return touchWrap(ctx, "ui_tree", in, func() (string, error) {
				cctx, cancel := context.WithTimeout(ctx.Context, 15*time.Second)
				defer cancel()
				// dump 到设备侧文件再拉取（uiautomator 直接输出不走 stdout）
				if _, err := adbRun(cctx, "shell", "uiautomator", "dump", "/sdcard/amc-ui.xml"); err != nil {
					return "", fmt.Errorf("uiautomator dump 失败（画面可能被安全策略遮挡）: %v", err)
				}
				xmlOut, err := adbRun(cctx, "shell", "cat", "/sdcard/amc-ui.xml")
				if err != nil {
					return "", fmt.Errorf("读取 dump 失败: %v", err)
				}
				xml := extractXML(xmlOut)
				if in.Grep != "" {
					xml = filterXMLNodes(xml, in.Grep)
				}
				const max = 16000
				if len(xml) > max {
					xml = xml[:max] + "\n...（截断，用 grep 参数缩小范围）"
				}
				return xml, nil
			})
		},
	}
}

// extractXML 从 adb shell 混合输出里抠出 XML 正文（跳过警告行）。
func extractXML(out string) string {
	if i := strings.Index(out, "<?xml"); i >= 0 {
		return out[i:]
	}
	if i := strings.Index(out, "<hierarchy"); i >= 0 {
		return out[i:]
	}
	return out
}

// filterXMLNodes 按正则保留匹配节点及其祖先链（保结构可导航）。
func filterXMLNodes(xml, pattern string) string {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return xml
	}
	lines := strings.Split(xml, "\n")
	var out []string
	for _, l := range lines {
		if re.MatchString(l) || strings.Contains(l, "<hierarchy") || strings.Contains(l, "</hierarchy>") {
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}

// ---------- 工具 2：tap / swipe / type / back / wait_for（L3 交互） ----------

type TapInput struct {
	X int `json:"x" desc:"x 坐标（像素）" required:"true"`
	Y int `json:"y" desc:"y 坐标（像素）" required:"true"`
	// Expect 硬断言：点击后轮询语义树验证期望文本出现（默认 5s）。
	// 不填 = 只点击不校验（旧行为）。填了且超时未见 → 返回失败 +
	// 当前屏幕可见文本摘要（当场定位「点了但没跳转」还是「跳了但没标注」）。
	Expect string `json:"expect,omitempty" desc:"点击后期望出现的文本（页面标题/关键元素）。点击后自动轮询验证——失败会附当前屏幕可见文本"`
}

func NewTapTool() (string, goagent.ToolDef) {
	return "tap", goagent.ToolDef{
		Description: "点击设备屏幕坐标（adb input tap）。坐标来自 ui_tree 节点的 bounds 或截图目测。" +
			"【推荐带 expect】点击后自动验证期望文本出现（等价 tap+wait_for 一步完成），" +
			"验证失败时返回当前屏幕文本摘要，当场区分「没跳转」和「跳转了但无语义标注」。",
		Input:      TapInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in TapInput) (string, error) {
			return touchWrap(ctx, "tap", in, func() (string, error) {
				adbMu.Lock()
				cctx, cancel := context.WithTimeout(ctx.Context, 30*time.Second)
				if _, err := adbRun(cctx, "shell", "input", "tap",
					strconv.Itoa(in.X), strconv.Itoa(in.Y)); err != nil {
					cancel()
					adbMu.Unlock()
					return "", fmt.Errorf("tap 失败: %v", err)
				}
				adbMu.Unlock()
				if in.Expect == "" {
					cancel()
					return fmt.Sprintf("已点击 (%d,%d)", in.X, in.Y), nil
				}
				// expect 校验：轮询语义树至多 5s
				ok, visText := waitForText(cctx, in.Expect, 5*time.Second)
				cancel()
				if ok {
					return fmt.Sprintf("已点击 (%d,%d)，✓ 验证通过：%q 已出现", in.X, in.Y, in.Expect), nil
				}
				return "", fmt.Errorf("点击 (%d,%d) 后 5s 未见 %q。当前屏幕可见文本（前 15 条）：%s\n"+
					"判断：文本在列表里 → 语义标注缺失/慢；不在 → 未跳转（点击目标可能错了）",
					in.X, in.Y, in.Expect, visText)
			})
		},
	}
}

// waitForText 轮询语义树等待文本出现（tap 的 expect 校验 / wait_for 共用）。
// 返回 (是否出现, 超时时屏幕可见文本摘要)。
func waitForText(ctx context.Context, text string, timeout time.Duration) (bool, string) {
	start := time.Now()
	for {
		if xml, ok := dumpUI(ctx); ok {
			if strings.Contains(xml, text) {
				return true, ""
			}
		}
		if time.Since(start) >= timeout {
			return false, visibleTexts(dumpUIBestEffort(ctx), 15)
		}
		select {
		case <-ctx.Done():
			return false, ""
		case <-time.After(400 * time.Millisecond):
		}
	}
}

// dumpUI 抓一次语义树（uiautomator dump + cat，失败返回 ok=false）。
func dumpUI(ctx context.Context) (string, bool) {
	if _, err := adbRun(ctx, "shell", "uiautomator", "dump", "/sdcard/amc-ui.xml"); err != nil {
		return "", false
	}
	out, err := adbRun(ctx, "shell", "cat", "/sdcard/amc-ui.xml")
	if err != nil {
		return "", false
	}
	return extractXML(out), true
}

// dumpUIBestEffort 尽力抓一次（失败返回空串）。
func dumpUIBestEffort(ctx context.Context) string {
	xml, _ := dumpUI(ctx)
	return xml
}

// visibleTexts 从语义树提取可见文本列表（text/content-desc 非空节点），
// 失败诊断用（「当前屏幕上到底有什么」）。
func visibleTexts(xml string, limit int) string {
	if xml == "" {
		return "（语义树抓取失败——Flutter 页面可能无语义标注，改用 screenshot 判断）"
	}
	re := regexp.MustCompile(`(?:text|content-desc)="([^"]+)"`)
	seen := map[string]bool{}
	var out []string
	for _, m := range re.FindAllStringSubmatch(xml, -1) {
		t := strings.TrimSpace(m[1])
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, fmt.Sprintf("%q", t))
		if len(out) >= limit {
			break
		}
	}
	if len(out) == 0 {
		return "（无文本节点——自绘页面无语义标注，改用 screenshot 判断）"
	}
	return strings.Join(out, ", ")
}

type SwipeInput struct {
	X1         int `json:"x1" desc:"起点 x" required:"true"`
	Y1         int `json:"y1" desc:"起点 y" required:"true"`
	X2         int `json:"x2" desc:"终点 x" required:"true"`
	Y2         int `json:"y2" desc:"终点 y" required:"true"`
	DurationMs int `json:"duration_ms,omitempty" desc:"滑动时长（ms），默认 300；越大越慢（惯性滚动用小值）"`
}

func NewSwipeTool() (string, goagent.ToolDef) {
	return "swipe", goagent.ToolDef{
		Description: "滑动（adb input swipe）：滚动列表、切换页面、下拉刷新。" +
			"快速滑动（duration 100-200）触发惯性；慢滑（300-500）精确控制。",
		Input:      SwipeInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in SwipeInput) (string, error) {
			return touchWrap(ctx, "swipe", in, func() (string, error) {
				adbMu.Lock()
				defer adbMu.Unlock()
				d := in.DurationMs
				if d <= 0 {
					d = 300
				}
				cctx, cancel := context.WithTimeout(ctx.Context, 10*time.Second)
				defer cancel()
				if _, err := adbRun(cctx, "shell", "input", "swipe",
					strconv.Itoa(in.X1), strconv.Itoa(in.Y1), strconv.Itoa(in.X2), strconv.Itoa(in.Y2),
					strconv.Itoa(d)); err != nil {
					return "", fmt.Errorf("swipe 失败: %v", err)
				}
				return fmt.Sprintf("已滑动 (%d,%d)→(%d,%d) %dms", in.X1, in.Y1, in.X2, in.Y2, d), nil
			})
		},
	}
}

type TypeTextInput struct {
	Text string `json:"text" desc:"要输入的文本（仅 ASCII 可靠；中文需输入法支持）" required:"true"`
}

func NewTypeTool() (string, goagent.ToolDef) {
	return "type", goagent.ToolDef{
		Description: "向当前焦点输入框输入文本（adb shell input text）。输入前必须先 tap 点中输入框。" +
			"仅 ASCII 可靠；含空格用 %s 代替。中文输入不支持（用粘贴板方案替代的场景先跳过）。",
		Input:      TypeTextInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in TypeTextInput) (string, error) {
			return touchWrap(ctx, "type", in, func() (string, error) {
				adbMu.Lock()
				defer adbMu.Unlock()
				cctx, cancel := context.WithTimeout(ctx.Context, 15*time.Second)
				defer cancel()
				safe := strings.ReplaceAll(in.Text, " ", "%s")
				if _, err := adbRun(cctx, "shell", "input", "text", safe); err != nil {
					return "", fmt.Errorf("输入失败: %v", err)
				}
				return fmt.Sprintf("已输入 %q", in.Text), nil
			})
		},
	}
}

func NewBackTool() (string, goagent.ToolDef) {
	return "back", goagent.ToolDef{
		Description: "按返回键（adb shell input keyevent 4）。关闭弹窗/返回上一页。",
		Input:       struct{}{},
		Permission:  goagent.ReadOnly,
		Concurrent:  false,
		Execute: func(ctx goagent.Context, in struct{}) (string, error) {
			return touchWrap(ctx, "back", in, func() (string, error) {
				adbMu.Lock()
				defer adbMu.Unlock()
				cctx, cancel := context.WithTimeout(ctx.Context, 10*time.Second)
				defer cancel()
				if _, err := adbRun(cctx, "shell", "input", "keyevent", "4"); err != nil {
					return "", fmt.Errorf("back 失败: %v", err)
				}
				return "已按返回", nil
			})
		},
	}
}

type WaitInput struct {
	// 匹配目标：文本（ui_tree 的 text/content-desc）
	Text     string `json:"text" desc:"等待出现的文本（ui_tree 语义树中匹配 text/content-desc）"`
	TimeoutS int    `json:"timeout_s,omitempty" desc:"最长等待秒数，默认 10"`
}

// NewWaitForTool 轮询语义树直到文本出现。E2E 同步原语：点击后页面加载需要时间，
// 直接 dump 会拿到旧页面——wait_for 是「确认到达」的标准方式。
func NewWaitForTool() (string, goagent.ToolDef) {
	return "wait_for", goagent.ToolDef{
		Description: "等待屏幕上出现指定文本（轮询语义树，默认最多 10 秒）。" +
			"点击/滑动后页面切换需要时间，用 wait_for 确认到达目标页再做后续操作/断言。" +
			"注意：Flutter 自绘文本若无语义标注则不可见，等待失败时改用 screenshot 判断。",
		Input:      WaitInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in WaitInput) (string, error) {
			return touchWrap(ctx, "wait_for", in, func() (string, error) {
				timeout := time.Duration(in.TimeoutS) * time.Second
				if timeout <= 0 {
					timeout = 10 * time.Second
				}
				if in.Text == "" {
					return "", fmt.Errorf("text 不能为空")
				}
				cctx, cancel := context.WithTimeout(ctx.Context, timeout+20*time.Second)
				defer cancel()
				start := time.Now()
				for {
					if xml, ok := dumpUI(cctx); ok && strings.Contains(xml, in.Text) {
						return fmt.Sprintf("已出现 %q（等待 %s）", in.Text, time.Since(start).Round(time.Millisecond)), nil
					}
					if time.Since(start) >= timeout {
						// 失败附证据：当前屏幕可见文本摘要（当场定位问题，
						// 不用模型再跑一轮 ui_tree 诊断）
						return "", fmt.Errorf("超时（%s）未见 %q。当前屏幕可见文本（前 15 条）：%s\n"+
							"判断：文本在列表里 → 已在页面但文本形式不同（部分匹配/含空格）；"+
							"不在 → 页面未到达或无语义标注（Flutter 自绘页面常见，改用 screenshot 判断）",
							timeout, in.Text, visibleTexts(dumpUIBestEffort(cctx), 15))
					}
					select {
					case <-ctx.Context.Done():
						return "", ctx.Context.Err()
					case <-time.After(500 * time.Millisecond):
					}
				}
			})
		},
	}
}

// ---------- 工具 3：screenshot（L4，稳定检测）+ screen_diff ----------

type ScreenshotInput struct {
	// Stable 稳定检测：截两帧间隔对比，动画面自动等到稳定（上限 3s）
	Stable bool `json:"stable,omitempty" desc:"等待画面稳定再截（默认 true：动画/滚动中自动等待，上限 3 秒）"`
}

// shotDir 截图存放目录（项目内 .yume/shots，随会话可见）。
// 按会话工作目录落位（单引擎多项目互不混目录）。
func shotDir(ctx context.Context) string {
	root := projectRootFrom(ctx)
	if root == "" {
		root = os.TempDir()
	}
	d := filepath.Join(root, ".yume", "shots")
	_ = os.MkdirAll(d, 0o755)
	return d
}

var pngMagic = []byte{0x89, 'P', 'N', 'G'}

// grabFrame 截一帧到本地路径。
// 首选 adb exec-out screencap -p：二进制安全通道。adb shell 会把输出里的
// \n (0x0A) 重写成 \r\n，而 PNG 压缩数据里到处是 0x0A——这是「截图文件
// 打不开/不支持的格式」的根因（魔数/IEND 校验测不出这种损坏，因为首尾
// 恰好不含 0x0A）。老 adb 无 exec-out 时回退 shell cat + adb pull。
func grabFrame(ctx context.Context) (string, []byte, error) {
	if bin, err := adbPath(); err == nil {
		if dev, err := adbDevice(ctx); err == nil {
			if out, err := exec.CommandContext(ctx, bin, "-s", dev, "exec-out", "screencap", "-p").Output(); err == nil && validPNG(out) {
				return writeShot(ctx, out)
			}
		}
	}
	// 回退：设备端落盘再取回（shell cat 损坏时用 adb pull 兜底）
	if _, err := adbRun(ctx, "shell", "screencap", "-p", "/sdcard/amc-shot.png"); err != nil {
		return "", nil, fmt.Errorf("screencap 失败: %v", err)
	}
	out, err := adbRun(ctx, "shell", "cat", "/sdcard/amc-shot.png")
	if err != nil {
		return "", nil, fmt.Errorf("读取截图失败: %v", err)
	}
	data := []byte(out)
	if idx := bytes.Index(data, pngMagic); idx < 0 || !validPNG(data) {
		// 数据被 shell 损坏：改用 adb pull（二进制安全）
		local := filepath.Join(shotDir(ctx), "tmp.png")
		bin, _ := adbPath()
		dev, _ := adbDevice(ctx)
		if err := exec.CommandContext(ctx, bin, "-s", dev, "pull", "/sdcard/amc-shot.png", local).Run(); err != nil {
			return "", nil, fmt.Errorf("截图传输失败: %v", err)
		}
		if data, err = os.ReadFile(local); err != nil {
			return "", nil, err
		}
	} else if idx > 0 {
		data = data[idx:] // 剥掉 shell 混入的前导输出
	}
	return writeShot(ctx, data)
}

// validPNG 完整解码校验：只有真正解得开才算好图。
func validPNG(data []byte) bool {
	_, err := png.Decode(bytes.NewReader(data))
	return err == nil
}

// writeShot 落盘截图文件，返回路径和数据。
func writeShot(ctx context.Context, data []byte) (string, []byte, error) {
	name := fmt.Sprintf("shot-%s.png", time.Now().Format("150405.000"))
	p := filepath.Join(shotDir(ctx), name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		return "", nil, err
	}
	return p, data, nil
}

// framesEqual 粗粒度像素对比（降采样 32x32 灰度，容忍压缩噪声）。
func framesEqual(a, b []byte) bool {
	ia, erra := png.Decode(bytes.NewReader(a))
	ib, errb := png.Decode(bytes.NewReader(b))
	if erra != nil || errb != nil {
		return false
	}
	const n = 32
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			ca := sampleGray(ia, x, y, n)
			cb := sampleGray(ib, x, y, n)
			d := ca - cb
			if d < -12 || d > 12 {
				return false
			}
		}
	}
	return true
}

func sampleGray(img image.Image, x, y, n int) int {
	b := img.Bounds()
	px := b.Min.X + b.Dx()*x/n
	py := b.Min.Y + b.Dy()*y/n
	r, g, bl, _ := img.At(px, py).RGBA()
	return int((r>>8 + g>>8 + bl>>8) / 3)
}

// ---------- 同画面截图去重（会话级最近一张缓存） ----------

type shotCacheEntry struct {
	path string
	data []byte
}

var (
	shotMu    sync.Mutex
	lastShots = map[string]shotCacheEntry{} // sessionID → 最近截图
)

// rememberShot 记录会话最近一次落盘的截图（去重比较用）。
func rememberShot(sessionID, path string, data []byte) {
	shotMu.Lock()
	defer shotMu.Unlock()
	lastShots[sessionID] = shotCacheEntry{path: path, data: data}
}

// lastShot 取会话最近一次截图；没有则 ok=false。
func lastShot(sessionID string) (shotCacheEntry, bool) {
	shotMu.Lock()
	defer shotMu.Unlock()
	e, ok := lastShots[sessionID]
	return e, ok
}

func NewScreenshotTool() (string, goagent.ToolDef) {
	return "screenshot", goagent.ToolDef{
		Description: "截图当前屏幕，返回本地文件路径。默认做画面稳定检测（动画/滚动中自动等 0.3-3 秒到稳定）。" +
			"用途：目视检查布局/白屏/错位；配合 screen_diff 做前后对比断言。" +
			"截图文件可直接交给 vision_ask（若可用）做语义判断。" +
			"【同画面复用】画面与最近一次截图相同时返回已有文件（不重复落盘）——" +
			"同一页面验证多个点时，第一次截图后页面没变就别再截，直接用返回的那个路径。",
		Input:      ScreenshotInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in ScreenshotInput) (string, error) {
			return touchWrap(ctx, "screenshot", in, func() (string, error) {
				cctx, cancel := context.WithTimeout(ctx.Context, 20*time.Second)
				defer cancel()
				_, cur, err := grabFrame(cctx)
				if err != nil {
					return "", err
				}
				animating := false
				if in.Stable { // 稳定检测：两帧一致才算稳定，上限 3s
					deadline := time.Now().Add(3 * time.Second)
					for time.Now().Before(deadline) {
						select {
						case <-ctx.Context.Done():
							return "", ctx.Context.Err()
						case <-time.After(300 * time.Millisecond):
						}
						_, next, err := grabFrame(cctx)
						if err != nil {
							break
						}
						if framesEqual(cur, next) {
							cur = next
							break
						}
						cur = next
						animating = true
					}
				}
				// 同画面去重：与该会话最近一次截图逐像素相同 → 复用已落盘
				// 文件。同一页面验证多个条目（标题/金额/按钮各一条）时，
				// 页面没变就不重复截图——省时且报告不堆重复图。
				if last, ok := lastShot(ctx.SessionID); ok && bytes.Equal(last.data, cur) {
					return fmt.Sprintf("截图: %s（画面与最近一次相同，已复用——同页面验证多个点时共用此图即可）", last.path), nil
				}
				h := sha1.Sum(cur)
				name := fmt.Sprintf("shot-%d-%s.png", time.Now().Unix(), hex.EncodeToString(h[:4]))
				p := filepath.Join(shotDir(ctx), name)
				if err := os.WriteFile(p, cur, 0o644); err != nil {
					return "", err
				}
				rememberShot(ctx.SessionID, p, cur)
				status := "画面稳定"
				if animating {
					status = "仍在运动（3s 未稳定，此帧不可用于像素断言，仅供粗看）"
				}
				return fmt.Sprintf("截图: %s（%s）", p, status), nil
			})
		},
	}
}

type DiffInput struct {
	Before string `json:"before" desc:"第一张截图路径" required:"true"`
	After  string `json:"after" desc:"第二张截图路径" required:"true"`
	// 基线管理（可选动作）：save 把 after 存为命名基线；check 把当前屏幕
	// 与命名基线对比（截图+diff 一步完成）。Before 字段此时填 tag 名。
	Action string `json:"action,omitempty" desc:"save=把 after 截图存为基线（before 填 tag 名）；check=截当前屏幕与基线对比（before 填 tag 名）。不填=普通两图对比"`
}

// baselineDir 基线存放目录（.yume/baselines/<tag>.png）。基线是「该页面
// 应该长这样」的黄金截图：UI 重构后 save 刷新，回归测试 check 复用。
func baselineDir(ctx context.Context) string {
	root := projectRootFrom(ctx)
	if root == "" {
		root = os.TempDir()
	}
	d := filepath.Join(root, ".yume", "baselines")
	_ = os.MkdirAll(d, 0o755)
	return d
}

// baselinePath tag → 基线文件路径（tag 消毒：只留安全字符）。
func baselinePath(ctx context.Context, tag string) string {
	safe := regexp.MustCompile(`[^\w.-]`).ReplaceAllString(tag, "_")
	return filepath.Join(baselineDir(ctx), safe+".png")
}

// NewScreenDiffTool 像素 diff（L4 零模型断言）：降采样网格对比，
// 返回差异率 + 分区描述。阈值参考：>3% 视觉上可感知。
func NewScreenDiffTool() (string, goagent.ToolDef) {
	return "screen_diff", goagent.ToolDef{
		Description: "对比两张截图的像素差异（降采样网格）。用途：改动前后是否生效（diff≈0 = 无变化）、" +
			"白屏/崩溃检测（整屏单色）。差异率 >3% 通常代表可见变化。\n" +
			"【基线模式】action=save：把 after 截图存为命名基线（before 填 tag，如 \"home\"）——" +
			"该页面的黄金截图。action=check：截当前屏幕与基线对比（before 填 tag）——" +
			"回归测试的标准姿势：改动前 save，改动后 check，diff≈0 即 UI 未被破坏。" +
			"基线存 .yume/baselines/<tag>.png，UI 故意改版后重新 save 刷新。",
		Input:      DiffInput{},
		Permission: goagent.ReadOnly,
		Concurrent: true,
		Execute: func(ctx goagent.Context, in DiffInput) (string, error) {
			// ---- 基线管理动作 ----
			if in.Action == "save" {
				if in.Before == "" || in.After == "" {
					return "", fmt.Errorf("save 需要 before=tag名 和 after=截图路径")
				}
				data, err := os.ReadFile(in.After)
				if err != nil {
					return "", fmt.Errorf("读 %s 失败: %v", in.After, err)
				}
				dst := baselinePath(ctx, in.Before)
				if err := os.WriteFile(dst, data, 0o644); err != nil {
					return "", fmt.Errorf("写基线失败: %v", err)
				}
				return fmt.Sprintf("已保存基线 %q → %s（后续用 action=check 对比）", in.Before, dst), nil
			}
			if in.Action == "check" {
				if in.Before == "" {
					return "", fmt.Errorf("check 需要 before=tag名")
				}
				baseFile := baselinePath(ctx, in.Before)
				if _, err := os.Stat(baseFile); err != nil {
					return "", fmt.Errorf("基线 %q 不存在（%s）——先 action=save 创建", in.Before, baseFile)
				}
				// 截当前屏幕
				curFile, _, err := grabFrame(ctx)
				if err != nil {
					return "", fmt.Errorf("截屏失败: %v", err)
				}
				out, err := diffPNGs(baseFile, curFile)
				if err != nil {
					return "", err
				}
				return fmt.Sprintf("基线 %q vs 当前屏幕（%s）：%s", in.Before, curFile, out), nil
			}
			// ---- 普通两图对比 ----
			return diffPNGs(in.Before, in.After)
		},
	}
}

// diffPNGs 对比两张 PNG，返回人话结论（复用 24x24 降采样网格）。
func diffPNGs(a, b string) (string, error) {
	da, err := os.ReadFile(a)
	if err != nil {
		return "", fmt.Errorf("读 %s 失败: %v", a, err)
	}
	db, err := os.ReadFile(b)
	if err != nil {
		return "", fmt.Errorf("读 %s 失败: %v", b, err)
	}
	ia, erra := png.Decode(bytes.NewReader(da))
	ib, errb := png.Decode(bytes.NewReader(db))
	if erra != nil || errb != nil {
		return "", fmt.Errorf("PNG 解码失败")
	}
	const n = 24
	diff := 0
	var regions []string
	for y := 0; y < n; y++ {
		rowDiff := 0
		for x := 0; x < n; x++ {
			if abs(sampleGray(ia, x, y, n)-sampleGray(ib, x, y, n)) > 12 {
				diff++
				rowDiff++
			}
		}
		if rowDiff > n/3 {
			regions = append(regions, fmt.Sprintf("第%d/%d行带", y+1, n))
		}
	}
	rate := float64(diff) / float64(n*n) * 100
	verdict := "无可见变化"
	if rate > 3 {
		verdict = "有可见变化"
	}
	out := fmt.Sprintf("差异率 %.1f%%（%s）", rate, verdict)
	if len(regions) > 0 && len(regions) <= 6 {
		out += "；变化集中: " + strings.Join(regions[:3], ", ")
	}
	return out, nil
}

func abs(i int) int {
	if i < 0 {
		return -i
	}
	return i
}

// ---------- 工具 4：logcat（L3 行为断言） ----------

type LogcatInput struct {
	Tag     string `json:"tag,omitempty" desc:"过滤 tag（flutter 应用日志 tag 是 flutter）"`
	Level   string `json:"level,omitempty" desc:"最低级别: V/D/I/W/E，默认 D"`
	Seconds int    `json:"seconds,omitempty" desc:"抓取最近 N 秒，默认 5（先清缓冲再操作后抓可拿增量）"`
	Clear   bool   `json:"clear,omitempty" desc:"先清空缓冲（配合随后操作抓增量日志）"`
}

func NewLogcatTool() (string, goagent.ToolDef) {
	return "logcat", goagent.ToolDef{
		Description: "读取设备日志（logcat）。行为断言：点登录后有没有 crash、有没有打出关键日志、" +
			"flutter 异常（tag=flutter）都在这里。clear=true 清空后做操作再抓 = 增量日志。",
		Input:      LogcatInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in LogcatInput) (string, error) {
			return touchWrap(ctx, "logcat", in, func() (string, error) {
				cctx, cancel := context.WithTimeout(ctx.Context, 15*time.Second)
				defer cancel()
				if in.Clear {
					if _, err := adbRun(cctx, "logcat", "-c"); err != nil {
						return "", fmt.Errorf("清空 logcat 失败: %v", err)
					}
					return "已清空 logcat 缓冲——现在做操作，然后再调 logcat（不带 clear）抓增量", nil
				}
				args := []string{"logcat", "-d"}
				// -t 接行数（近 N 秒按 ~100 行/秒估算上限，取尾部）
				if in.Tag != "" {
					args = append(args, "-s", in.Tag+levelSuffix(in.Level))
				} else if in.Level != "" {
					args = append(args, "*:"+strings.ToUpper(in.Level[:1]))
				}
				args = append(args, "-t", strconv.Itoa(in.secondsOrDefault()*100))
				out, err := adbRun(cctx, args...)
				if err != nil {
					return "", fmt.Errorf("logcat 失败: %v", err)
				}
				const max = 12000
				s := out
				if len(s) > max {
					s = s[len(s)-max:]
				}
				return s, nil
			})
		},
	}
}

func (l LogcatInput) secondsOrDefault() int {
	if l.Seconds > 0 {
		return l.Seconds
	}
	return 5
}

func levelSuffix(level string) string {
	if level == "" {
		return ""
	}
	return ":" + strings.ToUpper(level[:1])
}

// ---------- 工具 5：网络层（L6 前后端联调） ----------
//
// 形态：本机起一个轻量录制代理（默认 127.0.0.1:18420），app 的 API 基址指到
// 设备侧 localhost 同端口，adb reverse 把设备端口映射回来。代理转发到真实
// 后端并记录请求/响应；net_mock 模式下命中规则的请求直接返回伪造响应。

type NetInput struct {
	Action string `json:"action" desc:"动作" enum:"reverse,unreverse,record_start,record_stop,mock,mock_clear,backend" required:"true"`
	// reverse：端口映射。backend：真实后端地址（record 转发目标）
	Port    int    `json:"port,omitempty" desc:"设备侧端口（reverse/录制），默认 8000"`
	Backend string `json:"backend,omitempty" desc:"真实后端地址（http://127.0.0.1:8080），record 模式转发目标"`
	// mock：JSON 数组 [{match:"METHOD /path 正则", status:200, body:"...", delay_ms:0}]
	Mocks string `json:"mocks,omitempty" desc:"mock 规则 JSON 数组（action=mock 时）"`
}

type netRecord struct {
	mu       sync.Mutex
	proxy    *recProxy
	backend  string
	mocks    []mockRule
	requests []string
	logRoot  string // 网络日志落盘根（启动录制的会话的项目目录）
}

var netState = &netRecord{}

// netLogPath 网络日志落盘（前端「网络」页签轮询此文件实时展示）。
// JSONL：每行 {ts, method, path, status, mock}。
// logRoot 由 record_start 时按会话工作目录确定——录制代理的 goroutine
// 拿不到会话 ctx，落盘位置跟着「谁启动了录制」走。
func netLogPath() string {
	netState.mu.Lock()
	root := netState.logRoot
	netState.mu.Unlock()
	if root == "" {
		root = projectRoot()
	}
	if root == "" {
		root = os.TempDir()
	}
	return filepath.Join(root, ".yume", "net-log.jsonl")
}

// appendNetLog 追加一条请求记录到落盘文件（失败静默：不影响录制主流程）。
func appendNetLog(method, path string, status int, isMock bool) {
	root := func() string {
		netState.mu.Lock()
		defer netState.mu.Unlock()
		return netState.logRoot
	}()
	if root == "" {
		root = projectRoot()
	}
	if root == "" {
		return
	}
	f, err := os.OpenFile(netLogPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	entry := map[string]any{
		"ts":     time.Now().Format("15:04:05"),
		"method": method,
		"path":   path,
		"status": status,
	}
	if isMock {
		entry["mock"] = true
	}
	b, _ := json.Marshal(entry)
	_, _ = f.Write(append(b, '\n'))
}

// NewNetTool 网络联调三件套：端口映射（reverse）、流量录制断言（record）、
// 响应伪造（mock）——前后端联调与异常分支测试的基础设施。
func NewNetTool() (string, goagent.ToolDef) {
	return "net", goagent.ToolDef{
		Description: "前后端联调与网络测试。action: " +
			"reverse（adb reverse 端口映射，设备 localhost:port → 本机）· " +
			"backend+record_start（启动录制代理：app 请求经代理到真实后端，全程记录）· " +
			"record_stop（停止并返回录制的请求列表，供断言）· " +
			"mock（伪造响应规则，测异常分支：[{match:\"POST /login\", status:500, body:\"{}\"}]）· " +
			"mock_clear · unreverse。典型联调：backend→reverse→record_start→操作 app→record_stop→断言请求。",
		Input:      NetInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in NetInput) (string, error) {
			cctx, cancel := context.WithTimeout(ctx.Context, 30*time.Second)
			defer cancel()
			switch in.Action {
			case "reverse":
				// reverse 操作 adb，需持设备锁（本机录制代理类操作不碰设备，不进锁）
				return touchWrap(ctx, "net", in, func() (string, error) {
					port := in.portOrDefault()
					if _, err := adbRun(cctx, "reverse", fmt.Sprintf("tcp:%d", port), fmt.Sprintf("tcp:%d", port)); err != nil {
						return "", fmt.Errorf("adb reverse 失败: %v", err)
					}
					return fmt.Sprintf("设备 localhost:%d → 本机 %d（app 的 API 基址用 http://localhost:%d）", port, port, port), nil
				})
			case "unreverse":
				return touchWrap(ctx, "net", in, func() (string, error) {
					_, _ = adbRun(cctx, "reverse", "--remove-all")
					return "已移除全部端口映射", nil
				})
			case "backend":
				if in.Backend == "" {
					return "", fmt.Errorf("backend 不能为空（如 http://127.0.0.1:8080）")
				}
				netState.mu.Lock()
				netState.backend = in.Backend
				netState.mu.Unlock()
				return fmt.Sprintf("后端已设为 %s", in.Backend), nil
			case "record_start":
				// 落盘目录锚定到本会话的项目根（代理 goroutine 无会话 ctx）
				netState.mu.Lock()
				netState.logRoot = projectRootFrom(ctx)
				netState.mu.Unlock()
				if err := startRecProxy(); err != nil {
					return "", err
				}
				// 清空旧网络日志（前端页签以本文件为准，每次录制重新开始）
				_ = os.Remove(netLogPath())
				return fmt.Sprintf("录制代理已启动（127.0.0.1:%d）——记得先 reverse 该端口", recProxyPort), nil
			case "record_stop":
				return stopRecProxy(), nil
			case "mock":
				var rules []mockRule
				if err := json.Unmarshal([]byte(in.Mocks), &rules); err != nil {
					return "", fmt.Errorf("mocks 必须是 JSON 数组: %v", err)
				}
				netState.mu.Lock()
				netState.mocks = rules
				netState.mu.Unlock()
				return fmt.Sprintf("已生效 %d 条 mock 规则（优先于转发后端）", len(rules)), nil
			case "mock_clear":
				netState.mu.Lock()
				netState.mocks = nil
				netState.mu.Unlock()
				return "已清空 mock 规则", nil
			default:
				return "", fmt.Errorf("未知 action %q", in.Action)
			}
		},
	}
}

func (n NetInput) portOrDefault() int {
	if n.Port > 0 {
		return n.Port
	}
	return 8000
}

// ---- 录制代理（net/http 实现，记录 + mock + 转发） ----

const recProxyPort = 18420

type mockRule struct {
	Match   string `json:"match"`    // "POST /api/login" 前缀或精确
	Status  int    `json:"status"`   // 默认 200
	Body    string `json:"body"`     // 响应体
	DelayMs int    `json:"delay_ms"` // 延迟（模拟慢网络）
}

func (n *netRecord) snapshot() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]string{}, n.requests...)
}

func startRecProxy() error {
	netState.mu.Lock()
	defer netState.mu.Unlock()
	if netState.proxy != nil {
		return nil // 已在跑
	}
	mux := http.NewServeMux()
	srv := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", recProxyPort), Handler: mux}
	p := &recProxy{srv: srv}
	mux.HandleFunc("/", p.handle)
	ln, err := net.Listen("tcp", srv.Addr)
	if err != nil {
		return fmt.Errorf("录制代理端口占用（%d）: %v", recProxyPort, err)
	}
	netState.proxy = p
	netState.requests = nil
	go func() { _ = srv.Serve(ln) }()
	return nil
}

func stopRecProxy() string {
	netState.mu.Lock()
	p := netState.proxy
	reqs := append([]string{}, netState.requests...)
	netState.proxy = nil
	netState.mu.Unlock()
	if p != nil {
		_ = p.srv.Close()
	}
	if len(reqs) == 0 {
		return "录制停止；期间无请求（检查 app API 基址与 reverse 端口）"
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("录制停止；共 %d 条请求：\n", len(reqs)))
	for i, r := range reqs {
		sb.WriteString(fmt.Sprintf("%d. %s\n", i+1, r))
	}
	return sb.String()
}

// recProxy 极简 HTTP 代理：不追求协议完备，覆盖 JSON API 足矣。
type recProxy struct {
	srv *http.Server
}

func (p *recProxy) handle(w http.ResponseWriter, r *http.Request) {
	netState.mu.Lock()
	backend := netState.backend
	mocks := netState.mocks
	netState.mu.Unlock()

	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	_ = r.Body.Close()

	// 1. mock 命中检查（优先于转发）
	for _, m := range mocks {
		if matchReq(m.Match, r.Method, r.URL.Path) {
			if m.DelayMs > 0 {
				time.Sleep(time.Duration(m.DelayMs) * time.Millisecond)
			}
			netState.mu.Lock()
			netState.requests = append(netState.requests,
				fmt.Sprintf("%s %s body=%s → [MOCK %d] %s", r.Method, r.URL.Path, truncate(string(body), 160), m.Status, truncate(m.Body, 120)))
			netState.mu.Unlock()
			appendNetLog(r.Method, r.URL.Path, m.Status, true)
			w.WriteHeader(m.Status)
			_, _ = w.Write([]byte(m.Body))
			return
		}
	}
	// 2. 转发后端并记录
	status, respBody := forward(backend, r.Method, r.URL.Path, string(body))
	netState.mu.Lock()
	netState.requests = append(netState.requests,
		fmt.Sprintf("%s %s body=%s → %d %s", r.Method, r.URL.Path, truncate(string(body), 160), status, truncate(respBody, 120)))
	netState.mu.Unlock()
	appendNetLog(r.Method, r.URL.Path, status, false)
	w.WriteHeader(status)
	_, _ = w.Write([]byte(respBody))
}

// forward 转发到真实后端（backend + path）。
func forward(backend, method, path, body string) (int, string) {
	if backend == "" {
		return http.StatusBadGateway, `{"error":"backend 未设置（先 action=backend）"}`
	}
	u := strings.TrimSuffix(backend, "/") + path
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, u, rd)
	if err != nil {
		return http.StatusBadGateway, fmt.Sprintf(`{"error":"%v"}`, err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return http.StatusBadGateway, fmt.Sprintf(`{"error":"%v"}`, err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode, string(b)
}

var httpClient = &http.Client{Timeout: 30 * time.Second}

func matchReq(match, method, path string) bool {
	// "POST /api/login" → method+path 前缀匹配；只有 path → 任意方法
	m := strings.ToUpper(strings.TrimSpace(match))
	if f := strings.Fields(m); len(f) == 2 {
		return strings.HasPrefix(method+" "+path, f[0]+" "+f[1])
	}
	return strings.Contains(path, m)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
