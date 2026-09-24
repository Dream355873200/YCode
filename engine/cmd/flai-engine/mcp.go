// mcp.go 插件 MCP 服务器：引擎启动后后台连接，工具归属声明它的插件。
//
// 被任一模式引用的插件，其 mcpServers 在引擎启动 / reload 后并行连接（单个
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
	"strings"
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

// mcpEntry 一个在册的 MCP 服务器（sig = 声明指纹，变更即重连）。
type mcpEntry struct {
	status *mcpServerStatus
	sig    string
	client *mcp.Client
}

// mcpHubT 进程级 MCP 连接表（按服务器名索引；servers 保持展示顺序）。
type mcpHubT struct {
	mu      sync.RWMutex
	servers []*mcpServerStatus
	entries map[string]*mcpEntry
}

var mcpHub = &mcpHubT{entries: map[string]*mcpEntry{}}

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

// syncPluginMCP 按目录对账 MCP 服务器：被模式引用的插件声明的服务器后台
// 并行连接（已连且声明未变的保留）；不再声明或声明变更的断开并下线其工具。
// 立即返回；状态表同步建好（新连接初始 connecting）。调用方串行（启动 / reloadMu）。
func syncPluginMCP(app *goagent.App, c *Catalog) {
	type want struct {
		plugin *Plugin
		srv    MCPServer
		sig    string
	}
	var order []want
	for _, p := range c.UsedPlugins() {
		for _, srv := range p.MCPServers {
			b, _ := json.Marshal(struct {
				Plugin, Dir string
				Srv         MCPServer
			}{p.ID, p.Dir, srv})
			order = append(order, want{p, srv, string(b)})
		}
	}
	desired := map[string]want{}
	for _, w := range order {
		desired[w.srv.Name] = w
	}

	type job struct {
		want
		e *mcpEntry
	}
	var stale []*mcpEntry
	var jobs []job
	mcpHub.mu.Lock()
	for name, e := range mcpHub.entries {
		if w, ok := desired[name]; !ok || w.sig != e.sig {
			stale = append(stale, &mcpEntry{status: &mcpServerStatus{Tools: append([]string{}, e.status.Tools...)}, client: e.client})
			delete(mcpHub.entries, name)
		}
	}
	mcpHub.servers = nil
	for _, w := range order {
		e := mcpHub.entries[w.srv.Name]
		if e == nil {
			transport := "stdio"
			if w.srv.URL != "" {
				transport = "http"
			}
			e = &mcpEntry{sig: w.sig, status: &mcpServerStatus{Plugin: w.plugin.ID, Name: w.srv.Name, Transport: transport, Status: "connecting", Tools: []string{}}}
			mcpHub.entries[w.srv.Name] = e
			jobs = append(jobs, job{w, e})
		}
		mcpHub.servers = append(mcpHub.servers, e.status)
	}
	mcpHub.mu.Unlock()

	for _, e := range stale {
		for _, t := range e.status.Tools {
			pluginTools.hide(t)
		}
		if e.client != nil {
			_ = e.client.Disconnect()
		}
	}
	for _, j := range jobs {
		go connectPluginMCP(app, j.plugin, j.srv, j.e)
	}
}

// connectPluginMCP 连接单个服务器并注册其工具。连接期间若被 reload 取代
// （entries 里已不是这一项），断开并下线，不污染新状态。
func connectPluginMCP(app *goagent.App, p *Plugin, srv MCPServer, e *mcpEntry) {
	current := func() bool { return mcpHub.entries[srv.Name] == e }
	ctx, cancel := context.WithTimeout(context.Background(), pluginMCPTimeout)
	defer cancel()
	client, tools, err := mcp.Connect(ctx, mcpConfig(p, srv))
	if err != nil {
		log.Printf("[mcp] %s（插件 %s）连接失败: %v", srv.Name, p.ID, err)
		mcpHub.mu.Lock()
		e.status.Status, e.status.Error = "error", err.Error()
		mcpHub.mu.Unlock()
		return
	}
	mcpHub.mu.RLock()
	live := current()
	mcpHub.mu.RUnlock()
	if !live {
		_ = client.Disconnect()
		return
	}
	var names []string
	existing := map[string]bool{}
	for _, n := range app.ToolNames() {
		existing[n] = true
	}
	own := "mcp__" + srv.Name + "__"
	for _, t := range tools {
		// 同名工具只允许是本服务器上一次连接留下的（重连覆盖）
		if existing[t.Name] && !strings.HasPrefix(t.Name, own) {
			log.Printf("[mcp] %s: 工具 %s 与已注册工具重名，跳过", srv.Name, t.Name)
			continue
		}
		existing[t.Name] = true
		pluginTools.claim(t.Name, p.ID) // 先登记归属，再注册
		app.ReplaceTool(t.Name, goagent.MCPToolDef(t))
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
	if !current() { // 注册期间被取代：撤回
		mcpHub.mu.Unlock()
		for _, n := range names {
			pluginTools.hide(n)
		}
		_ = client.Disconnect()
		return
	}
	e.client = client
	e.status.Status, e.status.Server = "connected", info
	e.status.Tools = append(e.status.Tools, names...)
	mcpHub.mu.Unlock()
	log.Printf("[mcp] %s（插件 %s）已连接: %d 个工具", srv.Name, p.ID, len(names))
}

// stopPluginMCP 断开全部 MCP 连接（stdio 服务器进程随之终止）。
func stopPluginMCP() {
	mcpHub.mu.Lock()
	var clients []*mcp.Client
	for _, e := range mcpHub.entries {
		if e.client != nil {
			clients = append(clients, e.client)
			e.client = nil
		}
	}
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
