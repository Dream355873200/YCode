// 子进程工具（flutter/git/adb）绝对路径解析 + 项目统计/文件树
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { projectRoot } = require('./config');

// Electron GUI 进程的 PATH 往往不含 flutter/git（尤其从图标启动时），
// 先解析出绝对路径，找不到再回落 PATH。
const TOOLS = {};
function resolveTool(name, candidates) {
  if (TOOLS[name]) return TOOLS[name];
  for (const c of candidates) {
    if (fs.existsSync(c)) { TOOLS[name] = c; return c; }
  }
  TOOLS[name] = name; // 回落 PATH
  return TOOLS[name];
}
function flutterBin() {
  return resolveTool('flutter', [
    'E:\\flutter\\bin\\flutter.bat',
    'C:\\flutter\\bin\\flutter.bat',
    path.join(projectRoot(), 'flutter', 'bin', 'flutter.bat'),
  ]);
}
function gitBin() {
  return resolveTool('git', [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\mingw64\\bin\\git.exe',
    'D:\\Program Files\\Git\\cmd\\git.exe',
  ]);
}
const ADB_CANDIDATES = [
  // 投屏/协议链路必须用较新的 adb（老版 1.0.26 shell 通道会让 scrcpy-server abort）。
  // 优先级：scrcpy 自带（1.0.41+，经实测可用）> Android SDK > 常见安装位。
  path.join(projectRoot(), 'tools', 'scrcpy', 'adb.exe'),
  'E:\\Android SDK\\platform-tools\\adb.exe',
  process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe') : null,
  process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe') : null,
  path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  'C:\\Windows\\adb.exe',
].filter(Boolean);
function adbBin() {
  return resolveTool('adb', ADB_CANDIDATES);
}

function run(tool, args, opts = {}) {
  const cmd = tool === 'flutter' ? flutterBin() : tool === 'git' ? gitBin() : tool === 'adb' ? adbBin() : tool;
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 20 * 1024 * 1024, shell: cmd.endsWith('.bat'), ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err ? String(err.message || err) : null });
    });
  });
}

// 项目统计：git HEAD 短 SHA + 决策点（commit）数
async function projectStats(dir) {
  const head = await run('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']);
  const count = await run('git', ['-C', dir, 'rev-list', '--count', 'HEAD']);
  const status = await run('git', ['-C', dir, 'status', '--porcelain']);
  return {
    head: head.ok ? head.stdout.trim() : null,
    commits: count.ok ? parseInt(count.stdout.trim(), 10) || 0 : 0,
    dirty: status.ok ? status.stdout.trim().length > 0 : false,
  };
}

// 文件树：递归目录 + git status 标注（NEW/MOD）
async function filetree(dir) {
  const SKIP = new Set(['.git', '.dart_tool', 'build', '.idea', 'node_modules', '.yume', '.gradle', 'ephemeral']);
  const st = await run('git', ['-C', dir, 'status', '--porcelain']);
  const marks = new Map();
  for (const line of (st.stdout || '').split('\n')) {
    const m = line.match(/^([AMD?]+)\s+(?:.+->\s+)?(.+)$/);
    if (m) marks.set(m[2].replace(/"/g, ''), m[1].trim());
  }
  function walk(rel) {
    const abs = path.join(dir, rel);
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return []; }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? 1 : -1));
    const out = [];
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push({ type: 'dir', name: e.name, path: p, children: walk(p) });
      } else {
        out.push({ type: 'file', name: e.name, path: p, st: marks.get(p.replace(/\\/g, '/')) || null });
      }
    }
    return out;
  }
  return walk('');
}

// Git 面板数据：分支/上游/变更清单/最近提交（右栏一次取全）
async function gitStatus(dir) {
  const [head, count, st, log] = await Promise.all([
    run('git', ['-C', dir, 'rev-parse', '--short', 'HEAD']),
    run('git', ['-C', dir, 'rev-list', '--count', 'HEAD']),
    run('git', ['-C', dir, 'status', '--porcelain=v1', '-b']),
    run('git', ['-C', dir, 'log', '--pretty=format:%h%x09%s%x09%cr', '-n', '8']),
  ]);
  if (!st.ok) return { ok: false, error: st.stderr || st.error || 'git 不可用' };
  let branch = '';
  let upstream = '';
  let ahead = 0;
  let behind = 0;
  const changes = [];
  for (const line of st.stdout.split('\n').filter((l) => l.trim())) {
    if (line.startsWith('## ')) {
      const m = line.slice(3).match(/^(.+?)(?:\.\.\.(\S+))?(\s+\[(.+)\])?$/);
      if (!m) continue;
      branch = m[1];
      upstream = m[2] || '';
      const ab = (m[4] || '').match(/ahead (\d+)/);
      const bd = (m[4] || '').match(/behind (\d+)/);
      ahead = ab ? parseInt(ab[1], 10) : 0;
      behind = bd ? parseInt(bd[1], 10) : 0;
    } else {
      const x = line[0];
      const y = line[1];
      let p = line.slice(3);
      let orig;
      const rm = p.match(/^(.+?)\s+->\s+(.+)$/); // 重命名：old -> new
      if (rm) { orig = rm[1]; p = rm[2]; }
      changes.push({ x, y, path: p.replace(/"/g, ''), orig });
    }
  }
  const commits = count.ok ? parseInt(count.stdout.trim(), 10) || 0 : 0;
  return {
    ok: true,
    branch: branch || null,
    upstream: upstream || null,
    ahead, behind,
    head: head.ok ? head.stdout.trim() : null,
    commits,
    dirty: changes.length > 0,
    changes,
    log: (log.stdout || '').split('\n').filter(Boolean).map((l) => {
      const [sha, subject, when] = l.split('\t');
      return { sha, subject, when };
    }),
  };
}

module.exports = { run, projectStats, filetree, gitStatus, flutterBin, gitBin, adbBin };
