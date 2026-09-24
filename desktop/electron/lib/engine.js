// HTTP 帮助 + 引擎子进程生命周期 + SSE 桥（主进程内直连引擎，无 CORS）
const { spawn } = require('child_process');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const os = require('os');
// goagent 协议 TS 客户端：SSE 解析/统一信封/交互回传全部走 SDK，不再手写
const { GoAgentClient } = require('goagent-client');

const state = {
  proc: null,
  addr: 'http://127.0.0.1:8420',
  status: 'stopped', // stopped | starting | running | error
  win: null,         // 广播状态用的 BrowserWindow 引用（由 main.js 注入）
  client: null,      // GoAgentClient 懒初始化（addr 变化时重建）
};

function setWin(w) { state.win = w; }

function setStatus(s, extra) {
  state.status = s;
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send('engine:status', {
    status: s, addr: state.addr, ...extra,
  });
}

// 连接拒绝 = 引擎未就绪（启动/重启窗口期），属预期状态
function isConnRefused(err) {
  return err && (err.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(err.message || '')));
}

function httpJSON(method, addr, apiPath, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(apiPath, `http://${addr}`);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function probeEngine(addr) {
  return httpJSON('GET', addr, '/health').then((r) => r.status === 200).catch(() => false);
}

// sessionMapPath 会话绑定文件（引擎按会话解析项目目录与模式的真源）。
// 引擎侧 WithSessionWorkDir / 会话级能力解析器读它——切项目只是换
// session_id，切模式只是改绑定，引擎进程不重启（多项目、多模式并行）。
function sessionMapPath() {
  return path.join(os.homedir(), '.amobilecreater', 'session-map.json');
}

// bindSession 登记会话绑定 {dir, mode} 并即时写盘（引擎 mtime 缓存会自动重读）。
// mode 省略时保留该会话已有的模式（旧格式字符串条目视为无模式 → 引擎取默认）。
function bindSession(sessionId, projectDir, mode) {
  if (!sessionId || !projectDir) return false;
  const file = sessionMapPath();
  let map = {};
  try { map = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { /* 首次/损坏：重建 */ }
  const prev = map[sessionId];
  const keepMode = prev && typeof prev === 'object' ? prev.mode : undefined;
  const nextMode = mode || keepMode;
  map[sessionId] = nextMode ? { dir: projectDir, mode: nextMode } : { dir: projectDir };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(map, null, 2));
    return true;
  } catch {
    return false;
  }
}

async function ensure(cfg) {
  // 引擎是单例常驻进程：多项目并行靠 session→项目映射（session-map.json），
  // 不再按项目重启。已在跑（含用户手动先启动的）直接复用。
  try {
    if (await probeEngine(cfg.engine.addr)) {
      setStatus('running', { reused: true });
      return true;
    }
  } catch { /* 未运行，继续拉起 */ }

  if (state.proc) { state.proc.kill(); state.proc = null; }

  if (!fs.existsSync(cfg.engine.binary)) {
    setStatus('error', { message: `引擎不存在: ${cfg.engine.binary}` });
    return false;
  }
  setStatus('starting');
  const env = {
    ...process.env,
    FLAI_MODEL: cfg.engine.model,
    FLAI_BASE_URL: cfg.engine.baseUrl,
    FLAI_API_KEY: cfg.engine.apiKey,
    FLAI_CONTEXT_WINDOW: String(cfg.engine.contextWindow),
  };
  // 最大输出（推理模型的 reasoning 也占此额度）；未配置走引擎缺省 393216
  if (cfg.engine.maxOutputTokens) env.FLAI_MAX_OUTPUT_TOKENS = String(cfg.engine.maxOutputTokens);
  // --mode 是引擎的默认模式（未绑定模式的会话使用）；引擎一次加载全部
  // 模式，会话实际模式由 session-map.json 的绑定决定。未配置时不传参。
  const args = ['--addr', cfg.engine.addr];
  if (cfg.engine.mode) args.push('--mode', cfg.engine.mode);
  state.proc = spawn(cfg.engine.binary, args, {
    env, windowsHide: true,
  });
  state.proc.stdout.on('data', () => {});
  state.proc.stderr.on('data', () => {});
  state.proc.on('exit', (code) => {
    state.proc = null;
    if (state.status !== 'stopped') setStatus('stopped', { exitCode: code });
  });

  // 轮询健康检查（最多 30s）
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await probeEngine(cfg.engine.addr)) {
      setStatus('running', { spawned: true });
      return true;
    }
  }
  setStatus('error', { message: '引擎启动超时' });
  return false;
}

// SSE 桥：经 goagent-client SDK 消费 /chat 流（统一信封），逐事件转发 renderer。
// 首帧恒为 run_start（sse:begin 语义沿用——renderer 以首帧绑定会话）。
// 每流独立状态：begin 标记与 session 归属都是流内变量，多会话并行流互不串扰；
// sse:done / sse:error 携带该流的 session_id，renderer 按会话收尾（不再依赖
// 「最近活跃会话」猜测，避免并行流先结束的一方误关别家的轮次）。
function client() {
  if (!state.client || state.client.baseUrl !== state.addr) {
    state.client = new GoAgentClient(state.addr);
  }
  return state.client;
}

function send(channel, payload) {
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send(channel, payload);
}

async function streamChat({ message, sessionId }) {
  let sid = sessionId || '';
  let first = true;
  try {
    for await (const evt of client().chat({ message, sessionId })) {
      if (evt && evt.session_id) sid = evt.session_id;
      if (first) { send('sse:begin', evt); first = false; }
      send('sse:event', evt);
    }
    send('sse:done', { session_id: sid });
  } catch (e) {
    send('sse:error', { session_id: sid, error: String(e && e.message || e) });
    throw e;
  }
}

function kill() {
  if (state.proc) state.proc.kill();
}

module.exports = {
  state, setWin, ensure, kill, streamChat, httpJSON, isConnRefused, bindSession,
};
