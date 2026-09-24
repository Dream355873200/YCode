// promptset.go 提示词组（prompt 组）：引擎系统提示词由分段文件组合而成
// （identity / doing-tasks / tone-style / using-tools …，缺段时 goagent
// 回退嵌入默认值，跟随库升级不复制维护）。一组 = prompts/<name>/ 目录。
//
// 作为独立元组件：模式经 mode.json 的 prompts 按名引用组（省略 = 不覆盖，
// 全部段落用 goagent 内置的通用 Agent 提示词），设置页有专属 tab 管理清单。
// 组内只放需要偏移的段落文件，其余段落自动回退内置默认值。
// 组根：内置 appRoot/prompts（FLAI_PROMPTS_DIR 可替代）+ 用户 userRoot/prompts。
package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Dream355873200/GoAgent/prompts"
)

// PromptGroupDir 提示词组目录绝对路径（用户组覆盖同名内置组；空名或
// 组不存在时返回空串）。
func PromptGroupDir(name string) string {
	if name == "" {
		return ""
	}
	for _, g := range LoadPromptGroups() {
		if g.Name == name {
			return g.Dir
		}
	}
	return ""
}

// PromptGroup 一个提示词组的运行时视图。
type PromptGroup struct {
	Name   string   `json:"name"`
	Dir    string   `json:"dir"`    // 组目录绝对路径（设置页预览分段内容）
	Origin string   `json:"origin"` // bundled | user
	Files  []string `json:"files,omitempty"`
}

// LoadPromptGroups 扫描全部提示词组根（内置 → 用户，同名用户覆盖内置；
// 按名排序；文件名即段名）。
func LoadPromptGroups() []PromptGroup {
	byName := map[string]PromptGroup{}
	for _, root := range assetRoots("prompts", "FLAI_PROMPTS_DIR") {
		entries, err := os.ReadDir(root.Dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			g := PromptGroup{Name: e.Name(), Dir: filepath.Join(root.Dir, e.Name()), Origin: root.Origin}
			if files, err := os.ReadDir(g.Dir); err == nil {
				for _, f := range files {
					if !f.IsDir() && strings.HasSuffix(f.Name(), ".md") {
						g.Files = append(g.Files, f.Name())
					}
				}
				sort.Strings(g.Files)
			}
			byName[g.Name] = g
		}
	}
	groups := make([]PromptGroup, 0, len(byName))
	for _, g := range byName {
		groups = append(groups, g)
	}
	sort.Slice(groups, func(i, j int) bool { return groups[i].Name < groups[j].Name })
	return groups
}

// promptGroupNames 全部提示词组名（报错提示用）。
func promptGroupNames() []string {
	var names []string
	for _, g := range LoadPromptGroups() {
		names = append(names, g.Name)
	}
	return names
}

// promptsRoutes 提示词组发现端点（设置页提示词组 tab 数据源）：
// 每组附带引用它的模式（usedBy）。
func promptsRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /prompts": func(w http.ResponseWriter, r *http.Request) {
			type groupView struct {
				PromptGroup
				UsedBy []string `json:"usedBy"`
			}
			c := catalog()
			items := []groupView{}
			for _, g := range LoadPromptGroups() {
				v := groupView{PromptGroup: g, UsedBy: []string{}}
				for _, m := range c.Modes {
					if m.Prompts == g.Name {
						v.UsedBy = append(v.UsedBy, m.ID)
					}
				}
				items = append(items, v)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"prompts": items})
		},
		// 内置段落全文（设置页编辑提示词组时预填；组内缺的段即用这些）。
		"GET /prompts/defaults": func(w http.ResponseWriter, r *http.Request) {
			type section struct {
				Name    string `json:"name"`
				Content string `json:"content"`
			}
			items := []section{}
			for _, name := range prompts.DefaultFiles() {
				content, _ := prompts.Load(name)
				items = append(items, section{Name: name, Content: content})
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"sections": items})
		},
		// 会话生效的系统提示词（按会话模式的提示词组 + 工作目录组装）。
		"GET /sessions/{id}/system-prompt": func(w http.ResponseWriter, r *http.Request) {
			if engineApp == nil {
				http.Error(w, "引擎未就绪", http.StatusServiceUnavailable)
				return
			}
			sid := r.PathValue("id")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"mode":      sessionMode(sid).ID,
				"promptDir": sessionPromptDir(sid),
				"prompt":    engineApp.SessionSystemPrompt(sid),
			})
		},
	}
}
