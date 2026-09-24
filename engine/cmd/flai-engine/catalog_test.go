package main

import (
	"os"
	"path/filepath"
	"testing"

	goagent "github.com/Dream355873200/GoAgent"
)

// TestCatalogAssets 仓库内的模式/插件清单全部合规，且会话级能力按模式隔离。
func TestCatalogAssets(t *testing.T) {
	cat, err := LoadCatalog("flutter")
	if err != nil {
		t.Fatalf("LoadCatalog: %v", err)
	}
	catalog = cat
	sessMap = &sessionMap{path: filepath.Join(t.TempDir(), "session-map.json")}

	code, flutter := cat.Mode("code"), cat.Mode("flutter")
	if code == nil || flutter == nil {
		t.Fatal("缺少 code / flutter 模式")
	}
	if len(code.Resolved.Toolsets) != 0 {
		t.Errorf("code 模式不应启用领域工具集: %v", code.Resolved.Toolsets)
	}
	for _, ts := range []string{"flutter", "device", "test-report"} {
		if !flutter.HasToolset(ts) {
			t.Errorf("flutter 模式缺工具集 %s", ts)
		}
	}
	if code.Resolved.PromptDir != "" {
		t.Errorf("code 模式应使用内置通用提示词，得到 %s", code.Resolved.PromptDir)
	}
	if flutter.Resolved.PromptDir == "" {
		t.Error("flutter 模式应引用提示词组")
	}

	// 未绑定会话走默认模式（flutter）
	if !sessionToolVisible("s1", "flutter") || !sessionToolVisible("s1", "tap") {
		t.Error("默认模式会话应可见 flutter/tap")
	}
	// base 工具恒可见
	if !sessionToolVisible("s1", "Bash") {
		t.Error("base 工具应恒可见")
	}
	// 绑定 code 模式的会话看不到领域工具，也不注入设备上下文
	//（绑定文件不存在时 reload 不覆盖内存表，直接写 m 即可）
	sessMap.m = map[string]sessionBinding{"s2": {Dir: t.TempDir(), Mode: "code"}}
	if sessionToolVisible("s2", "flutter") || sessionToolVisible("s2", "ui_tree") {
		t.Error("code 模式会话不应可见领域工具")
	}
	for _, f := range sessionContextFiles("s2") {
		if f == deviceCtxPath {
			t.Error("code 模式会话不应注入 DEVICE.md")
		}
	}

	// 插件子代理：两个模式都引用 explore 插件，Agent_explore 均可见
	if !sessionToolVisible("s1", "Agent_explore") || !sessionToolVisible("s2", "Agent_explore") {
		t.Error("引用 explore 插件的模式会话应可见 Agent_explore")
	}
	// 插件归属的动态工具（MCP）：只对引用该插件的模式可见
	cat.setPluginOwner("mcp__x__y", "android-device")
	if !sessionToolVisible("s1", "mcp__x__y") || sessionToolVisible("s2", "mcp__x__y") {
		t.Error("插件 MCP 工具应只对引用该插件的模式可见")
	}
}

// TestInstallAgents 仓库内的子代理在真实工具注册表上装配通过（引用的工具
// 存在且只读），并注册为 Agent_<name>。
func TestInstallAgents(t *testing.T) {
	cat, err := LoadCatalog("code")
	if err != nil {
		t.Fatal(err)
	}
	catalog = cat
	app := goagent.New(goagent.WithBuiltinTools())
	if err := installAgents(app); err != nil {
		t.Fatalf("installAgents: %v", err)
	}
	if p, ok := app.ToolPermission("Agent_explore"); !ok || p != goagent.ReadOnly {
		t.Fatalf("Agent_explore 应注册为只读工具: %v %v", p, ok)
	}
}

// TestSessionModeSwitch 同一会话改绑模式后，工具 / 提示词组 / 规范上下文 /
// 技能全部随之切换（引擎每轮 run 现场解析，不重启）。
func TestSessionModeSwitch(t *testing.T) {
	cat, err := LoadCatalog("code")
	if err != nil {
		t.Fatal(err)
	}
	catalog = cat
	sessMap = &sessionMap{path: filepath.Join(t.TempDir(), "session-map.json")}
	skills.rebuild()
	dir := t.TempDir()

	type view struct {
		flutterTool, deviceTool, prompt, navSkill, deviceCtx bool
	}
	snapshot := func() view {
		v := view{
			flutterTool: sessionToolVisible("s", "flutter"),
			deviceTool:  sessionToolVisible("s", "tap"),
			prompt:      sessionPromptDir("s") != "",
		}
		if reg := skills.forSession("s"); reg != nil {
			v.navSkill = reg.Get("navigation") != nil
		}
		for _, f := range sessionContextFiles("s") {
			if f == deviceCtxPath {
				v.deviceCtx = true
			}
		}
		return v
	}

	// 未绑定 → 默认模式 code：通用 Agent，无任何 Flutter/设备能力
	if v := snapshot(); v != (view{}) {
		t.Fatalf("默认 code 模式不应带领域能力: %+v", v)
	}
	sessMap.m = map[string]sessionBinding{"s": {Dir: dir, Mode: "flutter"}}
	if v := snapshot(); v != (view{true, true, true, true, true}) {
		t.Fatalf("切到 flutter 后应具备全部领域能力: %+v", v)
	}
	sessMap.m = map[string]sessionBinding{"s": {Dir: dir, Mode: "code"}}
	if v := snapshot(); v != (view{}) {
		t.Fatalf("切回 code 后领域能力应全部撤下: %+v", v)
	}
	// 绑定了已删除的模式 → 回落默认模式
	sessMap.m = map[string]sessionBinding{"s": {Dir: dir, Mode: "gone"}}
	if sessionMode("s").ID != "code" {
		t.Fatalf("未知模式应回落默认模式，得到 %s", sessionMode("s").ID)
	}
}

// TestParseAgentDef 子代理文件的结构校验。
func TestParseAgentDef(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	ok := write("ok.md", "---\ndescription: 探索\ntools: Read, Grep\nmaxTurns: 5\n---\n系统提示\n")
	d, err := parseAgentDef(ok)
	if err != nil {
		t.Fatal(err)
	}
	if d.Name != "ok" || len(d.Tools) != 2 || d.Tools[1] != "Grep" || d.MaxTurns != 5 || d.Prompt != "系统提示" {
		t.Fatalf("解析结果不符: %+v", d)
	}
	for name, content := range map[string]string{
		"nodesc.md":  "---\ntools: Read\n---\n正文\n",
		"notools.md": "---\ndescription: x\n---\n正文\n",
		"nobody.md":  "---\ndescription: x\ntools: Read\n---\n",
		"badname.md": "---\nname: a b\ndescription: x\ntools: Read\n---\n正文\n",
		"turns.md":   "---\ndescription: x\ntools: Read\nmaxTurns: -1\n---\n正文\n",
	} {
		if _, err := parseAgentDef(write(name, content)); err == nil {
			t.Errorf("%s 应校验失败", name)
		}
	}
}

// TestExpandVars MCP 声明字段展开：${PLUGIN_DIR} 与 ${VAR}，裸 $ 不动。
func TestExpandVars(t *testing.T) {
	t.Setenv("YCODE_TEST_TOKEN", "tok")
	got := expandVars("${PLUGIN_DIR}/srv.js --t=${YCODE_TEST_TOKEN} $HOME ${YCODE_UNSET}", "/p")
	if got != "/p/srv.js --t=tok $HOME " {
		t.Fatalf("expandVars = %q", got)
	}
}

// TestValidateFields 表单字段声明的结构校验。
func TestValidateFields(t *testing.T) {
	dir := ProjectField{ID: "dir", Label: "目录", Type: "folder"}
	cases := []struct {
		name   string
		fields []ProjectField
		ok     bool
	}{
		{"仅 dir", []ProjectField{dir}, true},
		{"缺 dir", []ProjectField{{ID: "name", Label: "名称", Type: "text"}}, false},
		{"dir 非 folder", []ProjectField{{ID: "dir", Label: "目录", Type: "text"}}, false},
		{"未知类型", []ProjectField{dir, {ID: "x", Label: "X", Type: "date"}}, false},
		{"重复 id", []ProjectField{dir, dir}, false},
		{"choice 无选项", []ProjectField{dir, {ID: "k", Label: "K", Type: "choice"}}, false},
		{"默认值越界", []ProjectField{dir, {ID: "k", Label: "K", Type: "choice", Default: "z",
			Options: []FieldOption{{Value: "a", Label: "A"}}}}, false},
		{"choice 合法", []ProjectField{dir, {ID: "k", Label: "K", Type: "choice", Default: "a",
			Options: []FieldOption{{Value: "a", Label: "A"}}}}, true},
	}
	for _, c := range cases {
		if err := validateFields("m", c.fields); (err == nil) != c.ok {
			t.Errorf("%s: ok=%v err=%v", c.name, c.ok, err)
		}
	}
}
