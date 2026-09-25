#!/usr/bin/env node
// minecraft MCP server（stdio）——意图级 Minecraft bot 工具（mineflayer 驱动）。
//
// 工具名注册为 mcp__minecraft__<name>。粒度原则：意图级（move_to / dig /
// craft / attack / state），按键级操作留给通用 computer-use。
//
// 连接配置（惰性连接：首个工具调用才真正连服务器，配置缺失报可读错误）：
//   环境变量 MC_HOST / MC_PORT / MC_USERNAME / MC_PASSWORD / MC_VERSION
//   或 mcp/config.json {host, port, username, password, version}
//   password 留空 = offline 正版校验跳过（局域网 / 单人 LAN / 离线服）。
//
// 依赖：mineflayer + mineflayer-pathfinder（插件根目录 npm install）。
// require 放在 ensureBot 里惰性执行——依赖没装时 MCP 服务器照常启动，
// 调用工具时才报「先在插件目录 npm install」。
"use strict";
const path = require("path");
const fs = require("fs");

const PLUGIN_ROOT = path.join(__dirname, "..");

function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
  } catch { /* 无配置文件：全走环境变量与缺省 */ }
  const env = process.env;
  return {
    host: env.MC_HOST || file.host || "127.0.0.1",
    port: Number(env.MC_PORT || file.port || 25565),
    username: env.MC_USERNAME || file.username || "YCode",
    password: env.MC_PASSWORD || file.password || "",
    version: env.MC_VERSION || file.version || false,
  };
}

// ---------- 惰性 bot 连接 ----------

let bot = null;
let ready = false;
let connecting = null;

const fmtCfg = (c) => `${c.host}:${c.port}（用户名 ${c.username}）`;

async function ensureBot() {
  if (bot && ready) return bot;
  if (connecting) return connecting;
  const cfg = loadConfig();
  let mineflayer, pf;
  try {
    mineflayer = require("mineflayer");
    pf = require("mineflayer-pathfinder");
  } catch {
    throw new Error("依赖未安装：在插件目录 plugins/minecraft 下执行 npm install（需要 mineflayer + mineflayer-pathfinder）");
  }
  connecting = (async () => {
    const b = mineflayer.createBot({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password: cfg.password || undefined,
      auth: cfg.password ? "microsoft" : "offline",
      version: cfg.version || false,
    });
    b.loadPlugin(pf.pathfinder);
    b.on("error", () => { if (!ready) { /* 连接期错误由 spawn 等待路径报告 */ } });
    b.on("kicked", (r) => { ready = false; lastKick = String(r); });
    b.on("end", () => { ready = false; bot = null; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        b.end();
        reject(new Error(`连接超时（30s）: ${fmtCfg(cfg)} —— 检查服务器是否在线、MC_VERSION 是否与服务器匹配`));
      }, 30_000);
      const onSpawn = () => { clearTimeout(timer); cleanup(); resolve(); };
      const onErr = (e) => { clearTimeout(timer); cleanup(); reject(new Error(`连接失败: ${e.message}（${fmtCfg(cfg)}）`)); };
      const cleanup = () => { b.off("spawn", onSpawn); b.off("error", onErr); };
      b.once("spawn", onSpawn);
      b.once("error", onErr);
    });
    // 寻路参数：默认即可走 1x1 塔与搭桥；危险动作（挖脚下）不放开
    b.pathfinder.setMovements(new pf.Movements(b));
    b.on("death", () => { try { b.chat("我死了，正在重生……"); } catch {} });
    bot = b;
    ready = true;
    b.on("chat", (username, text) => { try { onGameChat(username, text); } catch {} });
    return b;
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

let lastKick = "";

// ---------- 游戏聊天：缓冲 + 推送桥 ----------
//
// chatLog 缓存最近 40 条（mc_chat_log 拉取用）。chat_push.enabled 时，
// 游戏聊天按过滤条件 POST 到引擎 /chat 唤醒指定会话（忙则 guide 车道插话，
// 闲则新开一轮）——agent 于是能「听到」游戏里说话并响应。
const chatLog = [];
const CHAT_LOG_MAX = 40;

function pushCfg() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")); } catch {}
  const c = file.chat_push || {};
  return {
    enabled: c.enabled !== false && !!c.session_id,
    engineUrl: c.engine_url || process.env.MC_ENGINE_URL || "http://127.0.0.1:8420",
    sessionId: c.session_id || "",
    mentionOnly: !!c.mention_only,
    cooldownMs: Math.max(5, Number(c.cooldown_s || 20)) * 1000,
  };
}
let lastPush = 0;

function onGameChat(username, text) {
  chatLog.push({ ts: Date.now(), from: username, text });
  if (chatLog.length > CHAT_LOG_MAX) chatLog.shift();
  const cfg = pushCfg();
  if (!cfg.enabled || username === (bot && bot.username)) return;
  if (cfg.mentionOnly && !text.toLowerCase().includes((bot && bot.username || "").toLowerCase())) return;
  const now = Date.now();
  if (now - lastPush < cfg.cooldownMs) return;
  lastPush = now;
  fetch(`${cfg.engineUrl}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: `[MC游戏聊天] ${username} 说: ${text}（用 mc_chat 回应，mc_state 了解处境）`, session_id: cfg.sessionId }),
  }).catch(() => {});
}

def("mc_chat_log", "翻看最近的 Minecraft 游戏聊天（缓存最近 40 条）。bot 上线期间别人说的话都在这里。", {
  type: "object",
  properties: { limit: { type: "integer", description: "最近 N 条（默认 20）" } },
  required: [],
}, async (a) => {
  const n = Math.min(40, Math.max(1, a.limit || 20));
  const recent = chatLog.slice(-n);
  if (!recent.length) return { __text: "还没有聊天记录（bot 在线期间才会缓存）" };
  return { __text: recent.map((c) => `[${new Date(c.ts).toLocaleTimeString("zh-CN", { hour12: false })}] ${c.from}: ${c.text}`).join("\n") };
});

// ---------- 工具 ----------
const tools = [];
const def = (name, description, inputSchema, handler) =>
  tools.push({ name, description, inputSchema, handler });

const fmtPos = (p) => p ? `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})` : "(未知)";
const fmtItem = (i) => `${i.name} x${i.count}`;

function invSummary(b) {
  const items = b.inventory.items();
  if (!items.length) return "（空）";
  const grouped = {};
  for (const it of items) grouped[it.name] = (grouped[it.name] || 0) + it.count;
  return Object.entries(grouped).map(([n, c]) => `${n} x${c}`).join(", ");
}

function heldName(b) {
  const h = b.inventory.items().find((i) => b.heldItem && i.type === b.heldItem.type);
  return h ? h.name : "（空手）";
}

def("mc_state", "读取当前状态：坐标、生命、饥饿、维度、持械、背包摘要、附近实体、是否连接。开工前必看。", { type: "object", properties: {} },
  async () => {
    const b = await ensureBot();
    const ents = Object.values(b.entities)
      .filter((e) => e !== b.entity && e.position)
      .map((e) => ({ name: e.name || e.displayName || "unknown", d: e.position.distanceTo(b.entity.position), kind: e.kind }))
      .sort((a, b2) => a.d - b2.d)
      .slice(0, 8)
      .map((e) => `${e.name}@${e.d.toFixed(1)}m`);
    return {
      __text: [
        `已连接 ${loadConfig().host}:${loadConfig().port}`,
        `位置 ${fmtPos(b.entity.position)}（维度 ${b.game.dimension}）`,
        `生命 ${b.health}/20 · 饥饿 ${b.food}/20`,
        `持械 ${heldName(b)}`,
        `背包: ${invSummary(b)}`,
        ents.length ? `附近实体: ${ents.join(", ")}` : "附近没有实体",
        lastKick ? `（上次被踢原因: ${lastKick}）` : "",
      ].filter(Boolean).join("\n"),
    };
  });

def("mc_blocks_around", "扫描周围已加载的方块：按名称过滤（模糊匹配，如 oak_log、stone、diamond_ore），列出最近 N 个的位置。找资源/地形必看。", {
  type: "object",
  properties: {
    name: { type: "string", description: "方块名模糊匹配（留空 = 全部非空气方块）" },
    radius: { type: "integer", description: "搜索半径（格，默认 8，最大 32）" },
    limit: { type: "integer", description: "最多返回几个位置（默认 20）" },
  },
  required: [],
}, async (a) => {
  const b = await ensureBot();
  const radius = Math.min(32, Math.max(1, a.radius || 8));
  const limit = Math.min(50, Math.max(1, a.limit || 20));
  const registry = b.registry;
  let ids = null;
  if (a.name) {
    const want = String(a.name).toLowerCase();
    ids = Object.values(registry.blocksByName)
      .filter((bl) => bl.name.toLowerCase().includes(want))
      .map((bl) => bl.id);
    if (!ids.length) return { __text: `没有匹配「${a.name}」的方块类型（周围已加载区块里没有，或名字写错——用英文小写）` };
  }
  const matching = ids || ((bl) => bl.boundingBox !== "empty");
  const found = b.findBlocks({ matching, maxDistance: radius, count: limit * 4 })
    .map((p) => b.blockAt(p))
    .filter(Boolean)
    .filter((bl) => !a.name || bl.name.toLowerCase().includes(String(a.name).toLowerCase()))
    .slice(0, limit);
  if (!found.length) return { __text: `半径 ${radius} 内没找到${a.name ? `「${a.name}」` : "方块"}——可能没加载到那个区域的区块，先 mc_move_to 靠近` };
  const me = b.entity.position;
  return {
    __text: found.map((bl) => {
      const d = bl.position.distanceTo(me).toFixed(1);
      return `${bl.name} @ (${bl.position.x}, ${bl.position.y}, ${bl.position.z}) 距离 ${d}m`;
    }).join("\n"),
  };
});

def("mc_move_to", "寻路走到目标坐标（自动绕障/搭桥/上塔）。长距离先 mc_state 确认自己的位置再下目标。", {
  type: "object",
  properties: {
    x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" },
    radius: { type: "number", description: "到达判定半径（默认 1）" },
    timeout_s: { type: "integer", description: "超时秒数（默认 120）" },
  },
  required: ["x", "y", "z"],
}, async (a) => {
  const b = await ensureBot();
  const { goals } = require("mineflayer-pathfinder");
  b.pathfinder.setGoal(new goals.GoalNear(a.x, a.y, a.z, a.radius || 1));
  const timeoutS = a.timeout_s || 120;
  const ok = await new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutS * 1000);
    const onReach = () => { cleanup(); resolve(true); };
    const cleanup = () => { clearTimeout(timer); b.off("goal_reached", onReach); };
    b.once("goal_reached", onReach);
  });
  const now = fmtPos(b.entity.position);
  if (!ok) {
    b.pathfinder.setGoal(null);
    return { __text: `寻路超时（${timeoutS}s）：当前位置 ${now}，距离目标还很远——目标可能不可达（被水/悬崖/未加载区块挡住），换个中间点分步走` };
  }
  return { __text: `已到达 ${now}` };
});

def("mc_dig", "挖掘方块：传坐标挖指定位置，或传方块名挖最近的匹配方块（可 count 连挖）。挖完掉落物自动吸入。", {
  type: "object",
  properties: {
    x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" },
    name: { type: "string", description: "方块名模糊匹配（与坐标二选一；配合 count 连挖同种）" },
    count: { type: "integer", description: "name 模式下连挖数量（默认 1）" },
  },
  required: [],
}, async (a) => {
  const b = await ensureBot();
  const targets = [];
  if (a.name) {
    const want = String(a.name).toLowerCase();
    const ids = Object.values(b.registry.blocksByName).filter((bl) => bl.name.toLowerCase().includes(want)).map((bl) => bl.id);
    if (!ids.length) return { __text: `没有匹配「${a.name}」的方块类型` };
    const count = Math.min(64, Math.max(1, a.count || 1));
    const found = b.findBlocks({ matching: ids, maxDistance: 32, count }).slice(0, count);
    if (!found.length) return { __text: `半径 32 内没找到「${a.name}」——先靠近（mc_move_to 到资源区附近）` };
    targets.push(...found);
  } else if (Number.isInteger(a.x) && Number.isInteger(a.y) && Number.isInteger(a.z)) {
    targets.push(b.blockAt(new (require("vec3").Vec3)(a.x, a.y, a.z)));
  } else {
    return { __text: "传坐标 (x,y,z) 或方块名 (name) 二选一" };
  }
  const dug = [];
  for (const p of targets) {
    const bl = p && b.blockAt(p);
    if (!bl || bl.boundingBox === "empty") continue;
    await b.dig(bl);
    dug.push(`${bl.name}@${fmtPos(bl.position)}`);
  }
  if (!dug.length) return { __text: "目标位置没有可挖的方块（空气或不存在的坐标）" };
  return { __text: `已挖 ${dug.length} 个: ${dug.join(", ")}\n背包: ${invSummary(b)}` };
});

def("mc_place", "在目标位置放置方块（从背包选第一个可放置方块；需要相邻有实体方块作为依托面）。", {
  type: "object",
  properties: { x: { type: "integer" }, y: { type: "integer" }, z: { type: "integer" } },
  required: ["x", "y", "z"],
}, async (a) => {
  const b = await ensureBot();
  const Vec3 = require("vec3").Vec3;
  const target = new Vec3(a.x, a.y, a.z);
  const item = b.inventory.items().find((i) => i.name !== "stick" && !/sword|pickaxe|axe|shovel|food|apple|bread|porkchop|beef/.test(i.name));
  if (!item) return { __text: "背包里没有可放置的方块（先挖或合成）" };
  await b.equip(item, "hand");
  for (const d of [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]) {
    const ref = b.blockAt(target.plus(d));
    if (ref && ref.boundingBox !== "empty") {
      await b.placeBlock(ref, d.clone().negate());
      return { __text: `已在 ${fmtPos(target)} 放置 ${item.name}（依托 ${ref.name}）` };
    }
  }
  return { __text: `目标位置 ${fmtPos(target)} 周围没有实体方块可依托——先搭一个支撑或换个位置` };
});

def("mc_craft", "合成物品：按名字模糊匹配配方。需要工作台的配方要传 table_pos（站在工作台旁）。", {
  type: "object",
  properties: {
    item: { type: "string", description: "物品名（英文小写，如 crafting_table / wooden_pickaxe / stick）" },
    count: { type: "integer", description: "合成次数（默认 1）" },
    table_x: { type: "integer" }, table_y: { type: "integer" }, table_z: { type: "integer" },
  },
  required: ["item"],
}, async (a) => {
  const b = await ensureBot();
  const want = String(a.item).toLowerCase();
  const entry = Object.entries(b.registry.itemsByName).find(([n]) => n.includes(want));
  if (!entry) return { __text: `没有叫「${a.item}」的物品（用英文小写全名，如 wooden_pickaxe）` };
  const id = entry[1].id;
  let table = null;
  if (Number.isInteger(a.table_x)) {
    const Vec3 = require("vec3").Vec3;
    table = b.blockAt(new Vec3(a.table_x, a.table_y, a.table_z));
  } else {
    const near = b.findBlocks({ matching: (bl) => bl.name === "crafting_table", maxDistance: 5, count: 1 });
    if (near.length) table = b.blockAt(near[0]);
  }
  const recipes = b.recipesFor(id, null, 1, table);
  if (!recipes.length) {
    return { __text: `没有「${entry[0]}」的可用配方——可能缺材料（背包: ${invSummary(b)}），或该配方需要工作台而附近没有（传 table_pos 或先放一个）` };
  }
  const count = Math.min(64, Math.max(1, a.count || 1));
  await b.craft(recipes[0], count, table);
  return { __text: `已合成 ${entry[0]} x${count}\n背包: ${invSummary(b)}` };
});

def("mc_wiki", "查 Minecraft Wiki（minecraft.wiki）：配方、物品用途、生物掉落、机制。query 传主题（如 'crafting table'、'diamond'、'zombie drops'）；页名已知时传 page 直取（如 'Tutorials/Beginner's guide'）。返回 wikitext 节选。", {
  type: "object",
  properties: {
    query: { type: "string", description: "搜索关键词" },
    page: { type: "string", description: "直接取某个页面（title，如 'Crafting/Stone Pickaxe'）" },
    limit: { type: "integer", description: "正文截断长度（默认 4000 字符）" },
  },
  required: [],
}, async (a) => {
  if (typeof fetch !== "function") return { __text: "当前 Node 版本没有全局 fetch（需 Node 18+）" };
  const api = "https://minecraft.wiki/api.php";
  const limit = Math.min(12000, Math.max(500, a.limit || 4000));
  try {
    let title = a.page;
    if (!title) {
      const q = encodeURIComponent(String(a.query || ""));
      if (!q) return { __text: "传 query（搜索词）或 page（页面名）" };
      const sr = await (await fetch(`${api}?action=query&list=search&srsearch=${q}&format=json&srlimit=5`)).json();
      const hits = ((sr.query || {}).search || []).map((h) => h.title);
      if (!hits.length) return { __text: `Wiki 搜索「${a.query}」无结果——换英文关键词（如 'iron ingot'、'enchanting'）` };
      title = hits[0];
    }
    const raw = await (await fetch(`https://minecraft.wiki/w/${encodeURIComponent(title)}?action=raw`)).text();
    if (/^<!DOCTYPE/i.test(raw.trim())) return { __text: `页面「${title}」不存在（可先用 query 搜索）` };
    const clean = raw
      .replace(/\{\{[^{}]*\}\}/g, "")       // 去内联模板
      .replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>/g, "") // 去引用
      .replace(/\[\[([^|\]]*\|)?([^\]]*)\]\]/g, "$2")     // 链接留显示文本
      .replace(/\n{3,}/g, "\n\n");
    return { __text: `「${title}」（wikitext 节选 ${Math.min(limit, clean.length)}/${clean.length} 字符）\n\n${clean.slice(0, limit)}${clean.length > limit ? "\n…（截断）" : ""}` };
  } catch (e) {
    return { __text: `Wiki 查询失败: ${e.message}（检查网络；minecraft.wiki 需可直连）` };
  }
});

def("mc_attack", "攻击最近的匹配实体（如 zombie / skeleton / cow），可连击。", {
  type: "object",
  properties: {
    target: { type: "string", description: "实体名模糊匹配（留空 = 最近任意生物）" },
    times: { type: "integer", description: "攻击次数（默认 1）" },
  },
  required: [],
}, async (a) => {
  const b = await ensureBot();
  const want = (a.target || "").toLowerCase();
  const times = Math.min(10, Math.max(1, a.times || 1));
  const ents = Object.values(b.entities)
    .filter((e) => e !== b.entity && e.kind === "hostile" || (e.kind === "passive" && e.position))
    .filter((e) => e.position && e.position.distanceTo(b.entity.position) <= 4)
    .filter((e) => !want || (e.name || "").toLowerCase().includes(want) || (e.displayName || "").toLowerCase().includes(want))
    .sort((x, y) => x.position.distanceTo(b.entity.position) - y.position.distanceTo(b.entity.position));
  const target = ents[0];
  if (!target) return { __text: `4 格内没有${want ? `「${want}」` : "可攻击的实体"}` };
  for (let i = 0; i < times; i++) {
    await b.attack(target);
    await new Promise((r) => setTimeout(r, 500));
    if (!target.isValid) break;
  }
  return { __text: `攻击了 ${target.name || target.displayName} ${times} 次（${target.isValid ? "仍存活" : "已击倒"}）· 生命 ${b.health}/20` };
});

def("mc_eat", "吃背包里的食物恢复饥饿值。", { type: "object", properties: {} },
  async () => {
    const b = await ensureBot();
    const food = b.inventory.items().find((i) => /apple|bread|porkchop|beef|chicken|carrot|potato|berry|cooked/.test(i.name));
    if (!food) return { __text: `背包里没有食物（饥饿 ${b.food}/20）——先打猎或合成面包` };
    await b.equip(food, "hand");
    await b.consume();
    return { __text: `吃了 ${food.name}，饥饿 ${b.food}/20` };
  });

def("mc_chat", "在服务器聊天栏发消息。", {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
}, async (a) => {
  const b = await ensureBot();
  b.chat(String(a.text).slice(0, 256));
  return { __text: `已发言: ${a.text}` };
});

def("mc_inventory", "查看背包详细清单。", { type: "object", properties: {} },
  async () => {
    const b = await ensureBot();
    return { __text: `背包: ${invSummary(b)}\n持械 ${heldName(b)} · 生命 ${b.health}/20 · 饥饿 ${b.food}/20` };
  });

// ---------- stdio JSON-RPC 分发（与 computer-use 同协议骨架） ----------

const textResult = (t, isError) => ({ content: [{ type: "text", text: String(t) }], isError: !!isError });

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      return { id, result: { protocolVersion: params && params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "ycode-minecraft", version: "1.0.0" } } };
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
        const msgText = String(e.message || e);
        let guidance = "";
        if (/连接超时|连接失败/.test(msgText)) {
          guidance = "\n\n（连接不上服务器：检查 MC 是否开着、配置的 host:port 是否正确（mcp/config.json 或 MC_HOST/MC_PORT），离线服确认 MC_VERSION 匹配。修好后直接重试。）";
        } else if (/依赖未安装/.test(msgText)) {
          guidance = "\n\n（首次使用：在 plugins/minecraft 目录执行 npm install 装依赖。）";
        } else if (/超时/.test(msgText)) {
          guidance = "\n\n（可恢复失败：重试或拆小目标；卡住可先 mc_state 看当前位置。）";
        }
        return { id, result: textResult(msgText + guidance, true) };
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
    inflight += 1;
    handle(msg)
      .then((resp) => { if (resp) process.stdout.write(JSON.stringify(resp) + "\n"); })
      .catch((e) => process.stdout.write(JSON.stringify({ id: msg.id, error: { code: -32603, message: String(e && e.message || e) } }) + "\n"))
      .finally(() => { inflight -= 1; });
  }
});
// stdin 结束（宿主关闭管道）后等在途请求完成再退出——wiki 查询等网络
// 调用耗时数秒，立即退出会把响应杀在半路。
let inflight = 0;
process.stdin.on("end", () => {
  const wait = () => { if (inflight > 0) setTimeout(wait, 150); else process.exit(0); };
  wait();
});
