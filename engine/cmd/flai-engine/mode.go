// mode.go 产品模式（mode）装配：引擎能力按模式包数据驱动。
//
// 模式 = modes/<id>/ 目录：
//
//	mode.json        模式清单（id/名称/工具集/领域规范/技能目录/项目表单字段）
//	domain-rules.md  领域规范（WithProjectContext 注入，等同 CLAUDE.md 地位）
//	skills/          该模式的技能目录
//
// 引擎进程以 --mode 选择装配哪个模式（缺省 flutter 保持既有行为）。
// base 工具集（文件/Bash/任务/计划/后台任务/提问审批/插话）是通用能力恒定
// 注册；flutter/device/test-report/vision 等领域工具集由模式清单声明增补。
// 模式根目录定位：FLAI_MODES_DIR > 源码树上溯（仓库根/modes）> cwd/modes。
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
)

// modeEngine mode.json 的 engine 装配段（引擎消费；其余字段给桌面壳）。
type modeEngine struct {
	DomainRules string   `json:"domainRules"` // 领域规范文件（相对模式目录；空 = 不注入）
	SkillsDir   string   `json:"skillsDir"`   // 技能目录（相对模式目录；空 = 无技能）
	Toolsets    []string `json:"toolsets"`    // base 之外的领域工具集
}

// Mode 一个模式包的运行时视图（清单 + 解析后的目录）。
type Mode struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	Description   string           `json:"description,omitempty"`
	Engine        modeEngine       `json:"engine"`
	ProjectFields []map[string]any `json:"projectFields,omitempty"` // 新建项目表单字段（桌面壳消费）

	dir string // 模式包目录（相对路径的解析基准）
}

// HasToolset 领域工具集是否启用。
func (m *Mode) HasToolset(name string) bool {
	for _, t := range m.Engine.Toolsets {
		if t == name {
			return true
		}
	}
	return false
}

// DomainRulesPath 领域规范文件绝对路径（空 = 本模式不注入）。
func (m *Mode) DomainRulesPath() string { return m.resolve(m.Engine.DomainRules) }

// SkillsPath 技能目录绝对路径（空 = 本模式无技能）。
func (m *Mode) SkillsPath() string { return m.resolve(m.Engine.SkillsDir) }

// resolve 相对模式目录解析路径（空入参返回空串）。
func (m *Mode) resolve(rel string) string {
	if rel == "" {
		return ""
	}
	return filepath.Join(m.dir, filepath.FromSlash(rel))
}

// modesDir 模式包根目录定位：FLAI_MODES_DIR > 源码树仓库根/modes > cwd/modes。
func modesDir() string {
	if v := os.Getenv("FLAI_MODES_DIR"); v != "" {
		return v
	}
	// mode.go 所在目录 = cmd/flai-engine/；文件名一层 + 上溯三级 = 仓库根
	//（cmd/flai-engine/ → engine/ → 仓库根）。模式包与 knowledge/ 同级，
	// 都放在产品仓库根（engine/ 是 go 模块，产品资产不入模块根）。
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(file)))), "modes")
	if st, err := os.Stat(root); err == nil && st.IsDir() {
		return root
	}
	return filepath.Join(wdOrEmpty(), "modes")
}

// LoadModes 扫描模式根目录下全部模式包（按 id 排序；清单损坏的跳过）。
func LoadModes() ([]*Mode, error) {
	root := modesDir()
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("模式目录不可读 %s: %w", root, err)
	}
	var modes []*Mode
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		listPath := filepath.Join(root, e.Name(), "mode.json")
		b, err := os.ReadFile(listPath)
		if err != nil {
			continue // 无清单的目录不是模式包
		}
		var m Mode
		if err := json.Unmarshal(b, &m); err != nil {
			return nil, fmt.Errorf("模式 %s 清单损坏: %w", e.Name(), err)
		}
		m.dir = filepath.Join(root, e.Name())
		if m.ID == "" {
			m.ID = e.Name()
		}
		modes = append(modes, &m)
	}
	sort.Slice(modes, func(i, j int) bool { return modes[i].ID < modes[j].ID })
	return modes, nil
}

// LoadMode 按 id 加载单个模式包。
func LoadMode(id string) (*Mode, error) {
	modes, err := LoadModes()
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, m := range modes {
		if m.ID == id {
			return m, nil
		}
		ids = append(ids, m.ID)
	}
	return nil, fmt.Errorf("模式 %q 不存在（可用: %v）", id, ids)
}

// modesRoutes 模式发现端点（桌面壳据此渲染模式选择/新建项目表单）。
func modesRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /modes": func(w http.ResponseWriter, r *http.Request) {
			modes, err := LoadModes()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if modes == nil {
				modes = []*Mode{}
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"modes": modes})
		},
	}
}
