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
)

// ---------- adb 基础 ----------

var (
	adbMu      sync.Mutex // adb 设备操作串行：input 命令乱序会导致点击序列错乱
	adbBinPath string
)

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
}

func NewTapTool() (string, goagent.ToolDef) {
	return "tap", goagent.ToolDef{
		Description: "点击设备屏幕坐标（adb input tap）。坐标来自 ui_tree 节点的 bounds 或截图目测。" +
			"点击后如需确认结果，用 ui_tree 或 screenshot 验证。",
		Input:      TapInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in TapInput) (string, error) {
			adbMu.Lock()
			defer adbMu.Unlock()
			cctx, cancel := context.WithTimeout(ctx.Context, 10*time.Second)
			defer cancel()
			if _, err := adbRun(cctx, "shell", "input", "tap",
				strconv.Itoa(in.X), strconv.Itoa(in.Y)); err != nil {
				return "", fmt.Errorf("tap 失败: %v", err)
			}
			return fmt.Sprintf("已点击 (%d,%d)", in.X, in.Y), nil
		},
	}
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
			adbMu.Lock()
			defer adbMu.Unlock()
			cctx, cancel := context.WithTimeout(ctx.Context, 15*time.Second)
			defer cancel()
			// adb input text 的空格处理：用 %s；转义特殊字符
			safe := strings.ReplaceAll(in.Text, " ", "%s")
			if _, err := adbRun(cctx, "shell", "input", "text", safe); err != nil {
				return "", fmt.Errorf("输入失败: %v", err)
			}
			return fmt.Sprintf("已输入 %q", in.Text), nil
		},
	}
}

func NewBackTool() (string, goagent.ToolDef) {
	return "back", goagent.ToolDef{
		Description: "按返回键（adb shell input keyevent 4）。关闭弹窗/返回上一页。",
		Input:       struct{}{},
		Permission:  goagent.ReadOnly,
		Concurrent:  false,
		Execute: func(ctx goagent.Context, _ struct{}) (string, error) {
			adbMu.Lock()
			defer adbMu.Unlock()
			cctx, cancel := context.WithTimeout(ctx.Context, 10*time.Second)
			defer cancel()
			if _, err := adbRun(cctx, "shell", "input", "keyevent", "4"); err != nil {
				return "", fmt.Errorf("back 失败: %v", err)
			}
			return "已按返回", nil
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
				if _, err := adbRun(cctx, "shell", "uiautomator", "dump", "/sdcard/amc-ui.xml"); err == nil {
					if xmlOut, err := adbRun(cctx, "shell", "cat", "/sdcard/amc-ui.xml"); err == nil {
						if strings.Contains(extractXML(xmlOut), in.Text) {
							return fmt.Sprintf("已出现 %q（等待 %s）", in.Text, time.Since(start).Round(time.Millisecond)), nil
						}
					}
				}
				if time.Since(start) >= timeout {
					return fmt.Sprintf("超时（%s）未见 %q——页面未跳转或文本无语义标注", timeout, in.Text), nil
				}
				select {
				case <-ctx.Context.Done():
					return "", ctx.Context.Err()
				case <-time.After(500 * time.Millisecond):
				}
			}
		},
	}
}

// ---------- 工具 3：screenshot（L4，稳定检测）+ screen_diff ----------

type ScreenshotInput struct {
	// Stable 稳定检测：截两帧间隔对比，动画面自动等到稳定（上限 3s）
	Stable bool `json:"stable,omitempty" desc:"等待画面稳定再截（默认 true：动画/滚动中自动等待，上限 3 秒）"`
}

// shotDir 截图存放目录（项目内 .yume/shots，随会话可见）。
func shotDir() string {
	root := projectRoot()
	if root == "" {
		root = os.TempDir()
	}
	d := filepath.Join(root, ".yume", "shots")
	_ = os.MkdirAll(d, 0o755)
	return d
}

// grabFrame 截一帧到本地路径。
func grabFrame(ctx context.Context) (string, []byte, error) {
	if _, err := adbRun(ctx, "shell", "screencap", "-p", "/sdcard/amc-shot.png"); err != nil {
		return "", nil, fmt.Errorf("screencap 失败: %v", err)
	}
	out, err := adbRun(ctx, "shell", "cat", "/sdcard/amc-shot.png")
	if err != nil {
		return "", nil, fmt.Errorf("读取截图失败: %v", err)
	}
	// adb shell 可能做 \r\n → \n 破坏 PNG：以 PNG 魔数定位起点，失败时提示用 pull
	data := []byte(out)
	idx := bytes.Index(data, []byte{0x89, 'P', 'N', 'G'})
	if idx < 0 || !bytes.HasSuffix(bytes.TrimSpace(data), []byte("IEND\xaeB`\x82")) {
		// 数据被 shell 损坏：改用 adb pull（二进制安全）
		local := filepath.Join(shotDir(), "tmp.png")
		bin, _ := adbPath()
		dev, _ := adbDevice(ctx)
		if err := exec.CommandContext(ctx, bin, "-s", dev, "pull", "/sdcard/amc-shot.png", local).Run(); err != nil {
			return "", nil, fmt.Errorf("截图传输失败: %v", err)
		}
		data, err = os.ReadFile(local)
		if err != nil {
			return "", nil, err
		}
	}
	name := fmt.Sprintf("shot-%s.png", time.Now().Format("150405.000"))
	p := filepath.Join(shotDir(), name)
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

func NewScreenshotTool() (string, goagent.ToolDef) {
	return "screenshot", goagent.ToolDef{
		Description: "截图当前屏幕，返回本地文件路径。默认做画面稳定检测（动画/滚动中自动等 0.3-3 秒到稳定）。" +
			"用途：目视检查布局/白屏/错位；配合 screen_diff 做前后对比断言。" +
			"截图文件可直接交给 vision_ask（若可用）做语义判断。",
		Input:      ScreenshotInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in ScreenshotInput) (string, error) {
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
			h := sha1.Sum(cur)
			name := fmt.Sprintf("shot-%d-%s.png", time.Now().Unix(), hex.EncodeToString(h[:4]))
			p := filepath.Join(shotDir(), name)
			if err := os.WriteFile(p, cur, 0o644); err != nil {
				return "", err
			}
			status := "画面稳定"
			if animating {
				status = "仍在运动（3s 未稳定，此帧不可用于像素断言，仅供粗看）"
			}
			return fmt.Sprintf("截图: %s（%s）", p, status), nil
		},
	}
}

type DiffInput struct {
	Before string `json:"before" desc:"第一张截图路径" required:"true"`
	After  string `json:"after" desc:"第二张截图路径" required:"true"`
}

// NewScreenDiffTool 像素 diff（L4 零模型断言）：降采样网格对比，
// 返回差异率 + 分区描述。阈值参考：>3% 视觉上可感知。
func NewScreenDiffTool() (string, goagent.ToolDef) {
	return "screen_diff", goagent.ToolDef{
		Description: "对比两张截图的像素差异（降采样网格）。用途：改动前后是否生效（diff≈0 = 无变化）、" +
			"白屏/崩溃检测（整屏单色）。差异率 >3% 通常代表可见变化。",
		Input:      DiffInput{},
		Permission: goagent.ReadOnly,
		Concurrent: true,
		Execute: func(ctx goagent.Context, in DiffInput) (string, error) {
			da, err := os.ReadFile(in.Before)
			if err != nil {
				return "", fmt.Errorf("读 %s 失败: %v", in.Before, err)
			}
			db, err := os.ReadFile(in.After)
			if err != nil {
				return "", fmt.Errorf("读 %s 失败: %v", in.After, err)
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
		},
	}
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
}

var netState = &netRecord{}

// netLogPath 网络日志落盘（前端「网络」页签轮询此文件实时展示）。
// JSONL：每行 {ts, method, path, status, mock}。
func netLogPath() string {
	root := projectRoot()
	if root == "" {
		root = os.TempDir()
	}
	return filepath.Join(root, ".yume", "net-log.jsonl")
}

// appendNetLog 追加一条请求记录到落盘文件（失败静默：不影响录制主流程）。
func appendNetLog(method, path string, status int, isMock bool) {
	root := projectRoot()
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
				port := in.portOrDefault()
				if _, err := adbRun(cctx, "reverse", fmt.Sprintf("tcp:%d", port), fmt.Sprintf("tcp:%d", port)); err != nil {
					return "", fmt.Errorf("adb reverse 失败: %v", err)
				}
				return fmt.Sprintf("设备 localhost:%d → 本机 %d（app 的 API 基址用 http://localhost:%d）", port, port, port), nil
			case "unreverse":
				_, _ = adbRun(cctx, "reverse", "--remove-all")
				return "已移除全部端口映射", nil
			case "backend":
				if in.Backend == "" {
					return "", fmt.Errorf("backend 不能为空（如 http://127.0.0.1:8080）")
				}
				netState.mu.Lock()
				netState.backend = in.Backend
				netState.mu.Unlock()
				return fmt.Sprintf("后端已设为 %s", in.Backend), nil
			case "record_start":
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
