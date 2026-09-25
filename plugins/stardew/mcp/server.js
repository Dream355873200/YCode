#!/usr/bin/env node
// stardew MCP server（stdio，零依赖）——消费 SMAPI mod 的本地 HTTP 桥
// （127.0.0.1:9875，游戏内运行 YCodeStardew mod 时开放）。
// 工具名注册为 mcp__stardew__<name>。桥不在时报可读的搭建指引。
"use strict";

const BRIDGE = "http://127.0.0.1:9875/";

async function bridge(action, extra = {}) {
  const body = JSON.stringify({ action, ...extra });
  let resp;
  try {
    resp = await fetch(BRIDGE, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } catch {
    throw new Error("SMAPI 桥不可达（127.0.0.1:9875）——确认：① 游戏装了 SMAPI；② 已编译并安装 YCodeStardew mod（plugins/stardew/mod/build.ps1）；③ 游戏已通过 SMAPI 启动器运行（日志里有 YCode bridge 行）");
  }
  const json = await resp.json();
  if (json.error) throw new Error(json.error);
  return json;
}

const fmtState = (s) => [
  `${s.date} · ${Math.floor(s.time / 100).toString().padStart(2, "0")}:${String(s.time % 100).padStart(2, "0")}`,
  `位置 ${s.location} (${s.tile.x}, ${s.tile.y})`,
  `金钱 ${s.money}g · 体力 ${s.stamina}`,
  `背包: ${s.inventory.map((i) => `${i.name} x${i.stack}`).join(", ") || "（空）"}`,
].join("\n");

const tools = [];
const def = (name, description, inputSchema, handler) =>
  tools.push({ name, description, inputSchema, handler });

def("sdv_state", "读取当前状态：日期/时间、位置与坐标、金钱、体力、背包清单。开工前必看。", { type: "object", properties: {} },
  async () => ({ __text: fmtState(await bridge("state")) }));

def("sdv_warp", "传送去指定地点坐标（当日快捷移动；跳过走路）。地点名如 Farm / Town / Beach / Forest / Mine / SeedShop。", {
  type: "object",
  properties: {
    location: { type: "string", description: "地图名（英文内部名，如 Farm / Town / Beach / Forest / SeedShop / Mine）" },
    x: { type: "integer" }, y: { type: "integer" },
  },
  required: ["location", "x", "y"],
}, async (a) => {
  const r = await bridge("warp", { location: a.location, x: a.x, y: a.y });
  return { __text: `已传送到 ${r.warp}——用 sdv_state 确认周围环境` };
});

def("sdv_press", "模拟一次按键（SButton 名）：MouseRight = 使用/互动（对NPC对话、开箱、收获），MouseLeft = 使用工具/挥锄，W/A/S/D 移动一格，Space，Esc = 关菜单。单次点按；持续移动请用 sdv_warp。", {
  type: "object",
  properties: {
    button: { type: "string", description: "SButton 名（MouseRight / MouseLeft / W / A / S / D / Space / Esc / E …）" },
    times: { type: "integer", description: "按几次（默认 1）" },
  },
  required: ["button"],
}, async (a) => {
  const r = await bridge("press", { button: a.button, times: a.times || 1 });
  return { __text: `已按 ${r.pressed}——用 sdv_state 观察结果` };
});

// ---------- stdio JSON-RPC 分发（与 minecraft 同协议骨架） ----------

const textResult = (t, isError) => ({ content: [{ type: "text", text: String(t) }], isError: !!isError });

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      return { id, result: { protocolVersion: params && params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "ycode-stardew", version: "1.0.0" } } };
    }
    if (method === "tools/list") {
      return { id, result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) } };
    }
    if (method === "tools/call") {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return { id, result: textResult(`未知工具: ${params.name}`, true) };
      try {
        const r = await tool.handler(params.arguments || {});
        if (r && r.__text !== undefined) return { id, result: textResult(r.__text) };
        return { id, result: textResult(typeof r === "string" ? r : JSON.stringify(r, null, 2)) };
      } catch (e) {
        return { id, result: textResult(String(e.message || e) + "\n\n（可恢复失败：按指引搭建/检查桥后重试）", true) };
      }
    }
    if (method === "ping") return { id, result: {} };
    return { id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (e) {
    return { id, error: { code: -32603, message: String(e.message || e) } };
  }
}

let buf = "";
let inflight = 0;
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
    inflight += 1;
    handle(msg)
      .then((resp) => { if (resp) process.stdout.write(JSON.stringify(resp) + "\n"); })
      .catch((e) => process.stdout.write(JSON.stringify({ id: msg.id, error: { code: -32603, message: String(e && e.message || e) } }) + "\n"))
      .finally(() => { inflight -= 1; });
  }
});
// stdin 结束后等在途请求完成再退出（桥调用有 5s 超时）
process.stdin.on("end", () => {
  const wait = () => { if (inflight > 0) setTimeout(wait, 150); else process.exit(0); };
  wait();
});
