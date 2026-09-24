package main

import (
	"path/filepath"
	"testing"
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
