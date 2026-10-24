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

// ---------- 变更审查（右栏「变更」面板） ----------

// 项目内相对路径校验：撤销/读 diff 的目标必须落在项目目录里
function inside(dir, rel) {
  const root = path.resolve(dir);
  const abs = path.resolve(root, rel);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

// 未跟踪文件的行数（新增行统计；超过 2MB 视为二进制级大文件不计）
function countLines(abs) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > 2 * 1024 * 1024) return null;
    const s = fs.readFileSync(abs, 'utf-8');
    if (s.includes('\u0000')) return null;
    if (!s) return 0;
    return s.split('\n').length - (s.endsWith('\n') ? 1 : 0);
  } catch { return null; }
}

function parseNumstat(out) {
  const files = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    let p = m[3];
    const rn = p.match(/^(.*)\{(.*) => (.*)\}(.*)$/) || p.match(/^()(.*) => (.*)()$/);
    if (rn) p = `${rn[1]}${rn[3]}${rn[4]}`.replace(/\/\//g, '/');
    files.push({ path: p, added: m[1] === '-' ? 0 : +m[1], deleted: m[2] === '-' ? 0 : +m[2], binary: m[1] === '-' });
  }
  return files;
}

// 工作区相对 HEAD 的逐文件 +/−（含未跟踪文件）；无提交的新仓库对比空树
async function gitNumstat(dir) {
  let tracked = await run('git', ['-C', dir, 'diff', '--numstat', '-M', 'HEAD']);
  if (!tracked.ok) {
    const [staged, work] = await Promise.all([
      run('git', ['-C', dir, 'diff', '--numstat', '--cached']),
      run('git', ['-C', dir, 'diff', '--numstat']),
    ]);
    if (!staged.ok && !work.ok) return { ok: false, error: tracked.stderr || tracked.error || 'git 不可用' };
    tracked = { ok: true, stdout: `${staged.stdout}\n${work.stdout}` };
  }
  const files = parseNumstat(tracked.stdout);
  const others = await run('git', ['-C', dir, 'ls-files', '--others', '--exclude-standard']);
  for (const rel of (others.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 500)) {
    const abs = inside(dir, rel);
    const n = abs ? countLines(abs) : null;
    files.push({ path: rel, added: n ?? 0, deleted: 0, binary: n === null, untracked: true });
  }
  return {
    ok: true,
    files,
    added: files.reduce((a, f) => a + f.added, 0),
    deleted: files.reduce((a, f) => a + f.deleted, 0),
  };
}

// 单文件统一 diff：已跟踪 = 工作区对 HEAD；未跟踪 = 整文件新增
async function gitDiff(dir, file, untracked) {
  if (!inside(dir, file)) return { ok: false, error: '路径越界' };
  if (untracked) {
    // --no-index 在有差异时退出码为 1，输出照常在 stdout
    const r = await run('git', ['-C', dir, 'diff', '--no-color', '--no-index', '--', '/dev/null', file]);
    return { ok: true, diff: r.stdout };
  }
  let r = await run('git', ['-C', dir, 'diff', '--no-color', '-M', 'HEAD', '--', file]);
  if (!r.ok) r = await run('git', ['-C', dir, 'diff', '--no-color', '--', file]);
  return r.ok ? { ok: true, diff: r.stdout } : { ok: false, error: r.stderr || r.error };
}

// 整体改动（生成提交说明用）：统计 + diff，截断防止撑爆请求
async function gitDiffAll(dir) {
  const [stat, diff, others] = await Promise.all([
    run('git', ['-C', dir, 'diff', '--stat', 'HEAD']),
    run('git', ['-C', dir, 'diff', '--no-color', 'HEAD']),
    run('git', ['-C', dir, 'ls-files', '--others', '--exclude-standard']),
  ]);
  const untracked = (others.stdout || '').split('\n').filter(Boolean);
  const extra = untracked.length ? `\n新增未跟踪文件：\n${untracked.slice(0, 80).join('\n')}` : '';
  return { ok: true, stat: (stat.stdout || '') + extra, diff: (diff.stdout || '').slice(0, 60_000) };
}

// 撤销单文件改动：已跟踪恢复到 HEAD；未跟踪直接删除
async function gitRestore(dir, file, untracked) {
  const abs = inside(dir, file);
  if (!abs || abs === path.resolve(dir)) return { ok: false, error: '路径越界' };
  if (untracked) {
    try { fs.rmSync(abs, { force: true }); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  let r = await run('git', ['-C', dir, 'restore', '--staged', '--worktree', '--source=HEAD', '--', file]);
  if (!r.ok) r = await run('git', ['-C', dir, 'checkout', 'HEAD', '--', file]);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.error || '').trim() };
}

// 提交全部改动
async function gitCommit(dir, message) {
  const msg = String(message || '').trim();
  if (!msg) return { ok: false, error: '提交说明不能为空' };
  const add = await run('git', ['-C', dir, 'add', '-A']);
  if (!add.ok) return { ok: false, error: (add.stderr || add.error || '').trim() };
  const c = await run('git', ['-C', dir, 'commit', '-m', msg]);
  return c.ok ? { ok: true } : { ok: false, error: (c.stderr || c.stdout || c.error || '').trim() };
}

async function gitInit(dir) {
  const r = await run('git', ['-C', dir, 'init']);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.error || '').trim() };
}

// 本地分支（最近提交在前）
async function gitBranches(dir) {
  const r = await run('git', ['-C', dir, 'branch', '--sort=-committerdate',
    '--format=%(refname:short)%09%(HEAD)%09%(committerdate:relative)']);
  if (!r.ok) return { ok: false, error: (r.stderr || r.error || '').trim() };
  const branches = r.stdout.split('\n').filter(Boolean).map((l) => {
    const [name, head, when] = l.split('\t');
    return { name, current: head === '*', when: when || '' };
  });
  return { ok: true, branches };
}

async function validBranchName(dir, name) {
  const r = await run('git', ['-C', dir, 'check-ref-format', '--branch', String(name || '')]);
  return r.ok;
}

// 切换分支（工作区有冲突改动时 git 自身会拒绝，原样回报）
async function gitCheckout(dir, name) {
  if (!(await validBranchName(dir, name))) return { ok: false, error: '分支名不合法' };
  let r = await run('git', ['-C', dir, 'switch', name]);
  if (!r.ok) r = await run('git', ['-C', dir, 'checkout', name]);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.error || '').trim() };
}

// 基于当前 HEAD 创建并切换
async function gitCreateBranch(dir, name) {
  if (!(await validBranchName(dir, name))) return { ok: false, error: '分支名不合法' };
  let r = await run('git', ['-C', dir, 'switch', '-c', name]);
  if (!r.ok) r = await run('git', ['-C', dir, 'checkout', '-b', name]);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.error || '').trim() };
}

// 推送：有上游直接推；没有上游时推到 origin 同名分支并建立跟踪
async function gitPush(dir) {
  const up = await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const r = up.ok
    ? await run('git', ['-C', dir, 'push'])
    : await run('git', ['-C', dir, 'push', '-u', 'origin', 'HEAD']);
  return r.ok ? { ok: true } : { ok: false, error: (r.stderr || r.error || '').trim() };
}

module.exports = {
  run, projectStats, filetree, gitStatus, gitNumstat, gitDiff, gitDiffAll, gitRestore, gitCommit, gitInit,
  gitBranches, gitCheckout, gitCreateBranch, gitPush,
  flutterBin, gitBin, adbBin,
};
