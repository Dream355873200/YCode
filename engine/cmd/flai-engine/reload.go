// reload.go 能力目录热重载：设置页写完清单后 POST /reload，引擎重建目录并
// 原子替换，不重启进程、不打断在跑的会话。
//
// 替换顺序保证会话任一时刻看到的都是自洽的一版：
//  1. 重建目录（逐项容错；没有可用模式时保留旧版并报错）
//  2. 子代理对账（新增/变更 ReplaceTool，移除的下线隐藏）——新目录生效前
//     归属已登记，旧目录的模式不引用新插件，不会提前看见
//  3. 原子替换目录 → 技能注册表重建 → MCP 服务器对账（后台连接）
//
// 工具集在启动时全部装好（可见性由会话工具过滤器按模式裁剪），新模式
// 引用任意工具集即生效；在跑的 run 用的是本轮开始时解析的工具与提示词，
// 下一轮起用新版。
package main

import (
	"encoding/json"
	"net/http"
	"sync"

	goagent "github.com/Dream355873200/GoAgent"
)

// configuredDefaultMode 启动参数指定的默认模式（每次重建都按它解析，
// 不可用时回退首个可用模式）。
var configuredDefaultMode string

var reloadMu sync.Mutex

// reloadCatalog 重建并替换能力目录（串行）。
func reloadCatalog(app *goagent.App) (*Catalog, error) {
	reloadMu.Lock()
	defer reloadMu.Unlock()
	next, err := LoadCatalog(configuredDefaultMode)
	if err != nil {
		return nil, err
	}
	next.Errors = append(next.Errors, syncAgents(app, next)...)
	setCatalog(next)
	skills.rebuild()
	syncPluginMCP(app, next)
	return next, nil
}

// reloadRoutes 热重载与目录错误端点。
func reloadRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"POST /reload": func(w http.ResponseWriter, r *http.Request) {
			if engineApp == nil {
				http.Error(w, "引擎未就绪", http.StatusServiceUnavailable)
				return
			}
			c, err := reloadCatalog(engineApp)
			w.Header().Set("Content-Type", "application/json")
			if err != nil {
				w.WriteHeader(http.StatusUnprocessableEntity)
				_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
				return
			}
			modes := make([]string, 0, len(c.Modes))
			for _, m := range c.Modes {
				modes = append(modes, m.ID)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true, "modes": modes, "defaultMode": c.DefaultMode, "errors": c.Errors,
			})
		},
		"GET /catalog/errors": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"errors": catalog().Errors})
		},
	}
}
