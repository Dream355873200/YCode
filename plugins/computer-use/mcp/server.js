#!/usr/bin/env node
// computer-use MCP server（stdio，零依赖）——YCode 版 Computer Use。
//
// 工具面复刻 ZCode CUA 的低层语义（list_apps / get_app_state / left_click /
// type / key / scroll / paste / set_value …），Windows 实现走 PowerShell：
// UI Automation（语义树）+ SendInput（鼠标键盘）+ GDI（截图），不引任何
// npm 依赖、不带原生模块。工具名注册为 mcp__computer__<name>。
//
// 关键语义（与 ZCode 对齐）：
//   - 辅助功能优先：get_app_state 返回带 [index] 的语义树，按索引操作
//   - 索引 fail-closed：动作前重新枚举元素树，目标元素消失/变化即拒绝
//     （STALE_STATE），不按旧坐标盲点
//   - 截图以 [IMAGE jpeg <b64>] 前缀内联返回，provider 转多模态消息
"use strict";
const { spawn } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

// ---------- 平台后端选择 ----------
//
// 后端契约（backends/<platform>/ 下同名脚本，JSON 输入 -Payload / JSON 输出）：
//   list_apps.ps1  {mode?} → {apps:[{hwnd,pid,name,title,foreground,minimized}]} | {windows:[…]}
//   state.ps1      {app,max} → {hwnd,pid,title,truncated,elements:[{i,t,n,v,rt,b,cx,cy,off}]}
//   screenshot.ps1 {hwnd?} → {b64,w,h,path}（JPEG）
//   input.ps1      {action,x,y,button,click,modifiers,direction,amount,text,repeat,hold,runtime_id,expect,to_x,to_y}
//   value.ps1      {hwnd,runtime_id,expect_i,value}
//   open_app.ps1   {name} → {ok,name,pid,hwnd,title}
// 错误统一 {__error:"<错误码>: <说明>"}。新增平台 = 加一个目录实现同契约，
// server 与技能/规范零改动。非当前平台调用统一报 PLATFORM_NOT_SUPPORTED。
const PLATFORM = { win32: "win32", darwin: "darwin", linux: "linux" }[process.platform] || "";
const PS_DIR = path.join(__dirname, "backends", PLATFORM || "win32");
const SHOT_DIR = path.join(os.tmpdir(), "ycode-cua");
if (process.platform === "win32") { try { fs.mkdirSync(SHOT_DIR, { recursive: true }); } catch {} }

// ---------- PowerShell 桥 ----------

function ps(script, payload, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    if (process.platform !== "win32") {
      return reject(new Error(`PLATFORM_NOT_SUPPORTED: 电脑控制后端目前实现了 win32（UIA / SendInput / GDI），当前平台 ${process.platform} 尚无后端——按 mcp/backends 契约可自行实现`));
    }
    const file = path.join(PS_DIR, script);
    const child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass",
      "-File", file,
    ], { windowsHide: true });
    // 载荷走 stdin（argv 传 JSON 会被 PowerShell 把 {} 当空 scriptblock 吞掉）
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
    let out = "", err = "", done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; child.kill(); reject(new Error(`执行超时（${timeoutMs / 1000}s）: ${script}`)); }
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    child.on("close", (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      const lines = out.split(/\r?\n/).filter((l) => l.startsWith("{"));
      if (lines.length) {
        try {
          const obj = JSON.parse(lines[lines.length - 1]);
          if (obj.__error) return reject(new Error(obj.__error));
          return resolve(obj);
        } catch { /* fallthrough */ }
      }
      reject(new Error(`PowerShell 退出码 ${code}: ${(err || out || "(无输出)").trim().slice(0, 500)}`));
    });
  });
}

// ---------- 应用/元素状态缓存（索引 fail-closed 的依据） ----------

// lastState[appKey] = { pid, hwnd, title, elements:[{i,t,n,v,b,rt,cx,cy}] }
// get_app_state 时刷新；动作按 index 取缓存元素 → ps 侧重枚举并按 runtimeId
// 复核（元素仍在且身份一致才下发动作），消失/错位返回 STALE 错误。
const lastState = new Map();

function appKey(appRef) {
  if (!appRef) return "foreground";
  if (appRef.hwnd) return `hwnd:${appRef.hwnd}`;
  if (appRef.pid) return `pid:${appRef.pid}`;
  return `name:${String(appRef.name || "").toLowerCase()}`;
}

function cachedState(appRef) {
  const st = lastState.get(appKey(appRef));
  if (!st) throw new Error("没有已观察的元素状态——先调用 get_app_state 再按索引操作");
  return st;
}

function resolveTarget(appRef, target) {
  const st = cachedState(appRef);
  const el = st.elements.find((e) => e.i === target);
  if (!el) throw new Error(`元素 [${target}] 不在最近一次观察结果里——重新 get_app_state 获取当前索引`);
  return { state: st, el };
}

// ---------- 工具定义 ----------

const tools = [];
const def = (name, description, inputSchema, handler) =>
  tools.push({ name, description, inputSchema, handler });

const AppRef = {
  type: "object",
  properties: {
    name: { type: "string", description: "应用显示名（进程名或窗口标题包含即可，用户怎么报就怎么写）" },
    pid: { type: "integer", description: "进程 ID" },
    hwnd: { type: "integer", description: "窗口句柄（list_windows 返回）" },
  },
  description: "目标应用；省略 = 当前前台窗口",
};

def("list_apps", "列出当前可见的桌面应用窗口（pid / 进程名 / 窗口标题 / 是否前台）。用于解析用户口中的应用名，或确认应用在跑。", { type: "object", properties: {} },
  async () => ps("list_apps.ps1", {}));

def("list_windows", "列出某个应用的全部顶层窗口（hwnd / 标题 / 是否前台）。弹窗找不到时用它。", {
  type: "object", properties: { app_ref: AppRef }, required: [],
}, async (a) => ps("list_apps.ps1", { mode: "windows", app: a.app_ref || {} }));

def("open_app", "打开一个应用（Start 菜单名、可执行文件名或完整路径）。成功返回新窗口信息；打开后用 get_app_state 观察它。", {
  type: "object",
  properties: { name: { type: "string", description: "应用名（如 记事本 / notepad / 计算器）或 exe / 路径" } },
  required: ["name"],
}, async (a) => {
  const r = await ps("open_app.ps1", { name: a.name }, 45_000);
  return { __text: `已启动: ${r.name} (pid ${r.pid}${r.hwnd ? `, hwnd ${r.hwnd}` : ""})——用 get_app_state 观察它` };
});

def("get_app_state", "读取目标应用的 UI 语义元素树（辅助功能树）：每个元素带 [index]、类型、名称、值、是否离屏。动作前必看；按索引操作元素。include_screenshot 时附带当前画面截图。", {
  type: "object",
  properties: {
    app_ref: AppRef,
    include_screenshot: { type: "boolean", description: "附带截图（默认 false）" },
    max_elements: { type: "integer", description: "元素数量上限（默认 250，超限截断并提示）" },
  },
  required: [],
}, async (a) => {
  const r = await ps("state.ps1", { app: a.app_ref || {}, max: a.max_elements || 400 }, 120_000);
  const key = a.app_ref && a.app_ref.hwnd ? `hwnd:${a.app_ref.hwnd}`
    : a.app_ref && a.app_ref.pid ? `pid:${a.app_ref.pid}`
    : `hwnd:${r.hwnd}`;
  lastState.set(key, r);
  lastState.set("foreground", r);
  const lines = [
    `窗口: ${r.title} (pid ${r.pid}, hwnd ${r.hwnd})${r.truncated ? ` —— 元素过多已截断到 ${r.elements.length} 个，可用 max_elements 提高` : ""}`,
    "",
    ...r.elements.map((e) => {
      const bits = [`[${e.i}]`, e.t];
      if (e.a && e.a.length) bits.push(`(${e.a.join(",")})`);
      if (e.n) bits.push(`"${e.n.length > 80 ? e.n.slice(0, 80) + "…" : e.n}"`);
      if (e.v !== null && e.v !== undefined && e.v !== "") bits.push(`值=${e.v.length > 60 ? e.v.slice(0, 60) + "…" : e.v}`);
      if (e.off) bits.push("(离屏)");
      return bits.join(" ");
    }),
  ];
  let text = lines.join("\n");
  if (a.include_screenshot) {
    const shot = await ps("screenshot.ps1", { hwnd: r.hwnd }, 60_000);
    if (shot.b64 && shot.b64.length >= 100) {
      text = `[IMAGE jpeg ${shot.b64}]\n` + text + `\n（附图: ${shot.path} ${shot.w}x${shot.h}）`;
    } else {
      text += "\n（附图失败：画面数据为空，可单独调用 screenshot 重试）";
    }
  }
  return { __text: text };
});

def("screenshot", "截取当前屏幕或指定应用窗口，返回内联图片。用于视觉判断（布局/颜色/自绘界面）；元素操作优先 get_app_state。", {
  type: "object",
  properties: { app_ref: AppRef },
  required: [],
}, async (a) => {
  const r = await ps("screenshot.ps1", { hwnd: a.app_ref && a.app_ref.hwnd }, 60_000);
  return { __image: r };
});

def("left_click", "点击目标：优先元素索引（最近一次 get_app_state 的 [index]），坐标是最后手段。支持按键修饰与双击/右键。", {
  type: "object",
  properties: {
    target: { description: "元素索引（number）或 {x,y} 屏幕坐标", oneOf: [{ type: "integer" }, { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } }, required: ["x", "y"] }] },
    mouse_button: { type: "string", enum: ["left", "right", "middle"], description: "默认 left" },
    click_count: { type: "integer", description: "默认 1，双击传 2" },
    modifiers: { type: "string", description: "修饰键，如 ctrl / ctrl+shift" },
  },
  required: ["target"],
}, (a) => act("click", a));

def("left_click_drag", "从 from_target 按住左键拖到 to（索引或坐标）。", {
  type: "object",
  properties: {
    from_target: { oneOf: [{ type: "integer" }, { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } }, required: ["x", "y"] }] },
    to: { oneOf: [{ type: "integer" }, { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } }, required: ["x", "y"] }] },
    modifiers: { type: "string" },
  },
  required: ["from_target", "to"],
}, (a) => act("drag", a));

def("scroll", "在目标（索引或坐标）处滚动。scroll_direction: up/down/left/right；scroll_amount 单位是页（1 页 ≈ 3 滚轮格）。", {
  type: "object",
  properties: {
    target: { oneOf: [{ type: "integer" }, { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } }, required: ["x", "y"] }] },
    scroll_direction: { type: "string", enum: ["up", "down", "left", "right"] },
    scroll_amount: { type: "integer", description: "默认 1" },
  },
  required: ["target", "scroll_direction"],
}, (a) => act("scroll", a));

def("type", "输入文本：给了 target（索引）就先点该元素获得焦点再输入；没给就在当前焦点输入。支持中文（Unicode SendInput）。", {
  type: "object",
  properties: {
    text: { type: "string" },
    target: { oneOf: [{ type: "integer" }, { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" } }, required: ["x", "y"] }] },
  },
  required: ["text"],
}, (a) => act("type", a));

def("key", "按键或组合键（+ 连接），如 Return / Tab / ctrl+s / alt+F4 / ctrl+shift+esc。repeat 重复次数。", {
  type: "object",
  properties: {
    text: { type: "string" },
    repeat: { type: "integer", description: "默认 1" },
    hold_seconds: { type: "number", description: "按住秒数（默认瞬间）" },
  },
  required: ["text"],
}, async (a) => {
  await ps("input.ps1", { action: "key", text: a.text, repeat: a.repeat || 1, hold: a.hold_seconds || 0 });
  return { __text: `已按键: ${a.text}${a.repeat > 1 ? ` ×${a.repeat}` : ""}——观察确认结果` };
});

def("paste", "把文本放进剪贴板并在当前焦点粘贴（ctrl+v）。富文本或不支持 setValue 的目标用它；纯文本优先 type / set_value。", {
  type: "object",
  properties: { text: { type: "string" } },
  required: ["text"],
}, async (a) => {
  await ps("input.ps1", { action: "paste", text: a.text });
  return { __text: "已粘贴到当前焦点——观察确认结果" };
});

def("set_value", "用辅助功能 ValuePattern 直接设置可设置元素的值（比点击+输入快且稳）。元素不支持时报 NOT_SETTABLE。", {
  type: "object",
  properties: {
    target: { type: "integer", description: "元素索引" },
    value: { type: "string" },
  },
  required: ["target", "value"],
}, async (a) => {
  const { state, el } = resolveTarget(undefined, a.target);
  const r = await ps("value.ps1", { hwnd: state.hwnd, runtime_id: el.rt, expect_i: el.i, expect: { i: el.i, t: el.t, n: el.n || "" }, value: a.value }, 120_000);
  return { __text: `已设置 [${a.target}] "${el.n || el.t}" = ${a.value}——观察确认结果` };
});

// 索引目标 → 重新枚举元素树，按 runtimeId 复核身份后取当前坐标下发；
// 坐标目标原样透传。所有带 target 的动作收口在这里（fail-closed）。
async function act(action, a) {
  const payload = { action };
  if (a.modifiers) payload.modifiers = a.modifiers;
  if (action === "click") { payload.button = a.mouse_button || "left"; payload.click = a.click_count || 1; }
  if (action === "scroll") { payload.direction = a.scroll_direction; payload.amount = a.scroll_amount || 1; }
  if (action === "type") payload.text = a.text;

  const coordOf = (t) => (typeof t === "object" && t ? { x: t.x, y: t.y } : null);

  if (action === "type" && a.target === undefined) {
    // 无目标输入：当前焦点
    await ps("input.ps1", payload);
    return { __text: "已在当前焦点输入——观察确认结果" };
  }
  if (action === "paste") { /* 上面已单独处理 */ }

  const t = action === "drag" ? a.from_target : a.target;
  const c = coordOf(t);
  if (c) {
    payload.x = c.x; payload.y = c.y;
    if (action === "drag") {
      const to = coordOf(a.to);
      if (!to) { const { state, el } = resolveTarget(undefined, a.to); payload.to_x = el.cx; payload.to_y = el.cy; }
      else { payload.to_x = to.x; payload.to_y = to.y; }
    }
  } else {
    const { state, el } = resolveTarget(undefined, t);
    payload.hwnd = state.hwnd;
    payload.runtime_id = el.rt;
    payload.expect = { i: el.i, t: el.t, n: el.n || "" };
    if (action === "drag") {
      const to = coordOf(a.to);
      if (!to) { const s2 = resolveTarget(undefined, a.to); payload.to_x = s2.el.cx; payload.to_y = s2.el.cy; }
      else { payload.to_x = to.x; payload.to_y = to.y; }
    }
  }
  await ps("input.ps1", payload, 150_000);
  return { __text: `已执行 ${action}${a.click_count === 2 ? "（双击）" : ""}${a.mouse_button && a.mouse_button !== "left" ? `（${a.mouse_button}）` : ""}——观察确认结果` };
}

// ---------- MCP stdio ----------

const SERVER_INFO = { name: "ycode-computer-use", version: "0.1.0" };

function toolSchemas() {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // notification
  try {
    if (method === "initialize") {
      return { id, result: { protocolVersion: params.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: SERVER_INFO } };
    }
    if (method === "tools/list") return { id, result: { tools: toolSchemas() } };
    if (method === "tools/call") {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return { id, result: textResult(`未知工具: ${params.name}`, true) };
      try {
        const r = await tool.handler(params.arguments || {});
        if (r && r.__image) {
          // [IMAGE jpeg <b64>] 前缀：provider 把工具结果转成多模态消息（与 vision_ask 同通道）。
          // 防御：b64 缺失/过短说明截屏失败，绝不发出毒标记（会永久卡死会话）。
          const img = r.__image;
          if (!img.b64 || img.b64.length < 100) {
            return { id, result: textResult("截图失败：画面数据为空——检查窗口是否最小化", true) };
          }
          return { id, result: textResult(`[IMAGE jpeg ${img.b64}]\n截图 ${img.w}x${img.h}: ${img.path}（画面已附上）`) };
        }
        if (r && r.__text !== undefined) return { id, result: textResult(r.__text) };
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
