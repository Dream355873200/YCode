// amobileCreater 桌面壳主进程装配：
// 窗口管理 · 各子系统模块接线 · IPC 注册
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const { loadConfig, saveConfig, loadRegistry, saveRegistry } = require('./lib/config');
const engine = require('./lib/engine');
const { projectStats, filetree, gitStatus } = require('./lib/tools');
const devices = require('./lib/devices');
const flutter = require('./lib/flutter');
const { scaffolds } = require('./lib/scaffolds');

let win = null;

// ---------- 窗口 ----------
// v2 自绘标题栏：无边框 + 无系统菜单；legacy 保留系统边框（平行运行期）
function createWindow() {
  const uiVersion = loadConfig().uiVersion;
  if (uiVersion === 'v2') Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#17181C',
    frame: uiVersion !== 'v2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    // 双入口：按 uiVersion 加载 legacy（index.html）或 v2（v2/index.html）
    const base = process.env.VITE_DEV_SERVER_URL.replace(/\/$/, '');
    win.loadURL(loadConfig().uiVersion === 'v2' ? `${base}/v2/index.html` : base);
  } else {
    const page = loadConfig().uiVersion === 'v2'
      ? path.join(__dirname, '..', 'dist', 'v2', 'index.html')
      : path.join(__dirname, '..', 'dist', 'index.html');
    win.loadFile(page);
  }
  win.on('closed', () => (win = null));

  engine.setWin(win);
  devices.setWin(win);
  flutter.setWin(win);
}

// ---------- IPC：引擎 ----------
// 引擎未就绪（启动窗口期/重启中）时 engine:get 的连接拒绝属预期状态，
// 返回 { unreachable: true } 而非 reject —— 避免主进程刷 ECONNREFUSED 错误日志
ipcMain.handle('engine:get', (_e, apiPath) =>
  engine.httpJSON('GET', engine.state.addr.replace('http://', ''), apiPath)
    .catch((err) => (engine.isConnRefused(err) ? { unreachable: true, status: 0 } : Promise.reject(err))));
ipcMain.handle('engine:post', (_e, apiPath, body) => engine.httpJSON('POST', engine.state.addr.replace('http://', ''), apiPath, body));
ipcMain.handle('engine:chat', (_e, payload) => engine.streamChat(payload).then(() => ({ ok: true })).catch((err) => ({ ok: false, error: String(err) })));
ipcMain.handle('engine:restart', async () => {
  engine.kill();
  return engine.ensure(loadConfig());
});
ipcMain.handle('engine:status', () => ({ status: engine.state.status, addr: engine.state.addr }));
// 模型列表：OpenAI 兼容端点的 GET {baseUrl}/models（composer 模型选择器数据源）。
ipcMain.handle('engine:listModels', async () => {
  const cfg = loadConfig().engine || {};
  const base = String(cfg.baseUrl || '').replace(/\/$/, '');
  if (!base) return [];
  try {
    const res = await fetch(`${base}/models`, {
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((m) => m.id).filter(Boolean);
  } catch {
    return [];
  }
});
// 打开项目：登记 session→{项目目录, 模式} 绑定（引擎按会话扎根项目目录、
// 按会话模式裁剪能力，不重启）。多项目、多模式并行互不干扰。
ipcMain.handle('engine:bindProject', async (_e, sessionId, dir, mode) => {
  const ok = engine.bindSession(sessionId, dir, mode);
  // 引擎可能还没起（如开机首次进项目）：顺手拉起，不等它就绪（非阻塞路径）
  if (engine.state.status !== 'running') engine.ensure(loadConfig());
  return { ok, restarted: false };
});

// ---------- IPC：窗口控制（v2 自绘标题栏） ----------
ipcMain.handle('win:minimize', () => { if (win) win.minimize(); });
ipcMain.handle('win:maximize', () => { if (win) (win.isMaximized() ? win.unmaximize() : win.maximize()); });
ipcMain.handle('win:close', () => { if (win) win.close(); });

// ---------- IPC：配置 / 文件 ----------
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_e, cfg) => { saveConfig(cfg); return true; });
ipcMain.handle('fs:readFile', (_e, p) => {
  try { return { ok: true, content: fs.readFileSync(p, 'utf-8') }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// 编辑器写回：CodeEditor Ctrl+S 保存。写的是引擎管理的项目目录，
// 落盘后前端再通知引擎（POST /notify/user-edit）让 AI 重读该文件。
ipcMain.handle('fs:writeFile', (_e, p, content) => {
  try { fs.writeFileSync(p, content, 'utf-8'); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// 列目录（测试报告页签扫描 .yume/test-reports/）
ipcMain.handle('fs:listDir', (_e, p) => {
  try {
    const names = fs.readdirSync(p).filter((f) => !f.startsWith('.')).sort().reverse();
    return { ok: true, files: names.map((n) => path.join(p, n)) };
  } catch { return { ok: true, files: [] }; }
});
// 读图片为 dataURL（报告页签的截图证据）
ipcMain.handle('fs:readImage', (_e, p) => {
  try {
    const b = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return { ok: true, dataUrl: `data:image/${mime};base64,${b.toString('base64')}` };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------- IPC：项目 ----------
ipcMain.handle('projects:list', async () => {
  const reg = loadRegistry();
  // 模式字段出现前注册的老项目：按内容一次性定格模式并写回（有 pubspec.yaml
  // 即 Flutter 工程，其余取当前默认模式），此后改默认模式不会隐式改变它们
  let pinned = false;
  for (const p of reg.projects) {
    if (p.mode) continue;
    p.mode = fs.existsSync(path.join(p.dir, 'pubspec.yaml')) ? 'flutter' : loadConfig().engine.mode;
    pinned = true;
  }
  if (pinned) saveRegistry(reg);
  const projects = [];
  for (const p of reg.projects) {
    const exists = fs.existsSync(p.dir);
    const stats = exists ? await projectStats(p.dir) : { head: null, commits: 0, dirty: false };
    projects.push({ ...p, exists, ...stats });
  }
  return projects;
});
ipcMain.handle('projects:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// 新建项目（模式声明驱动）：fields 是 mode.json projectFields 的表单值，
// scaffold 是模式声明的脚手架 id（见 lib/scaffolds.js）：
//   有 scaffold —— 在目录里生成工程后注册
//   无 scaffold —— 打开已有工作目录直接注册（通用代码 Agent 不做脚手架）
ipcMain.handle('projects:create', async (_e, { mode, scaffold, fields }) => {
  const f = fields || {};
  const dir = f.dir && String(f.dir).trim();
  const projectMode = mode || loadConfig().engine.mode;
  if (!dir) return { ok: false, error: '请选择目录' };
  if (!projectMode) return { ok: false, error: '缺少模式' };

  let record = {};
  if (scaffold) {
    const make = scaffolds[scaffold];
    if (!make) return { ok: false, error: `未知脚手架 ${scaffold}` };
    const r = await make({ ...f, dir });
    if (!r.ok) return r;
    record = r.record || {};
  } else if (!fs.existsSync(dir)) {
    return { ok: false, error: '请选择已存在的工作目录' };
  }

  const reg = loadRegistry();
  const prev = reg.projects.find((p) => p.dir === dir);
  reg.projects = reg.projects.filter((p) => p.dir !== dir);
  reg.projects.unshift({
    ...(prev || {}),
    ...record,
    name: (f.name && String(f.name).trim()) || path.basename(dir),
    dir, mode: projectMode,
    createdAt: (prev && prev.createdAt) || new Date().toISOString(),
  });
  saveRegistry(reg);
  return { ok: true };
});
// 切换项目模式：只改注册表记录；会话绑定由渲染层随后 bindProject 重写
//（引擎下一轮 run 即按新模式装配工具/提示词/规范/技能，不重启）。
ipcMain.handle('projects:setMode', (_e, dir, mode) => {
  const reg = loadRegistry();
  const p = reg.projects.find((x) => x.dir === dir);
  if (!p) return { ok: false, error: '项目未注册' };
  p.mode = mode;
  saveRegistry(reg);
  return { ok: true };
});
ipcMain.handle('projects:remove', (_e, dir) => {
  const reg = loadRegistry();
  reg.projects = reg.projects.filter((p) => p.dir !== dir);
  saveRegistry(reg);
  return { ok: true };
});
ipcMain.handle('projects:filetree', (_e, dir) => filetree(dir));
ipcMain.handle('git:status', (_e, dir) => gitStatus(dir));

// ---------- IPC：设备与投屏 ----------
ipcMain.handle('devices:list', () => devices.listDevices());
ipcMain.handle('scrcpy:start', (_e, deviceId) => devices.startMirror(deviceId));
ipcMain.handle('scrcpy:connect', (_e, deviceId) => devices.connectMirror(deviceId));
ipcMain.handle('scrcpy:stop', (_e, deviceId) => devices.stopMirror(deviceId));

// ---------- IPC：flutter run 部署 ----------
ipcMain.handle('flutter:start', (_e, payload) => flutter.start(payload));
ipcMain.handle('flutter:stop', (_e, dir) => flutter.stop(dir));
ipcMain.handle('flutter:reload', (_e, dir) => flutter.hotReload(dir));
ipcMain.handle('flutter:restart', (_e, dir) => flutter.hotRestart(dir));
ipcMain.handle('flutter:status', (_e, dir) => flutter.status(dir));

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  createWindow();
  devices.startPolling();
  const cfg = loadConfig();
  if (cfg.engine.autoStart) {
    await engine.ensure(cfg);
  } else {
    engine.state.status = 'stopped';
  }
});

app.on('window-all-closed', () => {
  engine.kill();
  devices.killAll();
  flutter.killAll();
  app.quit();
});
app.on('before-quit', () => {
  engine.kill();
  devices.killAll();
  flutter.killAll();
});
