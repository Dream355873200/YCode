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
  let lastResetAt = 0; // 自愈限频：防与常驻老 adb 守护进程打乒乓
  const poll = async () => {
    try {
      let { devices, adbAvailable } = await listDevices();
      // 自愈：adb server 重启/被抢后 USB 设备需重新枚举 —— reconnect 触发
      if (adbAvailable && devices.length === 0 && state.lastDevicesJson !== '[]') {
        await run('adb', ['reconnect']).catch(() => {});
        await new Promise((r) => setTimeout(r, 1200));
        const r2 = await listDevices();
        devices = r2.devices;
      }
      // 自愈 ②：仍然拿不到设备但 adb 二进制在 —— 大概率 5037 又被老版 adb
      //（C:\Windows\adb.exe 1.0.26，ROMaster 等国产软件常驻守护，杀不死）
      // 抢占。60s 限频执行完整重置（强杀全部 adb → 我们的 1.0.41 重起）。
      if (adbAvailable && devices.length === 0 && Date.now() - lastResetAt > 60_000) {
        lastResetAt = Date.now();
        console.log('[adb] 设备丢失，执行 server 重置自愈');
        await ensureAdbServer();
        await run('adb', ['reconnect']).catch(() => {});
        await new Promise((r) => setTimeout(r, 1500));
        const r3 = await listDevices();
        devices = r3.devices;
        if (devices.length) console.log('[adb] 自愈成功，设备恢复');
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

// adb server 归位：多版本 adb 共存时（本机实测 C:\Windows\adb.exe 1.0.26 由
// ROMaster「fork-server」守护常驻，抢 5037 且新版 kill 命令对它无效），
// 必须 PowerShell 强杀全部 adb 进程清空端口，再用我们选定的 1.0.41 起 server。
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

  // 2. 手机上启动 server（app_process），tunnel_forward 模式监听 localabstract:scrcpy
  const serverProc = spawn(adbBin(), [
    '-s', deviceId, 'shell',
    `CLASSPATH=/data/local/tmp/amc-scrcpy-server app_process / com.genymobile.scrcpy.Server 4.1 ` +
    `log_level=info video=true audio=false control=true cleanup=false max_size=1080 video_bit_rate=5000000 ` +
    `video_codec=h264 tunnel_forward=true`,
  ], { windowsHide: true });
  serverProc.stdout.on('data', (c) => console.log('[scrcpy-server]', String(c).trim()));
  serverProc.stderr.on('data', (c) => console.log('[scrcpy-server:err]', String(c).trim()));
  serverProc.on('exit', (code) => console.log('[scrcpy-server] 退出 code=', code));
  state.mirrors.set(deviceId, { serverProc, socket: null, port: null });
  serverProc.on('exit', () => stopMirror(deviceId));
  return { ok: true };
}

// 第二步：建 TCP 通道并转发 MessagePort 给 renderer（调用方保证监听器已就绪）
async function connectMirror(deviceId) {
  const entry = state.mirrors.get(deviceId);
  if (!entry) return { ok: false, error: '投屏未启动' };
  if (entry.socket) return { ok: true, already: true };

  // 等 server 就绪（socket 开始监听）
  await new Promise((r) => setTimeout(r, 1500));

  // adb forward 到本机端口。注意 socket 名：scrcpy server 无 scid 参数时
  // 监听 localabstract:scrcpy（4.x 默认）—— 必须与启动参数一致。
  const fwd = await run('adb', ['-s', deviceId, 'forward', 'tcp:0', 'localabstract:scrcpy']);
  if (!fwd.ok) { stopMirror(deviceId); return { ok: false, error: `adb forward 失败: ${fwd.stderr || fwd.error}` }; }
  let port = parseInt((fwd.stdout.trim().match(/(\d+)/) || [])[1] || '0', 10);
  if (!port) {
    const fl = await run('adb', ['-s', deviceId, 'forward', '--list']);
    const rows = (fl.stdout || '').trim().split('\n').filter((l) => l.includes('localabstract:scrcpy'));
    const last = rows[rows.length - 1] || '';
    port = parseInt((last.match(/tcp:(\d+)/) || [])[1] || '0', 10);
  }
  if (!port) { stopMirror(deviceId); return { ok: false, error: '无法获取转发端口' }; }

  // TCP 连接。scrcpy 4.1 forward 模式 server 按顺序 accept 多条连接（源码
  // DesktopConnection.open）：① video（accept 后发 dummy byte）② audio（跳过）
  // ③ control —— 必须把控制通道也连上，server 的 open() 才会返回、视频才开始推流。
  let socket;
  let controlSocket;
  try {
    socket = net.connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      socket.once('connect', () => { console.log('[mirror] TCP 已连接 port=', port); resolve(); });
      socket.once('error', reject);
    });
    // 第 1 条 = video。dummy byte 只在第一条 accept 后发一次（sendDummyByte 标志）。
    const hello = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('握手超时（server 未发 dummy byte）')), 5000);
      socket.once('data', (d) => { clearTimeout(t); resolve(d); });
    });
    socket.write(Buffer.from([0]));
    if (hello.length > 1) {
      // dummy 后已附带 meta（罕见但处理）：先缓存，socket data 事件接上后补发
      entry = state.mirrors.get(deviceId);
      if (entry) entry.pending = hello.subarray(1);
    }
    console.log('[mirror] video 通道握手完成');

    // 第 2 条 = control（不发 dummy）。控制消息走这条，设备消息（剪贴板等）也从这条回来
    controlSocket = net.connect(port, '127.0.0.1');
    await new Promise((resolve, reject) => {
      controlSocket.once('connect', resolve);
      controlSocket.once('error', reject);
    });
    console.log('[mirror] control 通道已连接');
  } catch (e) {
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
