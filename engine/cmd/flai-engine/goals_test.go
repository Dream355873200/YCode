package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestParseVerdict(t *testing.T) {
	v := parseVerdict("<think>看看证据</think>\n```json\n{\"passed\": false, \"reason\": \"测试还没跑\", \"next_action\": \"运行测试并修复失败用例\"}\n```")
	if v.Passed || v.Reason != "测试还没跑" || v.NextAction != "运行测试并修复失败用例" {
		t.Fatalf("解析错误: %+v", v)
	}
	if v := parseVerdict("我觉得差不多了"); !v.Passed {
		t.Fatal("无法解析时应按达成处理（fail open，防止无限续跑）")
	}
}

// TestGoalStateMachine 未达成续跑 → 到上限暂停 → 继续开新一轮 → 达成冻结计时。
func TestGoalStateMachine(t *testing.T) {
	g := newGoal("让测试全绿", 2, 1000)
	if g.Status != goalActive || g.Iteration != 1 || g.ActiveSince != 1000 {
		t.Fatalf("初始状态错误: %+v", g)
	}
	if !applyVerdict(g, goalVerdict{Reason: "还有失败", NextAction: "修复"}, 2000) || g.Iteration != 2 {
		t.Fatalf("未达成应续跑并进入第 2 轮: %+v", g)
	}
	if !strings.Contains(continuationPrompt(g, goalVerdict{Reason: "还有失败", NextAction: "修复"}), "第 2 轮") {
		t.Fatal("续跑提示应带轮次")
	}
	if applyVerdict(g, goalVerdict{Reason: "仍失败"}, 3000) || g.Status != goalPaused || g.PausedReason == "" {
		t.Fatalf("到达上限应自动暂停: %+v", g)
	}
	if g.ElapsedMs != 2000 || g.ActiveSince != 0 {
		t.Fatalf("暂停应冻结计时: %+v", g)
	}
	if len(g.Checks) != 2 || g.Checks[1].Iteration != 2 {
		t.Fatalf("每轮都应留验收记录: %+v", g.Checks)
	}
	c := g.clone()
	c.Checks[0].Reason = "改了"
	if g.Checks[0].Reason == "改了" {
		t.Fatal("clone 必须深拷贝验收记录")
	}
}

// TestGoalEndpoints 设定 → 暂停 → 继续（已验收的轮次进入下一轮）→ 清除。
func TestGoalEndpoints(t *testing.T) {
	cat, err := LoadCatalog("code")
	if err != nil {
		t.Fatal(err)
	}
	setCatalog(cat)
	sessMap = &sessionMap{path: filepath.Join(t.TempDir(), "session-map.json")}
	mux := threadsMux()
	for p, h := range goalRoutes() {
		mux.HandleFunc(p, h)
	}
	_, created := doJSON(t, mux, "POST", "/threads", map[string]any{"dir": t.TempDir(), "message": "做个功能"})
	id, _ := created["id"].(string)

	if code, _ := doJSON(t, mux, "POST", "/threads/"+id+"/goal", map[string]any{"objective": " "}); code != 400 {
		t.Fatalf("空目标应 400，得到 %d", code)
	}
	if code, body := doJSON(t, mux, "POST", "/threads/"+id+"/goal", map[string]any{"objective": "让测试全绿", "maxIterations": 1}); code != 200 ||
		body["goal"].(map[string]any)["status"] != goalActive {
		t.Fatalf("设定目标失败: %d %v", code, body)
	}
	// 模拟一轮验收未通过并到达上限
	if _, _, err := mutateGoal(id, func(g *threadGoal) (*threadGoal, error) {
		applyVerdict(g, goalVerdict{Reason: "还没跑", NextAction: "运行测试"}, 5000)
		return g, nil
	}); err != nil {
		t.Fatal(err)
	}
	if b, _ := sessMap.lookup(id); b.Goal.Status != goalPaused {
		t.Fatalf("到达上限应暂停: %+v", b.Goal)
	}
	code, body := doJSON(t, mux, "POST", "/threads/"+id+"/goal/resume", nil)
	g, _ := body["goal"].(map[string]any)
	if code != 200 || g["status"] != goalActive || g["iteration"].(float64) != 2 || g["maxIterations"].(float64) < 2 {
		t.Fatalf("继续应进入第 2 轮并放宽上限: %d %v", code, body)
	}
	if p, _ := body["prompt"].(string); !strings.Contains(p, "运行测试") {
		t.Fatalf("继续应返回带下一步的续跑提示: %q", p)
	}
	if code, _ := doJSON(t, mux, "POST", "/threads/"+id+"/goal/pause", map[string]any{"reason": "运行被中断"}); code != 200 {
		t.Fatalf("暂停失败: %d", code)
	}
	if b, _ := sessMap.lookup(id); b.Goal.PausedReason != "运行被中断" {
		t.Fatalf("暂停原因应记录: %+v", b.Goal)
	}
	if code, _ := doJSON(t, mux, "POST", "/threads/"+id+"/goal/pause", nil); code != 409 {
		t.Fatalf("重复暂停应 409，得到 %d", code)
	}
	if code, _ := doJSON(t, mux, "DELETE", "/threads/"+id+"/goal", nil); code != 200 {
		t.Fatalf("清除失败: %d", code)
	}
	if b, _ := sessMap.lookup(id); b.Goal != nil {
		t.Fatal("清除后不应再有目标")
	}

	// 引擎重启：进行中的目标转为暂停
	_, _ = doJSON(t, mux, "POST", "/threads/"+id+"/goal", map[string]any{"objective": "再来"})
	pauseActiveGoals()
	if b, _ := sessMap.lookup(id); b.Goal.Status != goalPaused || b.Goal.PausedReason == "" {
		t.Fatalf("启动时应暂停进行中的目标: %+v", b.Goal)
	}
}
