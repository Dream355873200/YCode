#!/usr/bin/env node
// launch.js -- blender 插件的 MCP 启动器：自动探测本机 blender.exe，
// 注入 BLENDER_BIN 后拉起官方 @pobruno/blender-agent（上游零改动）。
//
// 探测顺序：
//   1. 环境变量 BLENDER_BIN
//   2. 用户显式配置 ~/.amobilecreater/blender.json {"blenderBin": "..."}
//   3. 注册表 blendfile 打开关联（Blender 安装器写入，MSI/官网版覆盖）
//   4. PATH 上的 blender
//   5. 常见安装目录（Program Files / LocalAppData Programs）
//   6. Steam 库（libraryfolders.vdf 解析，覆盖 Steam 版安装）
// 全部落空则不设 BLENDER_BIN 交给上游默认查找，并在 stderr 提示。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const VERSION = '0.1.1';

function existsBlender(p) {
  try { return p && fs.statSync(p).isFile() && /blender(\.exe)?$/i.test(p); } catch { return false; }
}

function fromConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.amobilecreater', 'blender.json'), 'utf8'));
    if (existsBlender(j.blenderBin)) return j.blenderBin;
  } catch { /* 无配置文件 */ }
  return null;
}

function fromRegistry() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Classes\\blendfile\\shell\\open\\command', '/ve'], { encoding: 'utf8', timeout: 5000 });
    const m = out.match(/"([^"]+blender[^"]*\.exe)"\s*(?:"%1")?/i);
    if (m && existsBlender(m[1])) return m[1];
  } catch { /* 无关联 */ }
  return null;
}

function fromPath() {
  try {
    const out = execFileSync('where', ['blender'], { encoding: 'utf8', timeout: 5000 });
    const p = out.trim().split(/\r?\n/)[0];
    if (existsBlender(p)) return p;
  } catch { /* 不在 PATH */ }
  return null;
}

function fromCommonPaths() {
  const candidates = [];
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env['LOCALAPPDATA'] + '\\Programs'].filter(Boolean);
  for (const r of roots) {
    const base = path.join(r, 'Blender Foundation');
    try {
      for (const d of fs.readdirSync(base)) candidates.push(path.join(base, d, 'blender.exe'));
    } catch { /* 无该目录 */ }
    candidates.push(path.join(r, 'Blender', 'blender.exe'));
  }
  return candidates.find(existsBlender) || null;
}

function steamLibraries() {
  const out = [];
  try {
    const vdf = fs.readFileSync(path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) out.push(m[1].replace(/\\\\/g, '\\'));
  } catch { /* Steam 不在默认位置 */ }
  try { // 其他盘的 SteamLibrary 目录（常见手动加库位置）
    for (const d of fs.readdirSync('/')) { /* POSIX 根，win 上跳过 */ }
  } catch { /* 非 POSIX */ }
  for (const drive of 'CDEFGH'.split('')) {
    out.push(`${drive}:\\SteamLibrary`);
    out.push(`${drive}:\\Steam\\steamapps`);
  }
  return [...new Set(out)];
}

function fromSteam() {
  for (const lib of steamLibraries()) {
    const p = path.join(lib, 'steamapps', 'common', 'Blender', 'blender.exe');
    if (existsBlender(p)) return p;
  }
  return null;
}

function detectBlender() {
  return process.env.BLENDER_BIN || fromConfig() || fromRegistry() || fromPath() || fromCommonPaths() || fromSteam();
}

const bin = detectBlender();
const env = { ...process.env, BLENDER_PORT: process.env.BLENDER_PORT || '9877' };
if (bin) {
  env.BLENDER_BIN = bin;
  console.error(`[blender-launch] blender.exe: ${bin}`);
} else {
  console.error('[blender-launch] 未找到 blender.exe——安装 Blender 后重试，或在 ~/.amobilecreater/blender.json 写 {"blenderBin": "路径"}');
}

const child = spawn('npx', ['-y', `@pobruno/blender-agent@${VERSION}`], {
  env, stdio: 'inherit', shell: process.platform === 'win32',
});
child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
