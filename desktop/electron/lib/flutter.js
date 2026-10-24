// flutter run --machine：把 Flutter 应用部署到设备并保持热重载通道。
// 协议见 flutter_tools/doc/daemon.md：每行一个方括号包裹的 JSON 数组；
// 事件 { event, params }、请求 { id, method, params }、回执 { id, result | error }。
//   app.start{appId} → app.started → app.log{log,error?} / app.progress{id,message?,finished?} → app.stop
//   请求：app.restart{appId, fullRestart}（热重载 / 热重启）、app.stop{appId}
// 发给渲染层的事件都带 runId：同一项目先停后启时，旧进程迟到的退出事件不会误伤新运行。
const { spawn, execFile } = require('child_process');
const readline = require('readline');
const { flutterBin } = require('./tools');

const LOG_TAIL = 80;
const REQUEST_TIMEOUT_MS = 90_000;
const DEVICE_ID_RE = /^[\w.:-]{1,128}$/;

const state = {
  win: null,
  seq: 0,
  runs: new Map(), // projectDir → run
  last: new Map(), // projectDir → 最近一次已结束运行的 { runId, code, error, log }
};

function setWin(w) { state.win = w; }

function send(evt, projectDir, run, extra) {
  if (state.win && !state.win.isDestroyed()) {
    state.win.webContents.send('flutter:evt', { evt, projectDir, runId: run.id, ...extra });
  }
}

function pushLog(projectDir, run, text, level = 'info') {
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const t = line.replace(/\s+$/, '');
    if (!t) continue;
    run.log.push({ level, text: t });
    send('log', projectDir, run, { level, text: t });
  }
  if (run.log.length > LOG_TAIL) run.log.splice(0, run.log.length - LOG_TAIL);
}

function setStatus(projectDir, run, status, extra) {
  run.status = status;
  send('status', projectDir, run, { status, deviceId: run.deviceId, ...extra });
}

function alive(proc) { return proc.exitCode === null && proc.signalCode === null; }

// flutter 是 .bat 包装：Windows 上经 shell 启动，结束时按进程树杀（只杀 cmd.exe 会留下 dart 进程）。
function killTree(proc) {
  if (!alive(proc)) return;
  if (process.platform === 'win32') execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else try { proc.kill(); } catch { /* 已退出 */ }
}

function write(run, msg) {
  try { run.proc.stdin.write(`[${JSON.stringify(msg)}]\n`); return true; } catch { return false; }
}

function onMessage(projectDir, run, m) {
  if (!m || typeof m !== 'object') return;
  if (m.event === undefined && m.id !== undefined) {
    const done = run.pending.get(m.id);
    if (done) { run.pending.delete(m.id); done(m.error !== undefined ? { error: String(m.error) } : { result: m.result }); }
    return;
  }
  const p = m.params || {};
  switch (m.event) {
    case 'app.start': run.appId = p.appId || null; break;
    case 'app.started': setStatus(projectDir, run, 'running'); break;
    case 'app.log': pushLog(projectDir, run, p.log, p.error ? 'error' : 'info'); break;
    case 'app.progress': if (p.message) pushLog(projectDir, run, p.message, 'progress'); break;
    case 'daemon.logMessage': pushLog(projectDir, run, p.message, p.level === 'error' ? 'error' : 'info'); break;
    case 'app.stop': run.appId = null; break;
    default: break;
  }
}

function onLine(projectDir, run, line) {
  const t = line.trim();
  if (!t) return;
  if (!t.startsWith('[')) { pushLog(projectDir, run, t); return; }
  let msgs;
  try { msgs = JSON.parse(t); } catch { pushLog(projectDir, run, t); return; }
  for (const m of Array.isArray(msgs) ? msgs : [msgs]) onMessage(projectDir, run, m);
}

// 启动 flutter run -d <deviceId> --machine（每个项目一个运行，重复启动先停旧的）
function start({ projectDir, deviceId }) {
  if (!projectDir || !deviceId) return { ok: false, error: '缺少项目目录或设备' };
  if (!DEVICE_ID_RE.test(deviceId)) return { ok: false, error: '设备 ID 不合法' };
  stop(projectDir);
  const bin = flutterBin();
  const viaShell = process.platform === 'win32';
  let proc;
  try {
    proc = spawn(viaShell ? `"${bin}"` : bin, ['run', '--machine', '-d', deviceId], {
      cwd: projectDir, windowsHide: true, shell: viaShell,
    });
  } catch (err) {
    return { ok: false, error: `启动 flutter 失败：${err.message || err}` };
  }
  const run = {
    id: ++state.seq, proc, deviceId, status: 'building', appId: null,
    nextId: 1, pending: new Map(), log: [], error: '',
  };
  state.runs.set(projectDir, run);
  state.last.delete(projectDir);
  readline.createInterface({ input: proc.stdout }).on('line', (line) => onLine(projectDir, run, line));
  proc.stderr.on('data', (c) => pushLog(projectDir, run, c, 'error'));
  proc.on('error', (err) => {
    run.error = String(err.message || err);
    pushLog(projectDir, run, run.error, 'error');
  });
  proc.on('exit', (code) => {
    if (state.runs.get(projectDir) === run) state.runs.delete(projectDir);
    for (const done of run.pending.values()) done({ error: '应用已退出' });
    run.pending.clear();
    const last = { runId: run.id, code, error: run.error, log: run.log };
    if (!state.runs.has(projectDir)) state.last.set(projectDir, last);
    send('exited', projectDir, run, { code, error: run.error });
  });
  setStatus(projectDir, run, 'building');
  return { ok: true, runId: run.id };
}

function request(run, method, params) {
  const id = run.nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { run.pending.delete(id); resolve({ error: '应用没有响应' }); }, REQUEST_TIMEOUT_MS);
    run.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
    if (!write(run, { id, method, params: { appId: run.appId, ...params } })) {
      run.pending.delete(id);
      clearTimeout(timer);
      resolve({ error: '与 flutter 进程的连接已断开' });
    }
  });
}

// 热重载（full=false）/ 热重启（full=true）：app.restart 回执 { code, message }，code 0 为成功
async function restart(projectDir, full) {
  const run = state.runs.get(projectDir);
  if (!run || !run.appId || run.status === 'building') return { ok: false, error: '应用还没启动完成' };
  if (run.status !== 'running') return { ok: false, error: '上一次重载还没结束' };
  setStatus(projectDir, run, full ? 'restarting' : 'reloading');
  const r = await request(run, 'app.restart', { fullRestart: !!full, reason: 'manual' });
  const res = r.error !== undefined
    ? { ok: false, error: r.error }
    : r.result && r.result.code === 0
      ? { ok: true }
      : { ok: false, error: (r.result && r.result.message) || '重载失败' };
  if (state.runs.get(projectDir) === run) {
    if (!res.ok) pushLog(projectDir, run, res.error, 'error');
    setStatus(projectDir, run, 'running', { result: res.ok ? (full ? 'restarted' : 'reloaded') : 'failed' });
  }
  return res;
}

const hotReload = (projectDir) => restart(projectDir, false);
const hotRestart = (projectDir) => restart(projectDir, true);

// 先请应用自己退出（设备上的进程一并结束），稍后兜底杀进程树
function stop(projectDir) {
  const run = state.runs.get(projectDir);
  if (!run) return { ok: true };
  state.runs.delete(projectDir);
  const graceful = !!run.appId && write(run, { id: run.nextId++, method: 'app.stop', params: { appId: run.appId } });
  setTimeout(() => killTree(run.proc), graceful ? 1500 : 0);
  return { ok: true };
}

function status(projectDir) {
  const run = state.runs.get(projectDir);
  if (run) return { running: true, runId: run.id, status: run.status, deviceId: run.deviceId, log: run.log };
  const last = state.last.get(projectDir);
  return last ? { running: false, last } : { running: false };
}

function killAll() {
  for (const run of state.runs.values()) killTree(run.proc);
  state.runs.clear();
}

module.exports = { setWin, start, stop, hotReload, hotRestart, status, killAll };
