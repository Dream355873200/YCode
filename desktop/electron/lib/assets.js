// 用户资产目录（设置页自建的模式/插件/提示词组/技能）：
// FLAI_USER_DIR > %APPDATA%/amobilecreater，与引擎 userRoot() 同一解析规则。
// 写入/删除/复制目标一律限定在该目录内——设置页编辑器只动用户资产，
// 内置资产只读（「复制为自定义」后再改）。
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function userRoot() {
  return process.env.FLAI_USER_DIR || path.join(app.getPath('appData'), 'amobilecreater');
}

/** 解析并校验目标路径在用户资产目录内（不含根本身）；越界抛错。 */
function inside(p) {
  const root = path.resolve(userRoot());
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`路径不在用户资产目录内: ${p}`);
  }
  return abs;
}

const wrap = (fn) => { try { return { ok: true, ...(fn() || {}) }; } catch (e) { return { ok: false, error: e.message }; } };

function register(ipcMain) {
  ipcMain.handle('assets:root', () => userRoot());
  ipcMain.handle('assets:exists', (_e, p) => fs.existsSync(path.resolve(userRoot(), p)));
  ipcMain.handle('assets:write', (_e, p, content) => wrap(() => {
    const abs = inside(p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    return { path: abs };
  }));
  ipcMain.handle('assets:mkdir', (_e, p) => wrap(() => {
    const abs = inside(p);
    fs.mkdirSync(abs, { recursive: true });
    return { path: abs };
  }));
  ipcMain.handle('assets:rm', (_e, p) => wrap(() => {
    fs.rmSync(inside(p), { recursive: true, force: true });
  }));
  // 复制为自定义：源可在任意位置（内置资产），目标须在用户资产目录内且不存在
  ipcMain.handle('assets:copy', (_e, src, dest) => wrap(() => {
    const abs = inside(dest);
    if (fs.existsSync(abs)) throw new Error(`目标已存在: ${abs}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.cpSync(src, abs, { recursive: true });
    return { path: abs };
  }));
}

module.exports = { userRoot, register };
