#!/usr/bin/env node
// browser-use MCP server（stdio，零依赖）——YCode 内置浏览器的 agent 工具面。
//
// 本 server 是薄代理：把 mcp__browser__* 工具调用转发给桌面壳主进程的控制端点
// （WebContentsView 实例池 + CDP 执行，见 desktop/electron/lib/browserctl.js）。
// 端口与 token 由引擎环境变量 FLAI_BROWSER_PORT / FLAI_BROWSER_TOKEN 提供
// （桌面壳启动时注入）。多实例并行：browser_new 开独立实例，动作按实例串行。
"use strict";
const http = require("http");

const PORT = () => process.env.FLAI_BROWSER_PORT || "";
const TOKEN = () => process.env.FLAI_BROWSER_TOKEN || "";

function call(path, body, method = "POST") {
  return new Promise((resolve, reject) => {
    if (!PORT() || !TOKEN()) {
      return reject(new Error("浏览器控制端点未配置（缺少 FLAI_BROWSER_PORT/TOKEN）——从桌面壳重启引擎后可用"));
    }
    const isGet = method === "GET" || body === undefined;
    const payload = isGet ? null : JSON.stringify(body || {});
    const headers = { Authorization: `Bearer ${TOKEN()}` };
    if (!isGet) headers["Content-Type"] = "application/json";
    const req = http.request({
      hostname: "127.0.0.1", port: PORT(), path, method: isGet ? "GET" : "POST",
      headers, timeout: 60_000,
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const obj = JSON.parse(data);
          if (res.statusCode !== 200) return reject(new Error(obj.error || data));
          resolve(obj);
        } catch { reject(new Error(`端点响应异常（${res.statusCode}）: ${data.slice(0, 200)}`)); }
      });
    });
    req.on("error", (e) => reject(new Error(`浏览器控制端点不可达（桌面壳未运行？）: ${e.message}`)));
    req.on("timeout", () => { req.destroy(new Error("端点超时")); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------- 工具定义 ----------

const tools = [];
const def = (name, description, inputSchema, handler) =>
  tools.push({ name, description, inputSchema, handler });

const BROWSER = { type: "string", description: "实例 id（browser_list/browser_new 返回）；省略 = 当前激活实例" };

def("browser_list", "列出全部浏览器实例（id/URL/标题/激活/挂起状态）。并行会话各有自己的实例。", { type: "object", properties: {} },
  async () => call("/browser/status", undefined, "GET"));

def("browser_new", "新开一个浏览器实例并激活（右栏可见）。并行任务、隔离登录态时用它。", {
  type: "object", properties: { url: { type: "string", description: "初始 URL（可省略=空白页）" } },
}, async (a) => call("/browser/new", a));

def("browser_close", "关闭一个浏览器实例。", {
  type: "object", properties: { browser: BROWSER },
}, (a) => call("/browser/close", a));

def("browser_navigate", "在当前浏览器标签页打开 URL（http/https；搜索类请求直接拼搜索 URL，如 B 站 https://search.bilibili.com/all?keyword=关键词、百度 https://www.baidu.com/s?wd=关键词）。用户说「打开浏览器/搜一下/看看某网站」时，直接用本工具打开网址即可，不需要先开桌面浏览器。等待加载完成后返回标题。", {
  type: "object",
  properties: { url: { type: "string" }, browser: BROWSER }, required: ["url"],
}, (a) => call("/browser/navigate", a));

def("browser_back", "后退一页（历史栈自管，跨挂起存活）。", { type: "object", properties: { browser: BROWSER } },
  (a) => call("/browser/back", a));

def("browser_forward", "前进一页。", { type: "object", properties: { browser: BROWSER } },
  (a) => call("/browser/forward", a));

def("browser_reload", "刷新当前页。", { type: "object", properties: { browser: BROWSER } },
  (a) => call("/browser/reload", a));

def("browser_snapshot", "取当前页的紧凑可交互快照：交互元素按 @eN 编号（文本/占位/aria-label/href），点击与输入用 @eN 指定目标。页面变化后必须重新快照。", {
  type: "object",
  properties: { browser: BROWSER, max: { type: "integer", description: "元素上限（默认 400）" } },
}, (a) => call("/browser/snapshot", a));

def("browser_click", "点击目标：@eN 引用（来自最近一次快照）或视口坐标 {x,y}。点击后自动等加载。", {
  type: "object",
  properties: {
    ref: { type: "string", description: "@eN（优先）" },
    x: { type: "integer" }, y: { type: "integer" },
    button: { type: "string", enum: ["left", "right", "middle"] },
    clickCount: { type: "integer", description: "双击传 2" },
    browser: BROWSER,
  },
}, (a) => call("/browser/click", a));

def("browser_type", "输入文本：给 ref 就先点该元素获得焦点再输入（Unicode，支持中文）；submit=true 回车提交。", {
  type: "object",
  properties: {
    text: { type: "string" }, ref: { type: "string" }, submit: { type: "boolean" }, browser: BROWSER,
  }, required: ["text"],
}, (a) => call("/browser/type", a));

def("browser_key", "按键/组合键，如 Enter / Tab / Escape / Control+a（+ 连接）。", {
  type: "object", properties: { key: { type: "string" }, browser: BROWSER }, required: ["key"],
}, (a) => call("/browser/key", a));

def("browser_scroll", "滚动（像素）：dx/dy，可指定 ref 或坐标处滚动。", {
  type: "object",
  properties: { dx: { type: "integer" }, dy: { type: "integer" }, ref: { type: "string" }, browser: BROWSER },
}, (a) => call("/browser/scroll", a));

def("browser_screenshot", "截图当前页（JPEG 内联给模型看）。fullPage=true 截整页。视觉验证用；元素定位优先 browser_snapshot。", {
  type: "object",
  properties: { fullPage: { type: "boolean" }, browser: BROWSER },
}, async (a) => {
  const r = await call("/browser/screenshot", a);
  return { __image: r };
});

def("browser_console", "读取最近的 console 消息/页面异常（调试前端用）。", {
  type: "object", properties: { browser: BROWSER },
}, (a) => call("/browser/console", a));

def("browser_evaluate", "在页面里执行 JS 表达式并返回值（awaitPromise）。验证性读取与兜底手段；能快照解决就不要用它改页面。", {
  type: "object",
  properties: { expression: { type: "string" }, browser: BROWSER }, required: ["expression"],
}, (a) => call("/browser/evaluate", a));

// ---------- MCP stdio（与 computer-use 同一套轻量骨架） ----------

const SERVER_INFO = { name: "ycode-browser-use", version: "0.1.0" };

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null;
  try {
    if (method === "initialize") {
      return { id, result: { protocolVersion: params.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
    }
    if (method === "tools/list") return { id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
    if (method === "tools/call") {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return { id, result: textResult(`未知工具: ${params.name}`, true) };
      try {
        const r = await tool.handler(params.arguments || {});
        if (r && r.__image) {
          // 防御：b64 缺失/过短说明截屏失败，绝不发出毒标记（会永久卡死会话）
          const img = r.__image;
          if (!img.b64 || img.b64.length < 100) {
            return { id, result: textResult("截图失败：画面数据为空", true) };
          }
          return { id, result: textResult(`[IMAGE jpeg ${img.b64}]\n网页截图已附上: ${img.path}`) };
        }
        return { id, result: textResult(typeof r === "string" ? r : JSON.stringify(r, null, 2)) };
      } catch (e) {
        return { id, result: textResult(String(e.message || e), true) };
      }
    }
    if (method === "ping") return { id, result: {} };
    return { id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (e) {
    return { id, error: { code: -32603, message: String(e.message || e) } };
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).then((resp) => { if (resp) process.stdout.write(JSON.stringify(resp) + "\n"); });
  }
});
process.stdin.on("end", () => process.exit(0));
