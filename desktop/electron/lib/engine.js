// HTTP 帮助 + 引擎子进程生命周期 + SSE 桥（主进程内直连引擎，无 CORS）
const { spawn } = require('child_process');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');

const state = {
  proc: null,
  addr: 'http://127.0.0.1:8420',
  status: 'stopped', // stopped | starting | running | error
  projectDir: '',    // 引擎绑定的项目目录（cwd 决定文件工具工作区）
  win: null,         // 广播状态用的 BrowserWindow 引用（由 main.js 注入）
};

function setWin(w) { state.win = w; }

function setStatus(s, extra) {
  state.status = s;
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send('engine:status', {
    status: s, addr: state.addr, projectDir: state.projectDir, ...extra,
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

async function ensure(cfg, projectDir) {
  const wantDir = projectDir || '';
  try {
    if (await probeEngine(cfg.engine.addr)) {
      if (!wantDir || !state.projectDir || state.projectDir === wantDir || state.proc === null) {
        if (!(!state.projectDir && wantDir)) {
          // 无新目录要求，或引擎本来就是本壳拉起的（cwd 已对）→ 复用
          setStatus('running', { reused: true });
          return true;
        }
      }
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
  // cwd = 项目目录：Read/Glob/Write 等文件工具都在项目内工作
  if (wantDir && fs.existsSync(wantDir)) state.projectDir = wantDir;
  state.proc = spawn(cfg.engine.binary, ['--addr', cfg.engine.addr], {
    env, windowsHide: true,
    cwd: state.projectDir || undefined,
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

// SSE 桥：POST /chat 流式读出，逐事件转发 renderer
async function streamChat({ message, sessionId }) {
  const u = new URL('/chat', state.addr);
  const payload = JSON.stringify({ message, session_id: sessionId || undefined });
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let buf = '';
        let firstEvent = true;
        res.on('data', (chunk) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith('data: ')) continue;
            let evt;
            try { evt = JSON.parse(line.slice(6)); } catch { continue; }
            if (firstEvent && state.win) { state.win.webContents.send('sse:begin', evt); firstEvent = false; }
            if (state.win && !state.win.isDestroyed()) state.win.webContents.send('sse:event', evt);
          }
        });
        res.on('end', () => { if (state.win && !state.win.isDestroyed()) state.win.webContents.send('sse:done'); resolve(); });
        res.on('error', (e) => { if (state.win && !state.win.isDestroyed()) state.win.webContents.send('sse:error', String(e)); reject(e); });
      }
    );
    req.on('error', reject);
    req.setTimeout(30 * 60_000, () => req.destroy(new Error('chat timeout')));
    req.write(payload);
    req.end();
  });
}

function kill() {
  if (state.proc) state.proc.kill();
}

module.exports = {
  state, setWin, ensure, kill, streamChat, httpJSON, isConnRefused,
};
