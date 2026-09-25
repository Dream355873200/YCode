// pipelinehistory.go — pipeline 运行历史端点。
//
// GoAgent 的 create_pipeline 每次运行落盘到项目 .yume/pipelines/<runID>/：
// run.json（快照：节点状态/产出，随事件增量重写）+ <node>.jsonl（节点运行
// 轨迹：思考/工具/文本，对齐主 agent 时间线）。本端点列表 + 详情 + 轨迹，
// 右栏 Pipeline 面板据此回看历史运行与节点的完整工作过程。
package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// pipelineRunSummary 列表项（详情裁剪：不含 instruction/outputs 正文）。
type pipelineRunSummary struct {
	ID         string   `json:"id"`
	StartedAt  int64    `json:"started_at"`
	FinishedAt int64    `json:"finished_at,omitempty"`
	Nodes      []string `json:"nodes"`
	Statuses   []string `json:"statuses"`
}

func pipelinesRoot(dir string) string { return filepath.Join(dir, ".yume", "pipelines") }

// pipelineIDRe 运行目录名（时间戳数字）——防路径穿越。
var pipelineIDRe = regexp.MustCompile(`^\d{13,16}$`)

// pipelineNodeRe 节点名（轨迹文件名）——防路径穿越。
var pipelineNodeRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// readRunJSON 读单个运行的 run.json（不存在返回 nil）。
func readRunJSON(dir, id string) map[string]any {
	b, err := os.ReadFile(filepath.Join(pipelinesRoot(dir), id, "run.json"))
	if err != nil {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(b, &m) != nil {
		return nil
	}
	return m
}

// resolveRunID 解析运行 id：'live' = 最新一次运行（实时运行中前端不知道
// runID，节点点击经此别名直达轨迹）。返回实际 id；无运行返回空串。
func resolveRunID(dir, id string) string {
	if id != "live" {
		return id
	}
	entries, err := os.ReadDir(pipelinesRoot(dir))
	if err != nil {
		return ""
	}
	type run struct {
		name      string
		startedAt int64
	}
	var runs []run
	for _, e := range entries {
		if !e.IsDir() || !pipelineIDRe.MatchString(e.Name()) {
			continue
		}
		m := readRunJSON(dir, e.Name())
		if m == nil {
			continue
		}
		started, _ := m["started_at"].(float64)
		runs = append(runs, run{name: e.Name(), startedAt: int64(started)})
	}
	if len(runs) == 0 {
		return ""
	}
	sort.Slice(runs, func(i, j int) bool { return runs[i].startedAt > runs[j].startedAt })
	return runs[0].name
}

// pipelineRoutes 历史运行端点（列表 / 详情 / 节点轨迹）。
func pipelineRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /pipelines": func(w http.ResponseWriter, r *http.Request) {
			dir := r.URL.Query().Get("dir")
			if dir == "" {
				http.Error(w, "缺少 dir 参数", http.StatusBadRequest)
				return
			}
			entries, err := os.ReadDir(pipelinesRoot(dir))
			if err != nil {
				writeJSON(w, map[string]any{"runs": []pipelineRunSummary{}})
				return
			}
			runs := []pipelineRunSummary{}
			for _, e := range entries {
				if !e.IsDir() || !pipelineIDRe.MatchString(e.Name()) {
					continue
				}
				m := readRunJSON(dir, e.Name())
				if m == nil {
					continue
				}
				ns, _ := m["nodes"].([]any)
				if len(ns) == 0 {
					continue
				}
				s := pipelineRunSummary{ID: e.Name()}
				if v, ok := m["started_at"].(float64); ok {
					s.StartedAt = int64(v)
				}
				if v, ok := m["finished_at"].(float64); ok {
					s.FinishedAt = int64(v)
				}
				for _, n := range ns {
					nm, _ := n.(map[string]any)
					name, _ := nm["name"].(string)
					status, _ := nm["status"].(string)
					s.Nodes = append(s.Nodes, name)
					s.Statuses = append(s.Statuses, status)
				}
				runs = append(runs, s)
			}
			sort.Slice(runs, func(i, j int) bool { return runs[i].StartedAt > runs[j].StartedAt })
			writeJSON(w, map[string]any{"runs": runs})
		},
		"GET /pipelines/{id}": func(w http.ResponseWriter, r *http.Request) {
			dir, id := r.URL.Query().Get("dir"), r.PathValue("id")
			if dir == "" || (id != "live" && !pipelineIDRe.MatchString(id)) {
				http.Error(w, "参数不合法", http.StatusBadRequest)
				return
			}
			if id == "live" {
				id = resolveRunID(dir, id)
			}
			if id == "" {
				http.Error(w, "还没有运行记录", http.StatusNotFound)
				return
			}
			if m := readRunJSON(dir, id); m != nil {
				writeJSON(w, m)
				return
			}
			http.Error(w, "运行快照不存在", http.StatusNotFound)
		},
		// GET /pipelines/{id}/nodes/{node}/trace 节点运行轨迹（JSONL → 数组）。
		// 前端渲染为只读对话时间线（思考/工具调用/文本产出）。id=live 解析
		// 为最新运行。
		"GET /pipelines/{id}/nodes/{node}/trace": func(w http.ResponseWriter, r *http.Request) {
			dir, id, node := r.URL.Query().Get("dir"), r.PathValue("id"), r.PathValue("node")
			if dir == "" || (id != "live" && !pipelineIDRe.MatchString(id)) || !pipelineNodeRe.MatchString(node) {
				http.Error(w, "参数不合法", http.StatusBadRequest)
				return
			}
			if id == "live" {
				id = resolveRunID(dir, id)
			}
			if id == "" {
				writeJSON(w, map[string]any{"trace": []any{}})
				return
			}
			b, err := os.ReadFile(filepath.Join(pipelinesRoot(dir), id, node+".jsonl"))
			if err != nil {
				writeJSON(w, map[string]any{"trace": []any{}})
				return
			}
			lines := []any{}
			for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
				if line == "" {
					continue
				}
				var m any
				if json.Unmarshal([]byte(line), &m) == nil {
					lines = append(lines, m)
				}
			}
			writeJSON(w, map[string]any{"trace": lines})
		},
	}
}
