// Android 设备管理：adb devices 轮询（3s，变化广播）+ 投屏生命周期。
// 投屏方案：Web 原生（无独立窗口）——
//   主进程：push scrcpy-server → 手机上 app_process 启动 → adb forward →
//           TCP 连接 → 经 Electron MessageChannel 把原始字节流桥给 renderer
//   renderer：@yume-chan/scrcpy 协议解析 + WebCodecs 解码 → <canvas>
const { spawn } = require('child_process');
const net = require('net');
const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { run, adbBin } = require('./tools');
const { projectRoot } = require('./config');

const state = {
  win: null,          // BrowserWindow 引用（main.js 注入）
  pollTimer: null,
  lastDevicesJson: '',
  mirrors: new Map(), // deviceId → { serverProc, socket }
};

function setWin(w) { state.win = w; }

// adb devices -l 解析 → [{id, state, model, transport}]
async function listDevices() {
  const r = await run('adb', ['devices', '-l']);
  // 只有二进制真不存在（ENOENT / not recognized）才是「未找到 adb」；
  // server 未起/瞬时失败输出可能为空，但 adb 本身在——显示等待而非未找到
  const binMissing = !r.ok && /ENOENT|not found|not recognized|无法找到/i.test(String(r.error || r.stderr || ''));
  if (binMissing) return { devices: [], adbAvailable: false };
  const devices = [];
  for (const line of r.stdout.split('\n').slice(1)) { // 跳过 "List of devices attached"
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(\S+)\s+(device|offline|unauthorized|no permissions)/);
    if (!m) continue;
    const model = (t.match(/model:(\S+)/) || [])[1] || '';
    const transport = (t.match(/usb:(\S+)/) ? 'usb' : (t.includes('tcpip') ? 'wifi' : ''));
    devices.push({ id: m[1], state: m[2] === 'device' ? 'online' : m[2], model, transport });
  }
  return { devices, adbAvailable: true };
}

function startPolling() {
  if (state.pollTimer) return;
  let lastResetAt = 0;   // 自愈限频：防与常驻老 adb 守护进程打乒乓
  let emptyStreak = 0;   // 连续空轮计数（瞬断去抖 + 自愈门槛）
  const poll = async () => {
    try {
      let { devices, adbAvailable } = await listDevices();
      const mirroring = state.mirrors.size > 0;
      // 自愈 ①：设备从有到无，reconnect 触发重新枚举（server 端口隔离后
      // 只兜 USB 瞬断）。投屏中跳过——任何 adb 动作都可能扰动 USB 通道。
      if (adbAvailable && !mirroring && devices.length === 0 && state.lastDevicesJson !== '[]') {
        await run('adb', ['reconnect']).catch(() => {});
        await new Promise((r) => setTimeout(r, 1200));
        devices = (await listDevices()).devices;
      }
      // 自愈 ②：连续 3 轮（≈9s）仍空 + 无投屏 —— 重置自有 adb server
      //（强杀清场再起我们的 1.0.41，独占 USB）。投屏中绝不触发。
      if (adbAvailable && !mirroring && devices.length === 0 && emptyStreak >= 2
          && Date.now() - lastResetAt > 60_000) {
        lastResetAt = Date.now();
        console.log('[adb] 设备连续未枚举到，重置自有 adb server');
        await ensureAdbServer();
        await run('adb', ['reconnect']).catch(() => {});
        await new Promise((r) => setTimeout(r, 1500));
        devices = (await listDevices()).devices;
        if (devices.length) console.log('[adb] 自愈成功，设备恢复');
      }
      // 广播去抖：单轮空读不立即广播「无设备」（瞬断会把 UI 上的设备下拉/
      // 投屏按钮闪没）——连续 2 轮空才算真丢。
      if (devices.length === 0 && state.lastDevicesJson !== '[]') {
        emptyStreak += 1;
        if (emptyStreak < 2) return;
      } else {
        emptyStreak = 0;
      }
      const json = JSON.stringify(devices);
      if (json !== state.lastDevicesJson) {
        state.lastDevicesJson = json;
        if (state.win && !state.win.isDestroyed()) state.win.webContents.send('devices:changed', { devices, adbAvailable });
      }
    } catch { /* adb 瞬时不可用，下轮再试 */ }
  };
  // 启动归位 + 持续轮询自愈（poll 内含 60s 限频的 server 重置）
  (async () => {
    await ensureAdbServer();
    poll();
  })();
  state.pollTimer = setInterval(poll, 3000);
}

// adb server 归位（仅在无投屏运行时由自愈调用）：多版本 adb 共存时（本机
// 实测 C:\Windows\adb.exe 1.0.26 由 ROMaster 守护常驻、抢 5037），必须强杀
// 全部 adb 进程清场，再用我们选定的 1.0.41 起 server——同时独占 USB 设备。
// 只在启动归位与 60s 限频自愈时执行，运行中投屏绝不触发。
async function ensureAdbServer() {
  await run('adb', ['kill-server']).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  try {
    await run('powershell', ['-NoProfile', '-Command',
      'Get-Process adb -ErrorAction SilentlyContinue | Stop-Process -Force'], {});
    await new Promise((r) => setTimeout(r, 800));
  } catch { /* 强杀失败继续 */ }
  await run('adb', ['start-server']).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
}

// ---- Web 原生投屏 ----
// 两步协议（避免竞态：mirror:port 消息早于 renderer 监听器注册而丢失）：
//   ① startMirror：push + 启动手机上的 scrcpy-server（IPC 返回后 renderer
//      挂载 MirrorCanvas，注册 mirror:port 监听器）
//   ② connectMirror：MirrorCanvas 挂载后主动请求 —— 这时才建 TCP 连接
//      并 postMessage 转发 MessagePort，保证有人在收
//
// scrcpy 4.1 实测要点（Android 16 + 自带 adb 1.0.41）：
//   - 老版 adb（1.0.26）shell 通道会让 server abort —— 必须 tools/scrcpy/adb.exe
//   - cleanup 必须为 false：server 退出会删掉 /data/local/tmp 里的自身文件
//   - tunnel_forward 模式：客户端连接后双方交换 dummy byte（0x00），
//     然后 server 推 device meta + video meta + H.264 流
// 启动手机端 server（app_process，tunnel_forward 模式监听 localabstract:scrcpy）。
// startMirror 与 connectMirror 的自动重拉共用；早退记录在 entry 上供重试判定。
function spawnServer(deviceId) {
  const serverProc = spawn(adbBin(), [
    '-s', deviceId, 'shell',
    `CLASSPATH=/data/local/tmp/amc-scrcpy-server app_process / com.genymobile.scrcpy.Server 4.1 ` +
    `log_level=info video=true audio=false control=true cleanup=false max_size=1080 video_bit_rate=5000000 ` +
    `video_codec=h264 tunnel_forward=true`,
  ], { windowsHide: true });
  serverProc.stdout.on('data', (c) => console.log('[scrcpy-server]', String(c).trim()));
  serverProc.stderr.on('data', (c) => {
    const s = String(c).trim();
    if (!s) return;
    console.log('[scrcpy-server:err]', s);
    const e = state.mirrors.get(deviceId);
    if (e) e.errTail = ((e.errTail || '') + '\n' + s).slice(-400);
  });
  // 早退记录：连接阶段死掉 → connectMirror 自动重拉（≤2 次）；额度耗尽仍未
  // 连上由 connectMirror 统一报错。连上后死掉 → socket close 走 stopMirror。
  serverProc.on('exit', (code) => {
    console.log('[scrcpy-server] 退出 code=', code);
    const e = state.mirrors.get(deviceId);
    if (!e) return; // stopMirror 已清理（正常停止），勿重复广播
    e.exited = true;
  });
  return serverProc;
}

async function startMirror(deviceId) {
  if (state.mirrors.has(deviceId)) return { ok: true, already: true };
  const serverBin = path.join(projectRoot(), 'tools', 'scrcpy', 'scrcpy-server');
  if (!fs.existsSync(serverBin)) return { ok: false, error: '未找到 scrcpy-server（tools/scrcpy/）' };

  // 0. 清理残留（上次会话的 server 进程/转发）
  await run('adb', ['-s', deviceId, 'shell', 'pkill -f com.genymobile.scrcpy']).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  // 0.5 确认设备在线（server 被换/掉线时 fail-fast，错误信息可读）
  const online = await run('adb', ['-s', deviceId, 'get-state']).catch(() => null);
  if (!online || !online.ok || String(online.stdout || '').trim() !== 'device') {
    return { ok: false, error: `设备 ${deviceId} 不在线（${String((online && (online.stderr || online.stdout)) || '状态未知').trim()}）——重新插拔或检查 USB 调试` };
  }

  // 1. push server 到手机（cleanup=false 保证文件留着，重复 push 无害）
  const push = await run('adb', ['-s', deviceId, 'push', serverBin, '/data/local/tmp/amc-scrcpy-server']);
  if (!push.ok) return { ok: false, error: `push scrcpy-server 失败: ${push.stderr || push.error}` };

  // 2. 启动手机端 server；连接在 connectMirror（renderer 挂载后主动请求，
  //    避免竞态：mirror:port 消息早于监听器注册而丢失）
  const entry = {
    serverProc: null, socket: null, port: null,
    exited: false, errTail: '', restarts: 0, retrying: false,
  };
  state.mirrors.set(deviceId, entry);
  entry.serverProc = spawnServer(deviceId);
  return { ok: true };
}

// 第二步：建 TCP 通道并转发 MessagePort 给 renderer（调用方保证监听器已就绪）
async function connectMirror(deviceId) {
  const entry = state.mirrors.get(deviceId);
  if (!entry) return { ok: false, error: '投屏未启动' };
  // 连接中/已连上：直接成功返回（StrictMode 双挂载会并发调两次——第二个
  // 循环若也开跑，会和第一个互相 pkill/重拉 server。数据是按 deviceId 广播
  // 的，一条通道服务所有挂载）。
  if (entry.socket || entry.retrying) return { ok: true, already: true };

  // 等 server 就绪并完成 video 通道握手。两个坑：
  //   ① server 启动耗时随设备 1~8s 不等 —— 轮询重试而非固定 sleep；
  //   ② adb forward 的 TCP 连接由 adbd 代答，server 死了也能「连上」——
  //      必须以收到 dummy byte 为就绪判据（收到 = server 真正 accept 了）。
  // server 早退（旧实例占坑/启动崩溃）时自动重拉，最多 2 次；12s 兜底判失败。
  const deadline = Date.now() + 12_000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  entry.retrying = true;
  let socket = null;
  let hello = null;
  let port = 0;
  let lastErr = '未知错误';
  for (;;) {
    const e = state.mirrors.get(deviceId);
    if (!e) return { ok: false, error: '投屏已中止' };
    if (e.exited) {
      if (e.restarts >= 3) {
        lastErr = `server 反复退出${e.errTail ? `：${e.errTail.trim().split('\n').pop()}` : ''}`;
        break;
      }
      e.restarts += 1;
      console.log(`[mirror] server 早退，第 ${e.restarts} 次重拉`);
      await run('adb', ['-s', deviceId, 'shell', 'pkill -f com.genymobile.scrcpy']).catch(() => {});
      await sleep(800);
      e.serverProc = spawnServer(deviceId);
      e.exited = false;
      e.errTail = '';
    }
    // forward + TCP 连接 + dummy byte 等待（≤2.5s）。没等到 dummy = adbd 代答
    // 的空连接（server 未 accept），销毁重试——根治「TCP 连上即成功」假象。
    socket = null;
    hello = null;
    const fwd = await run('adb', ['-s', deviceId, 'forward', 'tcp:0', 'localabstract:scrcpy']);
    port = parseInt((fwd.stdout.trim().match(/(\d+)/) || [])[1] || '0', 10);
    if (!port) {
      const fl = await run('adb', ['-s', deviceId, 'forward', '--list']);
      const rows = (fl.stdout || '').trim().split('\n').filter((l) => l.includes('localabstract:scrcpy'));
      port = parseInt((((rows[rows.length - 1] || '').match(/tcp:(\d+)/) || [])[1]) || '0', 10);
    }
    if (fwd.ok && port) {
      try {
        socket = await new Promise((resolve, reject) => {
          const s = net.connect(port, '127.0.0.1');
          const t = setTimeout(() => { s.destroy(); reject(new Error('连接超时')); }, 1500);
          s.once('connect', () => { clearTimeout(t); resolve(s); });
          s.once('error', (err) => { clearTimeout(t); reject(err); });
        });
        hello = await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('server 未应答')), 2500);
          socket.once('data', (d) => { clearTimeout(t); resolve(d); });
        });
        break;
      } catch (err) {
        try { socket.destroy(); } catch { /* */ }
        socket = null;
        lastErr = String(err.message || err);
      }
    } else {
      lastErr = fwd.ok ? '无法获取转发端口' : `adb forward 失败: ${fwd.stderr || fwd.error}`;
    }
    if (Date.now() > deadline) break;
    await sleep(400);
  }
  entry.retrying = false;
  if (!socket || !hello) { stopMirror(deviceId); return { ok: false, error: `连接 scrcpy 失败: ${lastErr}` }; }
  console.log('[mirror] video 通道已就绪 port=', port);

  // 握手收尾 + control 通道连接（此刻 server 已真正 accept，失败即真异常）。
  // scrcpy 4.1 forward 模式 server 按顺序 accept 多条连接（源码
  // DesktopConnection.open）：① video（accept 后发 dummy byte）② audio
  // （audio=false 无此通道）③ control —— 必须把控制通道也连上，server 的
  // open() 才会返回、视频才开始推流。
  let controlSocket;
  try {
    socket.write(Buffer.from([0]));
    if (hello.length > 1) {
      // dummy 后已附带 meta（罕见但处理）：先缓存，socket data 事件接上后补发
      const cur = state.mirrors.get(deviceId);
      if (cur) cur.pending = hello.subarray(1);
    }
    // 第 2 条 = control（不发 dummy）。控制消息走这条，设备消息（剪贴板等）也从这条回来
    controlSocket = net.connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      controlSocket.once('connect', resolve);
      controlSocket.once('error', reject);
    });
    console.log('[mirror] control 通道已连接');
  } catch (e) {
    socket.destroy();
    stopMirror(deviceId);
    return { ok: false, error: `连接 scrcpy 失败: ${e.message}` };
  }
  const e2 = state.mirrors.get(deviceId);
  if (!e2) { socket.destroy(); controlSocket.destroy(); return { ok: false, error: '投屏已中止' }; }
  e2.socket = socket;
  e2.controlSocket = controlSocket;

  // 数据通道：普通 IPC（contextBridge 无法转移 MessagePort —— 实测 e.ports
  // 到 renderer 侧变成空对象）。socket → 攒批发送：视频流每秒数百个 chunk，
  // 逐条 send 会压垮 renderer 消息队列（表现为整个应用卡死）—— 按 16ms 合并。
  const pending = e2.pending || null;
  let chunkCount = 0;
  let byteCount = 0;
  let batch = [];
  let batchLen = 0;
  let flushTimer = null;
  const flush = () => {
    flushTimer = null;
    if (!batch.length) return;
    const merged = batch.length === 1 ? batch[0] : Buffer.concat(batch, batchLen);
    batch = []; batchLen = 0;
    if (state.win && !state.win.isDestroyed()) state.win.webContents.send('mirror:data', deviceId, new Uint8Array(merged));
  };
  if (pending && pending.length) {
    console.log(`[mirror] 首包余量 ${pending.length}B`);
    state.win.webContents.send('mirror:data', deviceId, new Uint8Array(pending));
  }
  socket.on('data', (chunk) => {
    chunkCount += 1;
    byteCount += chunk.length;
    if (chunkCount === 1) console.log(`[mirror] 首个 chunk ${chunk.length}B，视频流已开始`);
    batch.push(chunk);
    batchLen += chunk.length;
    if (!flushTimer) flushTimer = setTimeout(flush, 16);
  });
  socket.on('close', () => {
    console.log('[mirror] socket 关闭');
    if (state.win && !state.win.isDestroyed()) state.win.webContents.send('mirror:closed', deviceId);
    stopMirror(deviceId);
  });
  socket.on('error', (err) => {
    if (state.win && !state.win.isDestroyed()) state.win.webContents.send('mirror:err', deviceId, String(err));
    stopMirror(deviceId);
  });
  // renderer 回写（控制消息 → control 通道）
  const writeHandler = (_e, devId, chunk) => {
    if (devId === deviceId && !controlSocket.destroyed) controlSocket.write(Buffer.from(chunk));
  };
  ipcMain.on('mirror:write', writeHandler);
  controlSocket.on('error', (err) => {
    console.log('[mirror] control 通道错误:', String(err));
    stopMirror(deviceId);
  });
  controlSocket.on('close', () => stopMirror(deviceId));
  const endHandler = (_e, devId) => {
    if (devId === deviceId) { socket.end(); controlSocket.end(); stopMirror(deviceId); }
  };
  ipcMain.on('mirror:end', endHandler);
  // 清理监听（投屏停止时）
  e2.cleanupIpc = () => {
    ipcMain.removeListener('mirror:write', writeHandler);
    ipcMain.removeListener('mirror:end', endHandler);
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  };

  // 通知 renderer：通道就绪（随后的 mirror:data 事件即数据流）
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send('mirror:ready', deviceId);
  return { ok: true };
}

function stopMirror(deviceId) {
  const m = state.mirrors.get(deviceId);
  if (!m) return { ok: true };
  try { m.serverProc.kill(); } catch { /* */ }
  try { m.socket && m.socket.destroy(); } catch { /* */ }
  try { m.controlSocket && m.controlSocket.destroy(); } catch { /* */ }
  if (m.cleanupIpc) { try { m.cleanupIpc(); } catch { /* */ } }
  // 清理本设备 scrcpy 的 forward（避免 tcp:0 反复分配堆积端口）
  run('adb', ['-s', deviceId, 'forward', '--remove-all']).catch(() => {});
  state.mirrors.delete(deviceId);
  // 应用退出中窗口可能已销毁：isDestroyed 守卫，否则 webContents.send 崩溃
  if (state.win && !state.win.isDestroyed()) state.win.webContents.send('scrcpy:exited', { deviceId });
}

function killAll() {
  for (const id of state.mirrors.keys()) stopMirror(id);
  if (state.pollTimer) clearInterval(state.pollTimer);
}

module.exports = { setWin, listDevices, startPolling, startMirror, connectMirror, stopMirror, killAll };
