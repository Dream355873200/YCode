// browserctl.js 内置浏览器控制端点 —— browser-use 插件的壳侧执行层。
//
// 架构（对齐 ZCode desktop 的 WebContentsView + CDP 执行，按 YCode 规模裁剪）：
//   引擎 MCP server（mcp__browser__*）→ localhost HTTP（Bearer token）→ 本模块
//   → WebContentsView 实例池 + webContents.debugger（CDP）执行
//
// 实例池与驻留（tab residency）：
//   - 每个实例是独立 WebContentsView（guest 无 node、contextIsolation、独立持久分区）
//   - 活实例上限 MAX_LIVE：超限时把最久未用的非激活实例「挂起」——销毁渲染进程，
//     留壳记录（url/title/历史/console 尾巴）；激活时「恢复」重建并回到当前页
//   - 历史栈自管（did-navigate 记录），前进/后退跨挂起存活
//
// 安全：
//   - 仅 127.0.0.1，Bearer token（引擎经 FLAI_BROWSER_TOKEN 拿到，MCP 带上）
//   - 导航 scheme 白名单 http/https/about:blank（file: 等非 web scheme 拒绝）
//   - guest 会话权限请求默认拒绝；动作按实例串行化（队列）
const { app, ipcMain, WebContentsView } = require('electron');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_LIVE = 4;        // 活实例上限（超出挂起 LRU）
const MAX_HISTORY = 50;    // 每实例历史栈深度
const CONSOLE_TAIL = 60;   // 每实例 console 缓冲条数
const LOAD_TIMEOUT = 20_000;

const state = {
  port: 0,
  token: '',
  server: null,
  getWin: () => null,
  instances: new Map(), // id → inst（view=null 表示已挂起，壳记录仍在）
  activeId: null,
  panelRect: null,      // renderer 上报的浏览区矩形（窗口内容坐标）
};

// ---------- 实例 ----------

let seq = 0;

function instSummary(inst) {
  return {
    id: inst.id, url: inst.url, title: inst.title,
    active: inst.id === state.activeId,
    suspended: !inst.view,
    historyIndex: inst.historyIndex, historyLength: inst.history.length,
  };
}

function summary() {
  return {
    port: state.port, activeId: state.activeId,
    instances: [...state.instances.values()].map(instSummary),
  };
}

function emitChanged() {
  const win = state.getWin();
  if (win && !win.isDestroyed()) win.webContents.send('browser:changed', summary());
}

// 动作串行化：同一实例的动作排队执行，防并发调用交叉打点
function enqueue(inst, fn) {
  inst.queue = (inst.queue || Promise.resolve()).then(fn, fn);
  return inst.queue;
}

function createView() {
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:ycode-browser', // 登录态跨实例/跨会话持久
      autoplayPolicy: 'user-gesture-required',
    },
  });
  const wc = view.webContents;
  const session = wc.session;
  // guest 权限请求默认拒绝（地理位置/通知/媒体/剪贴板读等一律不授）
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  return view;
}

// 挂起：销毁渲染进程，留壳记录
function suspend(inst) {
  if (!inst.view) return;
  try {
    inst.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    inst.view.webContents.close();
  } catch { /* 已销毁 */ }
  inst.view = null;
  emitChanged();
}

// 恢复：重建 WebContentsView，接事件与 CDP，回到当前历史位
async function restore(inst) {
  if (inst.view) return;
  inst.view = createView();
  wireEvents(inst);
  await ensureDebugger(inst);
  const url = inst.history[inst.historyIndex] || inst.url || 'about:blank';
  if (url && url !== 'about:blank') {
    try { await inst.view.webContents.loadURL(url); } catch { /* 恢复失败不致命 */ }
  }
}

// 活实例数超限时挂起最久未用的非激活实例
async function evict() {
  const live = [...state.instances.values()].filter((i) => i.view);
  if (live.length <= MAX_LIVE) return;
  live.sort((a, b) => a.lastUsed - b.lastUsed);
  for (const cand of live) {
    if (cand.id !== state.activeId && cand.view) { suspend(cand); return; }
  }
}

function createInstance(url) {
  const id = `b${++seq}`;
  const inst = {
    id, view: null, url: '', title: '', console: [],
    history: [], historyIndex: -1,
    lastUsed: Date.now(), queue: Promise.resolve(), dbg: null,
    refs: null, // 最近一次快照的 ref → 坐标（点击解析）
  };
  state.instances.set(id, inst);
  // 同步建 view + 装事件（restore 异步加载不阻塞创建返回）
  inst.view = createView();
  wireEvents(inst);
  if (url) navigate(inst, url, { newTab: true }).catch(() => {});
  return inst;
}

function wireEvents(inst) {
  const wc = inst.view.webContents;
  const pushHistory = (url) => {
    if (!url || url.startsWith('devtools:')) return;
    inst.url = url;
    const cur = inst.history[inst.historyIndex];
    if (url === cur) return;
    inst.history = inst.history.slice(0, inst.historyIndex + 1);
    inst.history.push(url);
    if (inst.history.length > MAX_HISTORY) inst.history.shift();
    inst.historyIndex = inst.history.length - 1;
    emitChanged();
  };
  wc.on('did-navigate', (_e, url) => pushHistory(url));
  wc.on('did-navigate-in-page', (_e, url) => pushHistory(url));
  wc.on('page-title-updated', (_e, title) => { inst.title = title; emitChanged(); });
  wc.on('did-start-loading', () => emitChanged());
  wc.on('did-stop-loading', () => emitChanged());
  wc.setWindowOpenHandler(({ url }) => {
    // 新窗口 → 并入本实例历史（单页浏览器语义）
    navigate(inst, url).catch(() => {});
    return { action: 'deny' };
  });
}

// ---------- CDP（webContents.debugger） ----------

async function ensureDebugger(inst) {
  if (!inst.view) return null;
  const wc = inst.view.webContents;
  if (!inst.dbg) {
    inst.dbg = wc.debugger;
    inst.dbg.on('message', (_e, method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        const text = (params.args || []).map((a) => a.value !== undefined ? String(a.value) : a.description || a.type).join(' ');
        inst.console.push({ level: params.type || 'log', text: String(text).slice(0, 500), ts: Date.now() });
        if (inst.console.length > CONSOLE_TAIL) inst.console.shift();
      } else if (method === 'Runtime.exceptionThrown') {
        const d = params.exceptionDetails || {};
        inst.console.push({ level: 'error', text: String(d.text || d.exception?.description || 'exception').slice(0, 500), ts: Date.now() });
        if (inst.console.length > CONSOLE_TAIL) inst.console.shift();
      }
    });
    try { inst.dbg.attach('1.3'); } catch { /* 已附加 */ }
    try { inst.dbg.sendCommand('Runtime.enable'); inst.dbg.sendCommand('Page.enable'); } catch { /* */ }
  }
  return inst.dbg;
}

function cdp(inst, method, params) {
  return ensureDebugger(inst).then((dbg) => dbg.sendCommand(method, params || {}));
}

// 等待加载完成（loadEventFired 或超时）
function waitLoad(inst, timeout = LOAD_TIMEOUT) {
  if (!inst.view) return Promise.resolve();
  const wc = inst.view.webContents;
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => { wc.removeListener('did-stop-loading', done); resolve(); }, timeout);
    const done = () => { clearTimeout(t); wc.removeListener('did-stop-loading', done); resolve(); };
    wc.on('did-stop-loading', done);
  });
}

// ---------- 导航/动作 ----------

const SCHEME_OK = /^https?:$|^about:$/;

function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`URL 不合法: ${url}`); }
  if (!SCHEME_OK.test(u.protocol.replace(':', ''))) {
    throw new Error(`只允许 http/https/about:blank，拒绝 ${u.protocol}`);
  }
  return url;
}

async function navigate(inst, url, opts = {}) {
  checkUrl(url);
  inst.lastUsed = Date.now();
  await restore(inst); // 挂起态先恢复
  enqueue(inst, async () => {
    const wc = inst.view.webContents;
    if (opts.newTab) wc.loadURL(url); else await wc.loadURL(url).catch((e) => { throw new Error(`导航失败: ${e.message}`); });
    await waitLoad(inst);
    inst.url = wc.getURL();
    inst.title = wc.getTitle();
  });
  emitChanged();
  return { url: inst.url, title: inst.title };
}

// DOMSnapshot → 紧凑 ref 树（@e1 …），交互元素编号，bounds 存 inst.refs
async function snapshot(inst, max = 400) {
  inst.lastUsed = Date.now();
  await restore(inst);
  return enqueue(inst, async () => {
    const wc = inst.view.webContents;
    const title = wc.getTitle(); const url = wc.getURL();
    let snap;
    try {
      snap = await cdp(inst, 'DOMSnapshot.captureSnapshot', { computedStyles: [] });
    } catch (e) {
      throw new Error(`快照失败: ${e.message}`);
    }
    const S = snap.strings;
    const doc = snap.documents[0];
    const N = doc.nodes, L = doc.layout;
    const n = N.nodeName.length;
    const children = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) for (const c of N.childNodes[i] || []) children[i].push(c);
    const boundsOf = new Map(); // nodeIndex → [x,y,w,h]
    (L.nodeIndex || []).forEach((ni, k) => boundsOf.set(ni, [L.bounds[k * 4], L.bounds[k * 4 + 1], L.bounds[k * 4 + 2], L.bounds[k * 4 + 3]]));
    const INTERACTIVE = new Set(['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'option']);
    const refs = []; const lines = [];
    const walk = (i, depth, prefix) => {
      if (refs.length >= max || depth > 18) return;
      const tag = S[N.nodeName[i]] || '';
      if (tag === '#text' || tag === '#document' || tag === 'HTML') {
        for (const c of children[i]) walk(c, depth, prefix);
        return;
      }
      if (tag === 'HEAD' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'svg' || tag === 'path') return;
      const attrs = {};
      const A = N.attributes[i] || [];
      for (let k = 0; k + 1 < A.length; k += 2) attrs[S[A[k]]] = S[A[k + 1]];
      const b = boundsOf.get(i);
      const offscreen = !b || b[2] <= 0 || b[3] <= 0 || b[1] < -2000 || b[0] < -2000;
      const text = N.textValue[i] >= 0 ? S[N.textValue[i]] : '';
      const value = N.inputValue && N.inputValue[i] >= 0 ? S[N.inputValue[i]] : '';
      const ownText = (text || '').trim().slice(0, 80);
      const interactive = INTERACTIVE.has(tag.toLowerCase()) || attrs.role || attrs.onclick !== undefined ||
        attrs['aria-label'] || attrs.placeholder !== undefined || N.isClickable[i];
      const heading = /^h[1-4]$/i.test(tag);
      const img = tag.toLowerCase() === 'img' && (attrs.alt || attrs.src);
      let line = null;
      if (interactive || heading || img) {
        const ref = `@e${refs.length + 1}`;
        if (b && !offscreen) refs.push({ ref, x: b[0] + b[2] / 2, y: b[1] + b[3] / 2, w: b[2], h: b[3], tag, i });
        const bits = [`${prefix}${ref}`, `<${tag.toLowerCase()}>`];
        const label = attrs['aria-label'] || ownText || attrs.placeholder || attrs.alt || attrs.value || value || (img ? attrs.src?.slice(0, 60) : '');
        if (label) bits.push(`"${label.replace(/\s+/g, ' ').slice(0, 80)}"`);
        if (tag.toLowerCase() === 'a' && attrs.href) bits.push(`→ ${String(attrs.href).slice(0, 80)}`);
        if (tag.toLowerCase() === 'input' && attrs.type && attrs.type !== 'text') bits.push(`[type=${attrs.type}]`);
        if (offscreen) bits.push('(离屏)');
        line = bits.join(' ');
      }
      if (line) lines.push('  '.repeat(Math.min(depth, 8)) + line);
      for (const c of children[i]) walk(c, depth + 1, '');
    };
    walk(0, 0, '');
    inst.refs = refs;
    return {
      url, title,
      snapshot: [`页面: ${title}（${url}）`, `元素 ${refs.length} 个（交互元素按 @eN 编号，坐标随快照冻结；页面变化后必须重新快照）`, '', ...lines].join('\n'),
    };
  });
}

// ref → 坐标（只认最近一次快照，页面变化即失效）
function refPoint(inst, ref) {
  if (!inst.refs || !inst.refs.length) throw new Error('没有可用快照——先 browser_snapshot 获取 @eN 引用');
  const r = inst.refs.find((x) => x.ref === ref);
  if (!r) throw new Error(`${ref} 不在最近一次快照里——重新 browser_snapshot`);
  return r;
}

async function dispatchMouse(inst, type, x, y, extra = {}) {
  return cdp(inst, 'Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: extra.button || 'left', clickCount: extra.clickCount || 1, ...extra.wheel });
}

async function click(inst, { ref, x, y, button = 'left', clickCount = 1 }) {
  inst.lastUsed = Date.now();
  await restore(inst);
  let px = x, py = y;
  if (ref) { const r = refPoint(inst, ref); px = r.x; py = r.y; }
  if (px === undefined) throw new Error('需要 ref 或 {x,y}');
  return enqueue(inst, async () => {
    await dispatchMouse(inst, 'mouseMoved', px, py);
    await dispatchMouse(inst, 'mousePressed', px, py, { button, clickCount });
    await dispatchMouse(inst, 'mouseReleased', px, py, { button, clickCount });
    await waitLoad(inst, 8000);
    return { clicked: ref || { x: px, y: py } };
  });
}

async function type(inst, { ref, text, submit }) {
  inst.lastUsed = Date.now();
  await restore(inst);
  if (ref) await click(inst, { ref });
  return enqueue(inst, async () => {
    await cdp(inst, 'Input.insertText', { text });
    if (submit) {
      await cdp(inst, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await cdp(inst, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await waitLoad(inst);
    }
    return { typed: text.length, submit: !!submit };
  });
}

const KEYCODES = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32 };
async function key(inst, combo) {
  inst.lastUsed = Date.now();
  await restore(inst);
  return enqueue(inst, async () => {
    for (const k of String(combo).split('+')) {
      const name = k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
      const code = KEYCODES[name] ?? (name.length === 1 ? name.charCodeAt(0) : 0);
      const modifiers = /Control/i.test(combo) ? 2 : /Alt/i.test(combo) ? 4 : /Shift/i.test(combo) ? 8 : /Meta/i.test(combo) ? 4 : 0;
      await cdp(inst, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code: name.length === 1 ? `Key${name}` : name, windowsVirtualKeyCode: code, modifiers });
      await cdp(inst, 'Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name.length === 1 ? `Key${name}` : name, windowsVirtualKeyCode: code, modifiers });
    }
    await waitLoad(inst, 5000);
    return { key: combo };
  });
}

async function scroll(inst, { dx = 0, dy = 0, ref, x, y }) {
  inst.lastUsed = Date.now();
  await restore(inst);
  let px = x, py = y;
  if (ref) { const r = refPoint(inst, ref); px = r.x; py = r.y; }
  return enqueue(inst, async () => {
    // 未指定位置：滚视口中心（布局尺寸从 CDP 取，避免瞎猜坐标）
    if (px === undefined || py === undefined) {
      try {
        const m = await cdp(inst, 'Page.getLayoutMetrics');
        const vw = m.cssVisualViewport || m.contentSize || {};
        px = Math.round((vw.clientWidth || vw.width || 400) / 2);
        py = Math.round((vw.clientHeight || vw.height || 300) / 2);
      } catch { px = 400; py = 300; }
    }
    await cdp(inst, 'Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.round(px), y: Math.round(py),
      deltaX: Math.round(dx), deltaY: Math.round(dy),
    });
    return { scrolled: { dx, dy } };
  });
}

async function screenshot(inst, { fullPage } = {}) {
  inst.lastUsed = Date.now();
  await restore(inst);
  return enqueue(inst, async () => {
    const r = await cdp(inst, 'Page.captureScreenshot', { format: 'jpeg', quality: 60, captureBeyondViewport: !!fullPage });
    const b64 = r.data;
    const p = path.join(os.tmpdir(), 'ycode-cua', `browser-${Date.now()}.jpg`);
    try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(b64, 'base64')); } catch { /* 落盘失败不影响返回 */ }
    return { b64, path: p };
  });
}

// ---------- 控制端点 ----------

function getInst(id) {
  if (id === undefined || id === null || id === '') {
    id = state.activeId;
    if (!id) throw new Error('没有打开的浏览器实例——先 browser_new 或在右栏打开网页');
  }
  const inst = state.instances.get(id);
  if (!inst) throw new Error(`浏览器实例 ${id} 不存在（可能已关闭）——browser_list 查看现有实例`);
  return inst;
}

async function activate(id) {
  const inst = state.instances.get(id);
  if (!inst) throw new Error(`实例 ${id} 不存在`);
  const win = state.getWin();
  if (!win) throw new Error('主窗口未就绪');
  // 卸下当前激活实例
  const prev = state.instances.get(state.activeId);
  if (prev && prev.view) {
    try { win.contentView.removeChildView(prev.view); } catch { /* */ }
  }
  state.activeId = id;
  await restore(inst);
  inst.lastUsed = Date.now();
  if (inst.view && state.panelRect) {
    win.contentView.addChildView(inst.view);
    inst.view.setBounds(state.panelRect);
  }
  await evict();
  emitChanged();
  return instSummary(inst);
}

const routes = {
  'GET /browser/status': () => summary(),
  'POST /browser/new': async (b) => {
    const inst = createInstance(b.url ? checkUrl(b.url) : 'about:blank');
    await activate(inst.id);
    return instSummary(inst);
  },
  'POST /browser/close': (b) => {
    const inst = getInst(b.browser);
    if (inst.view && state.activeId === inst.id) {
      const win = state.getWin();
      try { win?.contentView.removeChildView(inst.view); } catch { /* */ }
    }
    if (inst.view) try { inst.view.webContents.close(); } catch { /* */ }
    state.instances.delete(inst.id);
    if (state.activeId === inst.id) {
      const next = [...state.instances.values()].filter((i) => i.view)[0];
      state.activeId = null;
      if (next) activate(next.id).catch(() => {});
    }
    emitChanged();
    return { closed: inst.id };
  },
  'POST /browser/activate': (b) => activate(getInst(b.browser).id),
  'POST /browser/navigate': async (b) => {
    if (!b.url) throw new Error('缺少 url');
    return navigate(getInst(b.browser), b.url);
  },
  'POST /browser/back': async (b) => {
    const inst = getInst(b.browser);
    if (inst.historyIndex <= 0) throw new Error('没有上一页');
    inst.historyIndex--;
    return navigate(inst, inst.history[inst.historyIndex]);
  },
  'POST /browser/forward': async (b) => {
    const inst = getInst(b.browser);
    if (inst.historyIndex >= inst.history.length - 1) throw new Error('没有下一页');
    inst.historyIndex++;
    return navigate(inst, inst.history[inst.historyIndex]);
  },
  'POST /browser/reload': async (b) => {
    const inst = getInst(b.browser);
    await restore(inst);
    enqueue(inst, async () => { inst.view.webContents.reload(); await waitLoad(inst); });
    return { reloaded: inst.url };
  },
  'POST /browser/snapshot': (b) => snapshot(getInst(b.browser), b.max || 400),
  'POST /browser/click': (b) => click(getInst(b.browser), b),
  'POST /browser/type': (b) => type(getInst(b.browser), b),
  'POST /browser/key': (b) => key(getInst(b.browser), b.key),
  'POST /browser/scroll': (b) => scroll(getInst(b.browser), b),
  'POST /browser/screenshot': (b) => screenshot(getInst(b.browser), b),
  'POST /browser/console': (b) => {
    const inst = getInst(b.browser);
    return { url: inst.url, messages: inst.console.slice(-50) };
  },
  'POST /browser/evaluate': (b) => {
    const inst = getInst(b.browser);
    inst.lastUsed = Date.now();
    return restore(inst).then(() => enqueue(inst, async () => {
      const r = await cdp(inst, 'Runtime.evaluate', { expression: b.expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(`执行异常: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`);
      return { result: r.result?.value !== undefined ? r.result.value : r.result?.description };
    }));
  },
};

function handle(req, res) {
  const auth = req.headers.authorization || '';
  if (!state.token || auth !== `Bearer ${state.token}`) {
    res.writeHead(401).end('unauthorized');
    return;
  }
  const key = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
  const route = routes[key];
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (!route) { res.writeHead(404).end(`no route: ${key}`); return; }
    let b = {};
    try { b = body ? JSON.parse(body) : {}; } catch { res.writeHead(400).end('bad json'); return; }
    Promise.resolve()
      .then(() => route(b))
      .then((data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); })
      .catch((e) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })); });
  });
}

// ---------- 面板 IPC（右栏浏览器 UI） ----------

function registerIpc() {
  ipcMain.handle('browser:list', () => summary());
  ipcMain.handle('browser:open', (_e, url) => {
    const u = url || 'about:blank';
    const inst = createInstance(checkUrl(u));
    return activate(inst.id);
  });
  ipcMain.handle('browser:activate', (_e, id) => activate(id));
  ipcMain.handle('browser:back', (_e, id) => routes['POST /browser/back']({ browser: id }));
  ipcMain.handle('browser:forward', (_e, id) => routes['POST /browser/forward']({ browser: id }));
  ipcMain.handle('browser:reload', (_e, id) => routes['POST /browser/reload']({ browser: id }));
  ipcMain.handle('browser:close', (_e, id) => routes['POST /browser/close']({ browser: id }));
  ipcMain.handle('browser:rect', (_e, rect) => {
    state.panelRect = rect;
    const win = state.getWin();
    const inst = state.instances.get(state.activeId);
    if (inst && inst.view && win && !win.isDestroyed()) {
      if (!win.contentView.children?.includes(inst.view)) win.contentView.addChildView(inst.view);
      inst.view.setBounds(rect);
    }
    return true;
  });
}

// ---------- 生命周期 ----------

function start({ getWin }) {
  state.getWin = getWin;
  state.token = crypto.randomBytes(24).toString('hex');
  registerIpc();
  return new Promise((resolve) => {
    state.server = http.createServer(handle);
    state.server.on('error', () => resolve({})); // 端口失败：工具层给出「端点不可达」提示
    state.server.listen(0, '127.0.0.1', () => {
      state.port = state.server.address().port;
      resolve({ FLAI_BROWSER_PORT: String(state.port), FLAI_BROWSER_TOKEN: state.token });
    });
  });
}

function stop() {
  for (const inst of state.instances.values()) {
    if (inst.view) { try { inst.view.webContents.close(); } catch { /* */ } }
  }
  state.instances.clear();
  if (state.server) state.server.close();
}

// 引擎子进程环境注入（FLAI_BROWSER_PORT/FLAI_BROWSER_TOKEN）；未启动时空对象
function env() {
  return state.port ? { FLAI_BROWSER_PORT: String(state.port), FLAI_BROWSER_TOKEN: state.token } : {};
}

module.exports = { start, stop, env, state };
