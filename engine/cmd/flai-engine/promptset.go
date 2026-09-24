// promptset.go 提示词组（prompt 组）：引擎系统提示词由分段文件组合而成
//（identity / doing-tasks / tone-style / using-tools …，缺段时 goagent
// 回退嵌入默认值，跟随库升级不复制维护）。一组 = prompts/<name>/ 目录。
//
// 作为独立元组件：模式经 mode.json 的 prompts 按名引用组（省略 = 不覆盖，
// 全部段落用 goagent 内置的通用 Agent 提示词），设置页有专属 tab 管理清单。
// 组内只放需要偏移的段落文件，其余段落自动回退内置默认值。
// 与应用其他资产一样放在应用根，不进用户目录。
package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// promptsRoot 提示词组根目录：FLAI_PROMPTS_DIR > 应用根/prompts。
func promptsRoot() string {
	if v := os.Getenv("FLAI_PROMPTS_DIR"); v != "" {
		return v
	}
	return filepath.Join(appRoot(), "prompts")
}

// PromptGroupDir 提示词组目录绝对路径（空名或组不存在时返回空串）。
func PromptGroupDir(name string) string {
	if name == "" {
		return ""
	}
	dir := filepath.Join(promptsRoot(), name)
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return ""
	}
	return dir
}

// PromptGroup 一个提示词组的运行时视图。
type PromptGroup struct {
	Name  string   `json:"name"`
	Files []string `json:"files,omitempty"`
}

// LoadPromptGroups 扫描组根目录下全部提示词组（按名排序；文件名即段名）。
func LoadPromptGroups() []PromptGroup {
	root := promptsRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var groups []PromptGroup
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		g := PromptGroup{Name: e.Name()}
		files, err := os.ReadDir(filepath.Join(root, e.Name()))
		if err == nil {
			for _, f := range files {
				if !f.IsDir() && strings.HasSuffix(f.Name(), ".md") {
					g.Files = append(g.Files, f.Name())
				}
			}
			sort.Strings(g.Files)
		}
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
			items := []groupView{}
			for _, g := range LoadPromptGroups() {
				v := groupView{PromptGroup: g, UsedBy: []string{}}
				for _, m := range catalog.Modes {
					if m.Prompts == g.Name {
						v.UsedBy = append(v.UsedBy, m.ID)
					}
				}
				items = append(items, v)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"prompts": items})
		},
	}
}
