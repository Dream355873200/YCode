// flutter run --machine 守护进程：自动部署到设备 + Hot Reload
// --machine 输出 JSON-RPC（[{id/result}…{method,params}…] 每行一个 JSON）：
//   事件 method: flutter.log（日志）、app.started（部署完成可交互）、
//                app.progress（进度条，msgId=hot-restart 等）、app.reloadTomatoesCurrent
//   请求 method: app.hotReload / app.hotRestart（发 {id, method} 即触发）
// 参考 Flutter daemon 协议（与 dart-cli flutter.daemon 同族）
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const { flutterBin } = require('./tools');

const state = {
  win: null,
  runs: new Map(), // projectDir → { proc, deviceId, status, rl, nextId }
};

function setWin(w) { state.win = w; }

function send(evt, extra) {
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send('flutter:evt', { evt, ...extra });
}

// 启动 flutter run -d <deviceId> --machine（单项目单实例，重复启动先杀旧）
function start({ projectDir, deviceId }) {
  if (!projectDir || !deviceId) return { ok: false, error: '缺少项目目录或设备' };
  stop(projectDir); // 幂等：旧进程清理

  const proc = spawn(flutterBin(), ['run', '--machine', '-d', deviceId], {
    cwd: projectDir,
    windowsHide: true,
    shell: false,
  });
  const entry = { proc, deviceId, status: 'building', nextId: 1 };
  state.runs.set(projectDir, entry);

  // stdout 按行切 JSON（--machine 每行一个 JSON-RPC 消息）
  const rl = readline.createInterface({ input: proc.stdout });
  rl.on('line', (line) => {
    const t = line.trim();
    if (!t.startsWith('[') && !t.startsWith('{')) return; // 混入的非 JSON 行
    let msg;
    try { msg = JSON.parse(t); } catch { return; }
    handleMsg(projectDir, entry, msg);
  });
  proc.stderr.on('data', (c) => {
    const s = String(c).trim();
    if (s) send('log', { projectDir, level: 'stderr', text: s });
  });
  proc.on('exit', (code) => {
    state.runs.delete(projectDir);
    send('exited', { projectDir, code });
  });
  send('starting', { projectDir, deviceId });
  return { ok: true };
}

function handleMsg(projectDir, entry, msg) {
  // 响应（我们发的请求的回执）——只关心 method 事件
  if (!msg.method) return;
  const p = msg.params || {};
  if (msg.method === 'app.started') {
    entry.status = 'running';
    send('started', { projectDir });
  } else if (msg.method === 'app.progress') {
    // 进度：startId/endId（如 hot-restart）；完成即代表 reload/restart 生效
    if (p.endId) send('progress-done', { projectDir, id: p.endId, msgId: p.msgId || '' });
    else if (p.startId) send('progress-start', { projectDir, id: p.startId, msgId: p.msgId || '' });
  } else if (msg.method === 'flutter.log') {
    send('log', { projectDir, level: p.level || 'info', text: String(p.message || '') });
  }
}

// 发 JSON-RPC 请求（hotReload / hotRestart）
function request(projectDir, method) {
  const entry = state.runs.get(projectDir);
  if (!entry) return { ok: false, error: '应用未在运行' };
  const id = entry.nextId++;
  entry.proc.stdin.write(JSON.stringify({ id, method }) + '\n');
  return { ok: true };
}

const hotReload = (projectDir) => request(projectDir, 'app.hotReload');
const hotRestart = (projectDir) => request(projectDir, 'app.hotRestart');

function stop(projectDir) {
  const entry = state.runs.get(projectDir);
  if (!entry) return { ok: true };
  try { entry.proc.kill(); } catch { /* */ }
  state.runs.delete(projectDir);
  return { ok: true };
}

function status(projectDir) {
  const entry = state.runs.get(projectDir);
  return entry ? { running: true, status: entry.status, deviceId: entry.deviceId } : { running: false };
}

function killAll() {
  for (const dir of state.runs.keys()) stop(dir);
}

module.exports = { setWin, start, stop, hotReload, hotRestart, status, killAll };
