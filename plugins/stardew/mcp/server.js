#!/usr/bin/env node
// stardew MCP server（stdio，零依赖）——消费 SMAPI mod 的本地 HTTP 桥。
// 并肩联机：同机可跑多个游戏实例（每个农夫一个 bot），mod 从 9875 起自动
// 挑空闲端口；本服务器按端口段探测在线实例，工具的 who 参数指定控制哪个
// 农夫（名字或端口），缺省 = 第一个在线的。工具名 mcp__stardew__<name>。
"use strict";

// allow_warp = false 时禁用传送（纯粹体验：移动靠走路/公交），默认允许。
let allowWarp = true;
try {
  const cfg = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "config.json"), "utf8"));
  if (cfg && cfg.allow_warp === false) allowWarp = false;
} catch { /* 无配置文件：默认允许 */ }

// ---------- 实例发现（9875-9885，结果缓存 5s） ----------
const PORT_RANGE = [9875, 9885];
let cache = { at: 0, list: [] }; // [{url, port, farmer, location}]

async function discover(force) {
  if (!force && Date.now() - cache.at < 5000) return cache.list;
  const probe = async (port) => {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 800);
      const r = await fetch(`http://127.0.0.1:${port}/?action=state`, { signal: c.signal });
      clearTimeout(t);
      const j = await r.json();
      if (j && j.location) return { url: `http://127.0.0.1:${port}/`, port, farmer: j.farmer || `p${port}`, location: j.location };
    } catch { /* 不在线 */ }
    return null;
  };
  const probes = [];
  for (let p = PORT_RANGE[0]; p <= PORT_RANGE[1]; p++) probes.push(probe(p));
  const list = (await Promise.all(probes)).filter(Boolean);
  cache = { at: Date.now(), list };
  return list;
}

async function bridge(action, extra = {}, who = "") {
  const list = await discover();
  if (!list.length) {
    throw new Error("SMAPI 桥不可达（9875-9885 无实例）——确认：① 游戏装了 SMAPI；② 已编译安装 YCodeStardew mod（plugins/stardew/mod/build.ps1）；③ 游戏经 SMAPI 启动器运行");
  }
  let inst = list[0];
  if (who) {
    const w = String(who).toLowerCase();
    inst = list.find((x) => x.farmer.toLowerCase().includes(w) || String(x.port) === w) || inst;
  }
  const body = JSON.stringify({ action, ...extra });
  const r = await fetch(inst.url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const json = await r.json();
  if (json.error) throw new Error(json.error);
  return json;
}

const fmtState = (s) => [
  `农夫 ${s.farmer || "?"} · ${s.date} · ${Math.floor(s.time / 100).toString().padStart(2, "0")}:${String(s.time % 100).padStart(2, "0")}`,
  `位置 ${s.location} (${s.tile.x}, ${s.tile.y})`,
  `金钱 ${s.money}g · 体力 ${s.stamina}`,
  `背包: ${s.inventory.map((i) => `${i.name} x${i.stack}`).join(", ") || "（空）"}`,
].join("\n");

const tools = [];
const def = (name, description, inputSchema, handler) =>
  tools.push({ name, description, inputSchema, handler });

const Who = { who: { type: "string", description: "控制哪个农夫（名字或端口；多实例并肩时用，缺省 = 第一个在线的）" } };

def("sdv_farmers", "列出当前在线的全部农夫实例（并肩联机时你和 bot 各一个），who 参数可填这里看到的名字或端口。", { type: "object", properties: {} },
  async () => {
    const list = await discover();
    if (!list.length) return { __text: "没有在线实例（游戏没开或 mod 未装）" };
    return { __text: list.map((x) => `${x.farmer}（端口 ${x.port}）@ ${x.location}`).join("\n") };
  });

def("sdv_state", "读取当前状态：农夫名、日期/时间、位置与坐标、金钱、体力、背包清单。开工前必看。", {
  type: "object", properties: Who,
}, async (a) => ({ __text: fmtState(await bridge("state", {}, a.who)) }));

def("sdv_warp", "传送去指定地点坐标（当日快捷移动；跳过走路）。地点名如 Farm / Town / Beach / Forest / Mine / SeedShop。", {
  type: "object",
  properties: {
    location: { type: "string", description: "地图名（英文内部名，如 Farm / Town / Beach / Forest / SeedShop / Mine）" },
    x: { type: "integer" }, y: { type: "integer" },
    who: Who.who,
  },
  required: ["location", "x", "y"],
}, async (a) => {
  if (!allowWarp) return { __text: "传送已被关闭（config.json allow_warp: false）——同地图用 sdv_press WASD 走，跨地图坐公交/步行（让用户带路或授权开启传送）", isError: true };
  const r = await bridge("warp", { location: a.location, x: a.x, y: a.y }, a.who);
  return { __text: `已传送到 ${r.warp}——用 sdv_state 确认周围环境` };
});

def("sdv_press", "模拟一次按键（SButton 名）：MouseRight = 使用/互动（对NPC对话、开箱、收获），MouseLeft = 使用工具/挥锄，W/A/S/D 移动一格，Space，Esc = 关菜单。单次点按；持续移动请用 sdv_warp。", {
  type: "object",
  properties: {
    button: { type: "string", description: "SButton 名（MouseRight / MouseLeft / W / A / S / D / Space / Esc / E …）" },
    times: { type: "integer", description: "按几次（默认 1）" },
    who: Who.who,
  },
  required: ["button"],
}, async (a) => {
  const r = await bridge("press", { button: a.button, times: a.times || 1 }, a.who);
  return { __text: `已按 ${r.pressed}——用 sdv_state 观察结果` };
});

def("sdv_wiki", "查 Stardew Valley Wiki（stardewvalleywiki.com）：作物/售价/送礼偏好/事件/机制。query 搜主题（如 'spring crops'、'Abigail gifts'）；页名已知传 page。", {
  type: "object",
  properties: {
    query: { type: "string", description: "搜索关键词" },
    page: { type: "string", description: "直接取某个页面（title）" },
    limit: { type: "integer", description: "正文截断长度（默认 4000 字符）" },
  },
  required: [],
}, async (a) => {
  if (typeof fetch !== "function") return { __text: "当前 Node 版本没有全局 fetch（需 Node 18+）" };
  const api = "https://stardewvalleywiki.com/mediawiki/api.php";
  const limit = Math.min(12000, Math.max(500, a.limit || 4000));
  try {
    let title = a.page;
    if (!title) {
      const q = encodeURIComponent(String(a.query || ""));
      if (!q) return { __text: "传 query（搜索词）或 page（页面名）" };
      const sr = await (await fetch(`${api}?action=query&list=search&srsearch=${q}&format=json&srlimit=5`)).json();
      const hits = ((sr.query || {}).search || []).map((h) => h.title);
      if (!hits.length) return { __text: `Wiki 搜索「${a.query}」无结果——换英文关键词` };
      title = hits[0];
    }
    // index.php?action=raw 会被 Cloudflare 挑战（403），走 api.php 的 parse 端点
    const pr = await (await fetch(`https://stardewvalleywiki.com/mediawiki/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&redirects=1`)).json();
    if (pr.error) return { __text: `页面「${title}」不存在（可先用 query 搜索）` };
    const raw = pr.parse.wikitext["*"] || "";
    const clean = raw
      .replace(/\{\{[^{}]*\}\}/g, "")
      .replace(/<ref[^>]*\/?>|<ref[\s\S]*?<\/ref>/g, "")
      .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, "$2")
      .replace(/\n{3,}/g, "\n\n");
    return { __text: `「${title}」（wikitext 节选 ${Math.min(limit, clean.length)}/${clean.length} 字符）\n\n${clean.slice(0, limit)}${clean.length > limit ? "\n…（截断）" : ""}` };
  } catch (e) {
    return { __text: `Wiki 查询失败: ${e.message}（检查网络）` };
  }
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
