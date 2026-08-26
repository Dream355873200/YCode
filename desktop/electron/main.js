// amobileCreater 桌面壳主进程装配：
// 窗口管理 · 各子系统模块接线 · IPC 注册
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { loadConfig, saveConfig, loadRegistry, saveRegistry } = require('./lib/config');
const engine = require('./lib/engine');
const { run, projectStats, filetree } = require('./lib/tools');
const devices = require('./lib/devices');
const flutter = require('./lib/flutter');

let win = null;

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#17181C',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
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
  return engine.ensure(loadConfig(), engine.state.projectDir);
});
ipcMain.handle('engine:status', () => ({ status: engine.state.status, addr: engine.state.addr, projectDir: engine.state.projectDir }));
// 打开项目：把引擎工作区切到项目目录（复用中且目录不符时重启引擎）
ipcMain.handle('engine:bindProject', async (_e, dir) => {
  if (engine.state.projectDir === dir && engine.state.status === 'running') return { ok: true, restarted: false };
  engine.kill();
  const ok = await engine.ensure(loadConfig(), dir);
  return { ok, restarted: true };
});

// ---------- IPC：配置 / 文件 ----------
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_e, cfg) => { saveConfig(cfg); return true; });
ipcMain.handle('fs:readFile', (_e, p) => {
  try { return { ok: true, content: fs.readFileSync(p, 'utf-8') }; }
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

// 新建项目：flutter create → 挂载知识库 skill → git init + 首提交 → 注册
ipcMain.handle('projects:create', async (_e, { name, dir, idea, kind, color }) => {
  if (!name || !dir) return { ok: false, error: '名称与目录必填' };
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    return { ok: false, error: '目录非空，请选择空目录' };
  }
  const projectName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^(\d)/, 'a$1');
  fs.mkdirSync(dir, { recursive: true });
  const created = await run('flutter', ['create', '--org', 'com.amobile', '--project-name', projectName, '--platforms', 'android,ios', dir]);
  if (!created.ok) return { ok: false, error: `flutter create 失败: ${created.stderr || created.error}` };

  // 挂载知识库 skill：不复制——引擎 Registry 双层扫描（全局 knowledge/skills/
  // 是唯一真源 + 项目 .yume/commands/ 可放项目定制）。复制会造成旧拷贝
  // 覆盖母本更新的问题，项目目录只建空目录备用。
  const cfg = loadConfig();
  try {
    fs.mkdirSync(path.join(dir, '.yume', 'commands'), { recursive: true });
  } catch (e) {
    return { ok: false, error: `创建 .yume 失败: ${e.message}` };
  }

  // SPEC.md 草稿
  fs.writeFileSync(path.join(dir, 'SPEC.md'),
    `# ${name} · 产品规格书 SPEC v1（草稿）\n\n## 想法\n${idea || '（待补充）'}\n\n` +
    `## 应用形态\n${kind === 'go' ? 'App + Go 后端（Gin+GORM）' : '纯移动 App（本地优先）'}\n\n## 品牌主色\n${color || '#3D5AFE'}\n`,
    'utf-8');

  // git init + 首次提交
  await run('git', ['-C', dir, 'init']);
  await run('git', ['-C', dir, 'add', '.']);
  await run('git', ['-C', dir, 'commit', '-m', 'chore: flutter 脚手架 + 知识库挂载（amobileCreater）']);

  // 注册
  const reg = loadRegistry();
  reg.projects.unshift({ name, dir, idea: idea || '', kind: kind || 'app', color: color || '#3D5AFE', createdAt: new Date().toISOString() });
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
