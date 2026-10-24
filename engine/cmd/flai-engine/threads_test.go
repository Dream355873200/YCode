package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	goagent "github.com/Dream355873200/GoAgent"
)

// TestDirHashMatchesShell 目录哈希与旧版桌面壳算出的 ID 逐位一致
// （向量取自真实 session-map：amc-<目录名>-<哈希>）。
func TestDirHashMatchesShell(t *testing.T) {
	for dir, want := range map[string]string{
		`E:\aaaa\test2`:   "502239ea",
		`E:\aaaa\flutter`: "189a5a56",
		`E:\aaaa\test\aa`: "52a6685b",
		`E:\aaaa\t1`:      "f93ab6af",
		`E:\aaaa\test`:    "58b3389c",
		`e:/aaaa/test2/`:  "502239ea", // 盘符大小写 / 分隔符 / 尾斜杠归一
	} {
		if got := dirHash(dir); got != want {
			t.Errorf("dirHash(%q) = %s，want %s", dir, got, want)
		}
	}
}

// TestNewThreadID 新对话 ID 与项目首段对话同族，且是轨迹端点接受的 ASCII。
func TestNewThreadID(t *testing.T) {
	id := newThreadID(`E:\aaaa\test2`)
	if !strings.HasPrefix(id, "amc-test2-502239ea-") {
		t.Fatalf("前缀不对: %s", id)
	}
	if id2 := newThreadID(`E:\aaaa\test2`); id2 == id {
		t.Fatal("两次生成的 ID 不应相同")
	}
	cn := newThreadID(`E:\工作\报告`)
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`).MatchString(cn) || !strings.HasPrefix(cn, "amc-p-") {
		t.Fatalf("非 ASCII 目录名应退化为 p 片段: %s", cn)
	}
	if !isThreadID(id) || isThreadID("team-ab12-qa-leader") || isThreadID("amc-x-12345678-git") || isThreadID("") {
		t.Fatal("isThreadID 判定错误")
	}
}

func TestTitles(t *testing.T) {
	if got := provisionalTitle("\n\n  帮我   修复登录页\n第二行"); got != "帮我 修复登录页" {
		t.Errorf("provisionalTitle = %q", got)
	}
	long := strings.Repeat("长", 40)
	if got := provisionalTitle(long); len([]rune(got)) != 31 || !strings.HasSuffix(got, "…") {
		t.Errorf("超长标题应截断加省略号: %q", got)
	}
	for in, want := range map[string]string{
		"<think>想一想</think>\n「重构数据层」。": "重构数据层",
		"标题：修复登录崩溃":                    "修复登录崩溃",
		"\"Add login page\"\n解释":       "Add login page",
		"<thinking>未闭合的思考":             "",
		"**补充单元测试**":                   "补充单元测试",
	} {
		if got := cleanTitle(in); got != want {
			t.Errorf("cleanTitle(%q) = %q，want %q", in, got, want)
		}
	}
	if got := stripFence("```text\nfeat: 加登录\n\n- 要点\n```"); got != "feat: 加登录\n\n- 要点" {
		t.Errorf("stripFence = %q", got)
	}
}

// TestSessionMapWriter 读-改-写保留旧格式条目与未知字段之外的全部绑定，新实例可读回。
func TestSessionMapWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "session-map.json")
	if err := os.WriteFile(path, []byte(`{"old":"E:\\p","new":{"dir":"E:\\q","mode":"flutter"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	sm := &sessionMap{path: path}
	if b := sm.binding("old"); b.Dir != `E:\p` || b.Mode != "" {
		t.Fatalf("旧格式条目解析错误: %+v", b)
	}
	if _, err := sm.update("new", func(b *sessionBinding, exists bool) bool {
		if !exists {
			t.Fatal("new 应存在")
		}
		b.Title, b.TitleSource, b.Permission = "标题", "user", "plan"
		return true
	}); err != nil {
		t.Fatal(err)
	}
	re := &sessionMap{path: path}
	if b := re.binding("new"); b.Mode != "flutter" || b.Title != "标题" || b.Permission != "plan" {
		t.Fatalf("写回后读不回: %+v", b)
	}
	if b := re.binding("old"); b.Dir != `E:\p` {
		t.Fatalf("其他条目被破坏: %+v", b)
	}
	if err := re.remove("old", "missing"); err != nil {
		t.Fatal(err)
	}
	if _, ok := (&sessionMap{path: path}).lookup("old"); ok {
		t.Fatal("remove 后不应存在")
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("临时文件应已改名")
	}
}

func threadsMux() *http.ServeMux {
	mux := http.NewServeMux()
	for p, h := range threadsRoutes() {
		mux.HandleFunc(p, h)
	}
	return mux
}

func doJSON(t *testing.T, mux *http.ServeMux, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(method, path, rd))
	out := map[string]any{}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

// TestThreadEndpoints 创建 → 列表 → 改名/改权限 → 权限钩子生效 → 删除。
func TestThreadEndpoints(t *testing.T) {
	cat, err := LoadCatalog("code")
	if err != nil {
		t.Fatal(err)
	}
	setCatalog(cat)
	sessMap = &sessionMap{path: filepath.Join(t.TempDir(), "session-map.json")}
	dir := t.TempDir()
	mux := threadsMux()

	code, created := doJSON(t, mux, "POST", "/threads", map[string]any{
		"dir": dir, "mode": "flutter", "permission": "accept_edits", "message": "做一个记账 App\n细节稍后",
	})
	if code != 200 || created["title"] != "做一个记账 App" || created["titleSource"] != "auto" || created["mode"] != "flutter" {
		t.Fatalf("创建失败: %d %v", code, created)
	}
	id, _ := created["id"].(string)
	if code, _ := doJSON(t, mux, "POST", "/threads", map[string]any{"dir": dir, "mode": "gone"}); code != 400 {
		t.Fatalf("未知智能体应 400，得到 %d", code)
	}
	if code, _ := doJSON(t, mux, "POST", "/threads", map[string]any{"dir": filepath.Join(dir, "missing")}); code != 400 {
		t.Fatalf("目录不存在应 400，得到 %d", code)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/threads?dir="+strings.ReplaceAll(dir, `\`, "/"), nil))
	var list struct{ Threads []threadView }
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Threads) != 1 || list.Threads[0].ID != id {
		t.Fatalf("列表应按归一路径匹配到该对话: %+v", list.Threads)
	}

	if code, upd := doJSON(t, mux, "POST", "/threads/"+id, map[string]any{"title": "  记账 App  ", "permission": "plan"}); code != 200 ||
		upd["title"] != "记账 App" || upd["titleSource"] != "user" || upd["permission"] != "plan" {
		t.Fatalf("更新失败: %d %v", code, upd)
	}
	if m, ok := sessionPermMode(id); !ok || m != goagent.PermissionPlanOnly {
		t.Fatalf("对话权限钩子应解析为 plan，得到 %v %v", m, ok)
	}
	if code, _ := doJSON(t, mux, "POST", "/threads/"+id, map[string]any{"permission": "root"}); code != 400 {
		t.Fatalf("非法权限应 400，得到 %d", code)
	}
	if code, _ := doJSON(t, mux, "POST", "/threads/nope", map[string]any{"archived": true}); code != 404 {
		t.Fatalf("不存在的对话应 404，得到 %d", code)
	}

	// 登记已有会话（项目首段对话）：只补齐缺失字段
	legacy := "amc-legacy-0000abcd"
	if code, v := doJSON(t, mux, "POST", "/threads", map[string]any{"id": legacy, "dir": dir}); code != 200 || v["mode"] != "code" {
		t.Fatalf("登记已有会话失败: %d %v", code, v)
	}
	if code, _ := doJSON(t, mux, "POST", "/threads", map[string]any{"id": legacy, "dir": t.TempDir()}); code != 409 {
		t.Fatalf("同一 ID 换项目应 409，得到 %d", code)
	}

	if code, _ := doJSON(t, mux, "DELETE", "/threads/"+id, nil); code != 200 {
		t.Fatalf("删除失败: %d", code)
	}
	if _, ok := sessMap.lookup(id); ok {
		t.Fatal("删除后绑定应移除")
	}
	if code, _ := doJSON(t, mux, "DELETE", "/threads/team-x-leader", nil); code != 400 {
		t.Fatalf("团队会话不是对话，应 400，得到 %d", code)
	}
}

// TestTeamSessionPrefix 新团队的会话按项目隔离；早期团队沿用旧 ID（历史不丢）。
func TestTeamSessionPrefix(t *testing.T) {
	legacy := &Team{Name: "qa"}
	if got := legacy.sessionID("leader"); got != "team-qa-leader" {
		t.Fatalf("早期团队 = %s", got)
	}
	a := &Team{Name: "qa", SessionPrefix: "team-" + dirHash(`E:\a`) + "-qa"}
	b := &Team{Name: "qa", SessionPrefix: "team-" + dirHash(`E:\b`) + "-qa"}
	if a.sessionID("tester") == b.sessionID("tester") {
		t.Fatal("不同项目的同名团队会话不应相同")
	}
	if isThreadID(a.sessionID("tester")) {
		t.Fatal("团队会话不应出现在对话列表")
	}
}

func TestValidateLook(t *testing.T) {
	ok := []Starter{{Label: "解读项目", Prompt: "通读"}}
	if err := validateLook("m", "file-text", ok); err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]struct {
		icon     string
		starters []Starter
	}{
		"图标键非法":    {"Code!", nil},
		"建议过多":     {"", make([]Starter, maxStarters+1)},
		"缺 prompt": {"", []Starter{{Label: "x"}}},
		"label 过长": {"", []Starter{{Label: strings.Repeat("长", 17), Prompt: "p"}}},
	} {
		if err := validateLook("m", c.icon, c.starters); err == nil {
			t.Errorf("%s 应报错", name)
		}
	}
}
