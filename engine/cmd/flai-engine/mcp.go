// mcp.go 插件 MCP 服务器：引擎启动后后台连接，工具归属声明它的插件。
//
// 被任一模式引用的插件，其 mcpServers 在 HTTP 服务起来后并行连接（单个
// 超时 30s，不阻塞启动）；发现的工具以 mcp__<server>__<tool> 注册进进程级
// 工具注册表，先登记归属插件再注册——会话工具过滤器据此只对引用该插件的
// 模式可见。连接失败只影响该服务器，状态经 GET /mcp 与 /plugins 暴露给设置页。
//
// 字段展开：command/args/env/url/headers 中的 ${PLUGIN_DIR} = 插件目录，
// 其余 ${VAR} = 引擎进程环境变量（仅 ${...} 形式，裸 $ 原样保留）。
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"regexp"
	"sync"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
	"github.com/Dream355873200/GoAgent/mcp"
)

const pluginMCPTimeout = 30 * time.Second

// mcpServerStatus 一个 MCP 服务器的运行状态（设置页展示）。
type mcpServerStatus struct {
	Plugin    string   `json:"plugin"`
	Name      string   `json:"name"`
	Transport string   `json:"transport"` // stdio | http
	Status    string   `json:"status"`    // connecting | connected | error
	Error     string   `json:"error,omitempty"`
	Server    string   `json:"server,omitempty"` // 服务端自报名/版本
	Tools     []string `json:"tools"`
}

// mcpHub 进程级 MCP 连接表。
type mcpHubT struct {
	mu      sync.RWMutex
	servers []*mcpServerStatus
	clients []*mcp.Client
}

var mcpHub = &mcpHubT{}

// snapshot 状态快照（按插件、服务器声明顺序）。
func (h *mcpHubT) snapshot() []mcpServerStatus {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]mcpServerStatus, 0, len(h.servers))
	for _, s := range h.servers {
		c := *s
		c.Tools = append([]string{}, s.Tools...)
		out = append(out, c)
	}
	return out
}

// forPlugin 某插件的服务器状态。
func (h *mcpHubT) forPlugin(pluginID string) []mcpServerStatus {
	out := []mcpServerStatus{}
	for _, s := range h.snapshot() {
		if s.Plugin == pluginID {
			out = append(out, s)
		}
	}
	return out
}

func (h *mcpHubT) update(s *mcpServerStatus, fn func(*mcpServerStatus)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	fn(s)
}

// startPluginMCP 后台并行连接被模式引用的插件的全部 MCP 服务器。
// 立即返回；状态表同步建好（初始 connecting）。
func startPluginMCP(app *goagent.App) {
	type job struct {
		plugin *Plugin
		srv    MCPServer
		status *mcpServerStatus
	}
	var jobs []job
	mcpHub.mu.Lock()
	for _, p := range catalog.UsedPlugins() {
		for _, srv := range p.MCPServers {
			transport := "stdio"
			if srv.URL != "" {
				transport = "http"
			}
			st := &mcpServerStatus{Plugin: p.ID, Name: srv.Name, Transport: transport, Status: "connecting", Tools: []string{}}
			mcpHub.servers = append(mcpHub.servers, st)
			jobs = append(jobs, job{p, srv, st})
		}
	}
	mcpHub.mu.Unlock()

	for _, j := range jobs {
		go func(j job) {
			ctx, cancel := context.WithTimeout(context.Background(), pluginMCPTimeout)
			defer cancel()
			client, tools, err := mcp.Connect(ctx, mcpConfig(j.plugin, j.srv))
			if err != nil {
				log.Printf("[mcp] %s（插件 %s）连接失败: %v", j.srv.Name, j.plugin.ID, err)
				mcpHub.update(j.status, func(s *mcpServerStatus) { s.Status, s.Error = "error", err.Error() })
				return
			}
			var names []string
			existing := map[string]bool{}
			for _, n := range app.ToolNames() {
				existing[n] = true
			}
			for _, t := range tools {
				if existing[t.Name] {
					log.Printf("[mcp] %s: 工具 %s 与已注册工具重名，跳过", j.srv.Name, t.Name)
					continue
				}
				existing[t.Name] = true
				catalog.setPluginOwner(t.Name, j.plugin.ID) // 先登记归属，再注册（见 setPluginOwner）
				app.Tool(t.Name, goagent.MCPToolDef(t))
				names = append(names, t.Name)
			}
			info := ""
			if si := client.ServerInfo(); si != nil {
				info = si.Name
				if si.Version != "" {
					info += " " + si.Version
				}
			}
			mcpHub.mu.Lock()
			mcpHub.clients = append(mcpHub.clients, client)
			j.status.Status, j.status.Server = "connected", info
			j.status.Tools = append(j.status.Tools, names...)
			mcpHub.mu.Unlock()
			log.Printf("[mcp] %s（插件 %s）已连接: %d 个工具", j.srv.Name, j.plugin.ID, len(names))
		}(j)
	}
}

// stopPluginMCP 断开全部 MCP 连接（stdio 服务器进程随之终止）。
func stopPluginMCP() {
	mcpHub.mu.Lock()
	clients := mcpHub.clients
	mcpHub.clients = nil
	mcpHub.mu.Unlock()
	for _, c := range clients {
		_ = c.Disconnect()
	}
}

// mcpConfig 插件声明 → 连接配置（展开 ${PLUGIN_DIR} / ${VAR}；stdio 工作目录 = 插件目录）。
func mcpConfig(p *Plugin, s MCPServer) mcp.ServerConfig {
	exp := func(v string) string { return expandVars(v, p.Dir) }
	cfg := mcp.ServerConfig{Name: s.Name, Command: exp(s.Command), URL: exp(s.URL)}
	if s.Command != "" {
		cfg.Dir = p.Dir
	}
	for _, a := range s.Args {
		cfg.Args = append(cfg.Args, exp(a))
	}
	if len(s.Env) > 0 {
		cfg.Env = make(map[string]string, len(s.Env))
		for k, v := range s.Env {
			cfg.Env[k] = exp(v)
		}
	}
	if len(s.Headers) > 0 {
		cfg.Headers = make(map[string]string, len(s.Headers))
		for k, v := range s.Headers {
			cfg.Headers[k] = exp(v)
		}
	}
	return cfg
}

var varPattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)

// expandVars 展开 ${PLUGIN_DIR}（插件目录）与 ${VAR}（进程环境变量，未设为空）。
func expandVars(s, pluginDir string) string {
	return varPattern.ReplaceAllStringFunc(s, func(m string) string {
		name := m[2 : len(m)-1]
		if name == "PLUGIN_DIR" {
			return pluginDir
		}
		return os.Getenv(name)
	})
}

// mcpRoutes MCP 状态端点（设置页 MCP 页签）。
func mcpRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /mcp": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"servers": mcpHub.snapshot()})
		},
	}
}
