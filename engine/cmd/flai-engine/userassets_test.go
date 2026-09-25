package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	goagent "github.com/Dream355873200/GoAgent"
)

const dirField = `"projectFields":[{"id":"dir","label":"目录","type":"folder"}]`

func writeAsset(t *testing.T, root, rel, content string) {
	t.Helper()
	p := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func hasLoadError(errs []LoadError, kind, id string) bool {
	for _, e := range errs {
		if e.Kind == kind && e.ID == id {
			return true
		}
	}
	return false
}

// TestUserAssets 用户资产根：同 id 覆盖内置、坏项逐项跳过不拖垮其他项、
// 用户提示词组可被模式引用。
func TestUserAssets(t *testing.T) {
	user := t.TempDir()
	t.Setenv("FLAI_USER_DIR", user)
	writeAsset(t, user, "modes/code/mode.json", `{"name":"我的 code","plugins":["explore"],`+dirField+`}`)
	writeAsset(t, user, "modes/bad/mode.json", `{"name":`)
	writeAsset(t, user, "modes/dangling/mode.json", `{"name":"悬空","plugins":["nope"],`+dirField+`}`)
	writeAsset(t, user, "modes/mine/mode.json", `{"name":"自建","prompts":"mine","plugins":["explore"],`+dirField+`}`)
	writeAsset(t, user, "plugins/broken/plugin.json", `{"name":"坏插件","toolsets":["nope"]}`)
	writeAsset(t, user, "prompts/mine/system-identity.prompt.md", "你是自建助手")

	cat, err := LoadCatalog("code")
	if err != nil {
		t.Fatal(err)
	}
	if m := cat.Mode("code"); m == nil || m.Name != "我的 code" || m.Origin != originUser {
		t.Fatalf("用户 code 模式应覆盖内置: %+v", m)
	}
	if m := cat.Mode("flutter"); m == nil || m.Origin != originBundled {
		t.Fatal("内置 flutter 模式应照常可用")
	}
	for _, e := range [][2]string{{"mode", "bad"}, {"mode", "dangling"}, {"plugin", "broken"}} {
		if !hasLoadError(cat.Errors, e[0], e[1]) {
			t.Errorf("应记录 %s %s 的加载错误: %v", e[0], e[1], cat.Errors)
		}
	}
	if cat.Mode("bad") != nil || cat.Mode("dangling") != nil {
		t.Error("坏模式不应进目录")
	}
	mine := cat.Mode("mine")
	if mine == nil || !strings.HasPrefix(mine.Resolved.PromptDir, user) {
		t.Fatalf("自建模式应引用用户提示词组: %+v", mine)
	}
}

// TestDefaultModeFallback 默认模式不可用回退首个可用模式；一个可用模式都没有才报错。
func TestDefaultModeFallback(t *testing.T) {
	cat, err := LoadCatalog("gone")
	if err != nil {
		t.Fatal(err)
	}
	if cat.DefaultMode != cat.Modes[0].ID || !hasLoadError(cat.Errors, "mode", "gone") {
		t.Fatalf("应回退到 %s 并记错，得到 %s %v", cat.Modes[0].ID, cat.DefaultMode, cat.Errors)
	}
	t.Setenv("FLAI_MODES_DIR", t.TempDir())
	if _, err := LoadCatalog("code"); err == nil {
		t.Fatal("无可用模式应返回错误")
	}
}

// TestReloadHidesRemovedAgents 重载后不再被引用的插件子代理下线（对全部会话不可见），
// 恢复引用后重新可见。
func TestReloadHidesRemovedAgents(t *testing.T) {
	sessMap = &sessionMap{path: filepath.Join(t.TempDir(), "session-map.json")}
	app := goagent.New(goagent.WithBuiltinTools())
	full, err := LoadCatalog("code")
	if err != nil {
		t.Fatal(err)
	}
	setCatalog(full)
	if errs := syncAgents(app, full); len(errs) > 0 {
		t.Fatal(errs)
	}
	if !sessionToolVisible("s", "Agent_explore") {
		t.Fatal("初始应可见 Agent_explore")
	}

	modes := t.TempDir()
	writeAsset(t, modes, "solo/mode.json", `{"name":"独立","plugins":[],`+dirField+`}`)
	t.Setenv("FLAI_MODES_DIR", modes)
	configuredDefaultMode = "solo"
	solo, err := reloadCatalog(app)
	if err != nil {
		t.Fatal(err)
	}
	if solo.DefaultMode != "solo" || sessionToolVisible("s", "Agent_explore") {
		t.Fatal("移除引用后 Agent_explore 应下线")
	}

	t.Setenv("FLAI_MODES_DIR", "")
	configuredDefaultMode = "code"
	if _, err := reloadCatalog(app); err != nil {
		t.Fatal(err)
	}
	if !sessionToolVisible("s", "Agent_explore") {
		t.Fatal("恢复引用后 Agent_explore 应重新可见")
	}
}

// TestPluginDisabled 插件停用：对模式隐形（能力不聚合、清单不报错），
// 已装配的子代理经生命周期表下线，重新启用后恢复。
func TestPluginDisabled(t *testing.T) {
	sessMap = &sessionMap{path: filepath.Join(t.TempDir(), "session-map.json")}
	app := goagent.New(goagent.WithBuiltinTools())
	full, err := LoadCatalog("code")
	if err != nil {
		t.Fatal(err)
	}
	setCatalog(full)
	if errs := syncAgents(app, full); len(errs) > 0 {
		t.Fatal(errs)
	}
	if !sessionToolVisible("s", "Agent_explore") {
		t.Fatal("初始应可见 Agent_explore")
	}

	// 停用 explore 插件（其子代理应下线）
	t.Setenv("FLAI_USER_DIR", t.TempDir())
	if err := saveDisabledSet(map[string]bool{"explore": true}); err != nil {
		t.Fatal(err)
	}
	disabled, err := reloadCatalog(app)
	if err != nil {
		t.Fatal(err)
	}
	if len(disabled.Errors) > 0 {
		t.Fatalf("停用不应产生加载错误: %v", disabled.Errors)
	}
	if p := findPlugin(disabled, "explore"); p == nil || !p.Disabled {
		t.Fatal("explore 应标记 Disabled")
	}
	if len(disabled.UsedPlugins()) != len(disabled.Plugins)-countDisabled(disabled) {
		t.Fatal("停用插件不应参与装配")
	}
	if sessionToolVisible("s", "Agent_explore") {
		t.Fatal("停用后 Agent_explore 应下线")
	}
	if m := disabled.Mode("code"); m == nil || contains(m.Resolved.Agents, "explore") {
		t.Fatal("停用插件的能力不应聚进模式视图")
	}

	// 重新启用：子代理恢复
	if err := saveDisabledSet(map[string]bool{}); err != nil {
		t.Fatal(err)
	}
	enabled, err := reloadCatalog(app)
	if err != nil {
		t.Fatal(err)
	}
	if len(enabled.Errors) > 0 {
		t.Fatalf("启用不应产生加载错误: %v", enabled.Errors)
	}
	if !sessionToolVisible("s", "Agent_explore") {
		t.Fatal("重新启用后 Agent_explore 应恢复")
	}
}

func findPlugin(c *Catalog, id string) *Plugin {
	for _, p := range c.Plugins {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func countDisabled(c *Catalog) int {
	n := 0
	for _, p := range c.Plugins {
		if p.Disabled {
			n++
		}
	}
	return n
}
