#!/usr/bin/env node
// video-studio MCP server（stdio，零依赖）——视频智能体的「眼睛和检查器」。
//
// 组装原则：能用现成的不自己写。文件读写 = YCode 原生文件工具；渲染/预览 =
// Remotion CLI（npx remotion render / studio，工程内 node_modules）；版本 = git。
// 这个 server 只补三件原生工具做不到的事：
//   check_project  注册表重生成 + manifest 校验 + 逐帧确定性扫描 + tsc
//   inspect_frames 渲染关键帧并以内联图片附给模型（模型不看画面不交付）
//   view_image     把任意素材图以内联图片附给模型
// 工程目录由调用方显式传 dir（= YCode 项目目录，无隐藏状态）。
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ---------- 工程目录解析 ----------

let lastDir = null;
function resolveDir(a) {
  const dir = path.resolve(String(a.dir || lastDir || "").trim());
  if (!fs.existsSync(path.join(dir, "src", "index.ts"))) {
    throw new Error(`不是视频工程目录：${dir}（缺少 src/index.ts）——先用 init_project 初始化，或确认 dir 传的是视频项目根目录`);
  }
  lastDir = dir;
  return dir;
}
const DIR = { type: "string", description: "视频项目根目录（绝对路径，即当前项目目录）" };

// ---------- registry.gen.ts 重生成（场景组件静态导入表） ----------

function generateRegistry(dir) {
  const scenesDir = path.join(dir, "src", "scenes");
  let files = [];
  try {
    files = fs.readdirSync(scenesDir).filter((f) => f.toLowerCase().endsWith(".tsx")).sort();
  } catch { return false; }
  let s = '// 自动生成（视频工坊维护）——请勿编辑。\n';
  s += '// src/scenes/ 下每个 .tsx 场景组件的静态导入表；film 按 manifest 场景的 component 字段查表。\n';
  s += 'import type React from "react";\n';
  s += 'import type { SceneProps } from "./props";\n';
  files.forEach((name, i) => { s += `import * as m${i} from "../scenes/${name.replace(/\.tsx$/, "")}";\n`; });
  s += "\nconst pick = (m: Record<string, unknown>): React.ComponentType<SceneProps> | undefined =>\n";
  s += '  (m as { default?: React.ComponentType<SceneProps> }).default;\n\n';
  s += "export const registry: Record<string, React.ComponentType<SceneProps> | undefined> = {\n";
  files.forEach((name, i) => { s += `  ${JSON.stringify(name)}: pick(m${i} as Record<string, unknown>),\n`; });
  s += "};\n";
  const target = path.join(dir, "src", "studio", "registry.gen.ts");
  try { if (fs.readFileSync(target, "utf8") === s) return false; } catch { /* 首次生成 */ }
  fs.writeFileSync(target, s);
  return true;
}

// ---------- manifest：时长 / 时间线 ----------

const TRANSITION_TYPES = ["fade", "slide", "wipe", "flip", "clock-wipe", "zoom", "blur"];
const THEME_PRESETS = ["aurora", "candy", "cinema", "corporate", "forest", "ink", "midnight", "mono", "neon", "paper", "sunrise"];

function parseDuration(v, fps) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === "string") {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|秒)?\s*$/.exec(v);
    if (m) return m[2] ? Math.round(parseFloat(m[1]) * fps) : Math.round(parseFloat(m[1]));
  }
  return null;
}

function readManifest(dir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "src", "scenes", "manifest.json"), "utf8"));
  const fps = raw.format?.fps ?? raw.fps ?? 30;
  const scenes = (raw.scenes || []).map((sc, index) => {
    const duration = parseDuration(sc.duration, fps) ?? Math.round(fps * 4);
    let trans = null;
    if (index > 0 && sc.transition && sc.transition !== "none") {
      const spec = typeof sc.transition === "string" ? { type: sc.transition } : sc.transition;
      if (TRANSITION_TYPES.includes(spec.type)) {
        trans = { type: spec.type, duration: parseDuration(spec.duration, fps) ?? Math.round(fps * 0.5) };
      }
    }
    return { index, id: sc.id, title: sc.title || sc.id, component: sc.component || `${sc.id}.tsx`, duration, transition: trans };
  });
  let from = 0;
  for (const sc of scenes) { sc.from = from; from += sc.duration - (sc.transition ? sc.transition.duration : 0); }
  return {
    raw, fps,
    width: raw.format?.width ?? raw.width ?? 1920,
    height: raw.format?.height ?? raw.height ?? 1080,
    theme: typeof raw.theme === "string" ? raw.theme : (raw.theme?.preset ?? "midnight"),
    scenes, durationInFrames: Math.max(0, from),
  };
}

function timecode(frame, fps) {
  const total = Math.max(0, frame) / (fps || 30);
  const s = Math.floor(total);
  const f = Math.max(0, frame) % (fps || 30);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

function manifestSummary(dir) {
  const m = readManifest(dir);
  const lines = [
    `整片：${m.raw.title || "未命名"} · ${m.width}x${m.height} @${m.fps}fps · 主题 ${m.theme}`,
    `时长 ${timecode(m.durationInFrames, m.fps)}（${m.durationInFrames} 帧）· ${m.scenes.length} 个场景`,
  ];
  for (const sc of m.scenes) {
    lines.push(`  ${sc.index + 1}. ${sc.title}（${sc.component}，${sc.duration} 帧 @${timecode(sc.from, m.fps)}${sc.transition ? `，转场 ${sc.transition.type} ${sc.transition.duration} 帧` : ""}）`);
  }
  return lines.join("\n");
}

// ---------- 确定性 / 白名单扫描 ----------

const DETERMINISM_RULES = [
  { re: /Math\.random\s*\(/, why: "Math.random 逐帧不确定（用 seeded(\"种子\") 或 @remotion/noise）" },
  { re: /Date\.now\s*\(|new Date\s*\(/, why: "取真实时间逐帧不确定（动画一律由 useCurrentFrame 推导）" },
  { re: /setTimeout\s*\(|setInterval\s*\(|requestAnimationFrame\s*\(/, why: "定时器逐帧不确定（用 interpolate/spring/useEnterExit）" },
  { re: /\bfetch\s*\(|localStorage|sessionStorage/, why: "渲染环境无网络与存储（数据作为场景 data/props 传入）" },
  { re: /useFrame\s*\(/, why: "R3F 的 useFrame 按真实时间跑（旋转位移从 useCurrentFrame 算出写进 props）" },
];
const ALLOWED_IMPORT = /^(react|react-dom|remotion|@remotion\/[a-z-]+|lucide-react|three|@react-three\/fiber|d3($|\/)|gsap|lottie-web|\.\.?\/)/;

function scanSource(rel, src) {
  const errs = [];
  for (const rule of DETERMINISM_RULES) {
    const m = rule.re.exec(src);
    if (m) errs.push(`${rel}:${src.slice(0, m.index).split("\n").length}  ${rule.why}`);
  }
  if (/(^|\n)\s*import .*from ["']gsap["']/.test(src) && /(^|\n)[^/]*\bgsap\.(to|from|fromTo)\s*\(/.test(src)) {
    errs.push(`${rel}  gsap 直接补间按真实时间跑——只允许 gsap.timeline({ paused: true }) 后按帧 seek`);
  }
  src.split("\n").forEach((line, i) => {
    const im = /^\s*import\s+(?:type\s+)?[^'"()]*?from\s+["']([^"']+)["']/.exec(line)
      || /^\s*import\s+["']([^"']+)["']/.exec(line);
    if (im && !ALLOWED_IMPORT.test(im[1])) {
      errs.push(`${rel}:${i + 1}  依赖不在白名单：${im[1]}（可用：react / remotion / @remotion/* / lucide-react / three / @react-three/fiber / d3 / gsap / lottie-web / 相对路径）`);
    }
  });
  return errs;
}

function scanAssets(dir, rel, src) {
  const errs = [];
  const refs = new Set();
  for (const m of src.matchAll(/asset\(\s*["']([^"']+)["']\s*\)|(?:src|poster)=\{?["']\/?\.?\/?(?:public\/)?((?:uploads|assets|clips)\/[^"']+)["']/g)) {
    refs.push(m[1] || m[2]);
  }
  for (const ref of refs) {
    const clean = ref.replace(/^\.?\/+/, "").replace(/^public\//, "").split("?")[0];
    if (/^(https?:|data:|blob:)/.test(clean)) continue;
    if (!fs.existsSync(path.join(dir, "public", clean))) {
      errs.push(`${rel}  素材不存在：public/${clean}`);
    }
  }
  return errs;
}

function validateManifest(dir) {
  const errs = [];
  const warn = [];
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, "src", "scenes", "manifest.json"), "utf8"));
  } catch (e) {
    return { errs: [`manifest.json 解析失败：${e.message}`], warn };
  }
  const w = raw.format?.width ?? 1920, h = raw.format?.height ?? 1080, fps = raw.format?.fps ?? 30;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w % 2 || h % 2 || w < 240 || w > 3840 || h < 240 || h > 3840) {
    errs.push(`画幅 ${w}x${h} 非法（宽高须为 240-3840 的偶数）`);
  }
  if (!Number.isInteger(fps) || fps < 12 || fps > 60) errs.push(`fps ${fps} 非法（12-60）`);
  const themeName = typeof raw.theme === "string" ? raw.theme : raw.theme?.preset;
  if (themeName && !THEME_PRESETS.includes(themeName)) warn.push(`未知主题预设 ${themeName}（可用：${THEME_PRESETS.join(" ")}，将回落 midnight）`);
  const m = readManifest(dir);
  if (m.durationInFrames > 600 * fps) errs.push(`整片时长 ${timecode(m.durationInFrames, fps)} 超过 600 秒上限`);
  const ids = new Set();
  for (const sc of m.scenes) {
    if (ids.has(sc.id)) errs.push(`场景 id 重复：${sc.id}`);
    ids.add(sc.id);
    const file = path.join(dir, "src", "scenes", sc.component);
    if (!fs.existsSync(file)) {
      errs.push(`场景组件不存在：src/scenes/${sc.component}（${sc.title}）——先创建文件`);
    } else if (!/export\s+default/.test(fs.readFileSync(file, "utf8"))) {
      errs.push(`src/scenes/${sc.component} 缺少 export default（场景组件必须默认导出）`);
    }
  }
  if (!m.scenes.length) errs.push("manifest.scenes 为空：至少要有一个场景");
  return { errs, warn };
}

// ---------- 进程辅助 ----------

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    // 只有 .cmd/.bat 或显式要求时才走 shell；其余直接 spawn，参数（含空格的浏览器路径）原样传递。
    const wantsShell = opts.shell ?? (process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd));
    // shell:true 时 Node 只做空格拼接不转义——带空格的参数（如浏览器路径）必须自己加引号
    const line = wantsShell ? [cmd, ...args].map((a) => (/[ "	]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a)).join(" ") : null;
    const p = spawn(wantsShell ? line : cmd, wantsShell ? [] : args, { cwd: opts.cwd, env: process.env, shell: wantsShell, windowsHide: true });
    let out = "", err = "", done = false;
    const finish = (code) => { if (!done) { done = true; resolve({ code, out, err }); } };
    const timer = opts.timeoutMs ? setTimeout(() => {
      try {
        if (process.platform === "win32") spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
        else p.kill("SIGKILL");
      } catch { /* 已退出 */ }
      finish(-2);
    }, opts.timeoutMs) : null;
    p.stdout.on("data", (c) => { out += c; if (out.length > 30000) out = out.slice(-15000); });
    p.stderr.on("data", (c) => { err += c; if (err.length > 30000) err = err.slice(-15000); });
    p.on("error", (e) => { if (timer) clearTimeout(timer); finish(-1); err += String(e.message); });
    p.on("close", (code) => { if (timer) clearTimeout(timer); finish(code); });
  });
}

// 系统浏览器优先：Remotion 首次渲染会从 googleapis 下载 chrome-headless-shell
// 到项目 node_modules（国内网络经常卡死/半截），机器上现成的 Chrome/Edge 完全
// 能干同样的活——检测到就直接用，零下载。
const BROWSER_CANDIDATES = [
  process.env.REMOTION_BROWSER_EXECUTABLE,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  process.env.LOCALAPPDATA + "/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
let browserPath; // undefined=未检测
function browserArgs() {
  if (browserPath === undefined) {
    browserPath = null;
    for (const c of BROWSER_CANDIDATES) {
      try { fs.accessSync(c); browserPath = c; break; } catch { /* 下一个 */ }
    }
  }
  return browserPath ? ["--browser-executable", browserPath] : [];
}

// 从 dir 向上找含 remotion 的 node_modules（工程可能在共享运行时的子目录）
function findRuntimeRoot(dir) {
  let cur = dir;
  for (let i = 0; i < 8 && cur; i++) {
    if (fs.existsSync(path.join(cur, "node_modules", "remotion", "package.json"))) return cur;
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return null;
}

// Remotion CLI：直调 .bin（跳过 npx 解析）；未安装时报可恢复错误。
// timeoutMs 到点杀进程树（shell:true 拉起的 .cmd 链要整树杀）。
async function remotion(dir, args, timeoutMs = 8 * 60_000) {
  const root = findRuntimeRoot(dir);
  if (!root) {
    throw new Error("工程还没装依赖：先在项目目录执行 npm install（Bash），完成后重试");
  }
  const bin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "remotion.cmd" : "remotion");
  // CLI 入口是 @remotion/cli 包根的 remotion-cli.js（package.json bin 指向它）；
  // dist/index.js 是库入口——跑了就静默退出、什么都不做，绝不能用。
  const cli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
  // 优先直接 node 跑 CLI 入口：绕开 .cmd 转发，带空格的参数（浏览器路径）不会被 cmd 拆开
  if (fs.existsSync(cli)) {
    return runCmd(process.execPath, [cli, ...args], { cwd: dir, timeoutMs, shell: false });
  }
  const useBin = fs.existsSync(bin);
  return runCmd(useBin ? bin : "npx", useBin ? args : ["remotion", ...args], { cwd: dir, timeoutMs, shell: true });
}

// 渲染命令提示：把解析出的绝对 CLI 路径告诉 agent，免得它自己猜入口踩库入口的坑
function renderHint(dir) {
  const root = findRuntimeRoot(dir);
  if (!root) return "";
  const cli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
  if (!fs.existsSync(cli)) return "";
  return `渲染成片命令（CLI 入口必须用 remotion-cli.js；remotion 主包的 dist/index.js 是库入口，跑了会静默退出）：
node "${cli}" render src/index.ts Film out/final.mp4 --codec h264`;
}

// bundle 内容寻址缓存：src+public 指纹不变就直接复用（省 15-30s/次）。
// 临时目录原子改名发布，避免并发/中断留下半成品被误用。
const crypto = require("crypto");
function srcFingerprint(dir) {
  const h = crypto.createHash("sha256");
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else { h.update(name); h.update(String(st.size)); h.update(String(Math.floor(st.mtimeMs / 1000))); }
    }
  };
  walk(path.join(dir, "src"));
  try { walk(path.join(dir, "public")); } catch { /* public 可选 */ }
  return h.digest("hex").slice(0, 12);
}
async function ensureBundle(dir) {
  const key = srcFingerprint(dir);
  const bundleDir = path.join(dir, "out", `.vsbundle-${key}`);
  if (fs.existsSync(path.join(bundleDir, "index.html")) && fs.existsSync(path.join(bundleDir, ".vsbundle-key"))) {
    return bundleDir;
  }
  const outRoot = path.join(dir, "out");
  try {
    for (const f of fs.readdirSync(outRoot)) {
      if (f.startsWith(".vsbundle-") || f === ".vsbundle") fs.rmSync(path.join(outRoot, f), { recursive: true, force: true });
    }
  } catch { /* out 可能还没有 */ }
  fs.mkdirSync(outRoot, { recursive: true });
  const tmp = path.join(outRoot, `.vsbundle-tmp-${Date.now().toString(36)}`);
  const b = await remotion(dir, ["bundle", "src/index.ts", "--out-dir", tmp]);
  if (b.code !== 0) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败无妨 */ }
    throw new Error(`打包失败：${(b.err || b.out).slice(-800)}`);
  }
  fs.renameSync(tmp, bundleDir);
  fs.writeFileSync(path.join(bundleDir, ".vsbundle-key"), key);
  return bundleDir;
}

// 渲染作业串行（桌面单用户足够）
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

// ---------- 工具定义 ----------

const tools = [];
const def = (name, description, inputSchema, handler) =>
  tools.push({ name, description, inputSchema, handler });
const P = (description) => ({ type: "string", description });

def("init_project",
  "把视频工程结构初始化进一个目录（模板：场景体系/组件库/manifest/package.json + brief/storyboard）。" +
  "目录里已有 src/index.ts 时什么都不做直接返回；补齐缺失文件、绝不覆盖你或用户已改过的文件。切到视频工程却没有 src/index.ts 时先调它。",
  {
    type: "object",
    properties: { dir: P("项目目录（绝对路径）；不存在会自动创建") },
    required: ["dir"],
  },
  async (a) => {
    const dir = path.resolve(String(a.dir || "").trim());
    if (!dir) throw new Error("dir 必填（项目目录绝对路径）");
    if (fs.existsSync(path.join(dir, "src", "index.ts"))) {
      return `已是视频工程（${dir}），无需初始化。

${manifestSummary(dir)}`;
    }
    // 安全合并：目标已存在的文件一律跳过（不覆盖用户/你的改动）
    let copied = 0;
    const merge = (src, dest) => {
      fs.mkdirSync(dest, { recursive: true });
      for (const name of fs.readdirSync(src)) {
        const s = path.join(src, name);
        const d = path.join(dest, name);
        if (fs.statSync(s).isDirectory()) merge(s, d);
        else if (!fs.existsSync(d)) { fs.copyFileSync(s, d); copied += 1; }
      }
    };
    const template = path.join(__dirname, "..", "template");
    if (!fs.existsSync(path.join(template, "src"))) throw new Error(`模板缺失：${template}`);
    merge(template, dir);
    const name = path.basename(dir);
    if (!fs.existsSync(path.join(dir, "brief.md"))) {
      fs.writeFileSync(path.join(dir, "brief.md"), `# ${name}

## 需求

（用户会在对话里补充）
`);
    }
    if (!fs.existsSync(path.join(dir, "storyboard.md"))) {
      fs.writeFileSync(path.join(dir, "storyboard.md"), `# 分镜：${name}

（待写：每段的目的、画面、文案、时长、转场）
`);
    }
    generateRegistry(dir);
    // 不是 git 仓库就初始化并首提交（失败不打紧，只是没有版本记录）
    if (!fs.existsSync(path.join(dir, ".git"))) {
      await runCmd("git", ["init"], { cwd: dir });
      await runCmd("git", ["add", "."], { cwd: dir });
      await runCmd("git", ["commit", "-m", `init: ${name}`], { cwd: dir });
    }
    return `视频工程已初始化到 ${dir}（补了 ${copied} 个文件；已有文件原样保留）。

接下来：读 brief.md → 没装依赖先 npm install → 写分镜与场景。

${manifestSummary(dir)}

${renderHint(dir)}`;
  });

def("render_thumbs",
  "为每个场景渲染一张缩略图到 out/thumbs/<场景id>.jpg。改完 manifest 或场景后跑一次（很便宜，每场景一帧小图），右栏「视频预览」面板的分镜条会跟着更新。",
  { type: "object", properties: { dir: DIR }, required: ["dir"] },
  async (a) => {
    const dir = resolveDir(a);
    const m = readManifest(dir);
    return serial(async () => {
      const bundleDir = await ensureBundle(dir);
      const thumbsDir = path.join(dir, "out", "thumbs");
      fs.mkdirSync(thumbsDir, { recursive: true });
      const valid = new Set(m.scenes.map((s) => s.id));
      try {
        for (const f of fs.readdirSync(thumbsDir)) {
          if (f.endsWith(".jpg") && !valid.has(f.replace(/\.jpg$/, ""))) fs.rmSync(path.join(thumbsDir, f), { force: true });
        }
      } catch { /* 清理失败无妨 */ }
      for (const sc of m.scenes) {
        const at = sc.from + Math.floor(sc.duration * 0.45); // 入场完成后
        const out = path.join(thumbsDir, `${sc.id}.jpg`);
        const r = await remotion(dir, ["still", bundleDir, "Film", out,
          "--frame", String(at), "--image-format=jpeg", "--jpeg-quality=75", "--scale=0.22"]);
        if (r.code !== 0 || !fs.existsSync(out)) {
          throw new Error(`场景 ${sc.id} 缩略图渲染失败：${(r.err || r.out).slice(-500)}`);
        }
      }
      return `已生成 ${m.scenes.length} 张场景缩略图（out/thumbs/），右栏分镜条已更新。`;
    });
  });

// ---------- MCP stdio 循环

def("check_project",
  "视频工程全量检查：重生成场景注册表、manifest 校验、逐帧确定性规则扫描、TypeScript 类型检查。写完代码必须跑，交付/导出前必须全绿。",
  { type: "object", properties: { dir: DIR }, required: ["dir"] },
  async (a) => {
    const dir = resolveDir(a);
    generateRegistry(dir);
    const { errs, warn } = validateManifest(dir);
    const scan = [];
    const scenesDir = path.join(dir, "src", "scenes");
    for (const f of fs.readdirSync(scenesDir)) {
      if (!f.toLowerCase().endsWith(".tsx")) continue;
      const src = fs.readFileSync(path.join(scenesDir, f), "utf8");
      scan.push(...scanSource(`src/scenes/${f}`, src), ...scanAssets(dir, `src/scenes/${f}`, src));
    }
    const libDir = path.join(dir, "src", "lib");
    if (fs.existsSync(libDir)) {
      for (const f of fs.readdirSync(libDir)) {
        if (!/\.(tsx?|css)$/.test(f)) continue;
        scan.push(...scanSource(`src/lib/${f}`, fs.readFileSync(path.join(libDir, f), "utf8")));
      }
    }
      const runtimeRoot = findRuntimeRoot(dir);
  const tscBin = runtimeRoot ? path.join(runtimeRoot, "node_modules", "typescript", "bin", "tsc") : null;
    let types = "";
    if (tscBin && fs.existsSync(tscBin)) {
      const r = await runCmd(process.execPath, [tscBin, "--noEmit", "-p", dir], { cwd: dir });
      if (r.code !== 0) {
        const lines = r.out.split("\n").filter((l) => /error TS/.test(l));
        types = lines.length
          ? `类型检查 ${lines.length} 条错误：\n${lines.slice(0, 30).join("\n")}`
          : `tsc 退出码 ${r.code}：${(r.out + r.err).slice(-400)}`;
      }
    } else {
      types = "（未安装依赖，跳过类型检查——先在项目目录 npm install）";
    }
    const parts = [];
    if (errs.length) parts.push(`【manifest 错误】\n${errs.join("\n")}`);
    if (scan.length) parts.push(`【逐帧规则违反】\n${scan.slice(0, 30).join("\n")}`);
    if (types) parts.push(`【类型】${types}`);
    if (parts.length) return `检查未通过（${parts.length} 类问题）：\n\n${parts.join("\n\n")}`;
    return `检查通过${warn.length ? `\n提醒：\n${warn.join("\n")}` : ""}\n\n${manifestSummary(dir)}\n\n${renderHint(dir)}`;
  });

// ---------- 抽帧 ----------

function autoStillFrames(m, sceneID, count) {
  if (count <= 0) count = 6;
  const pick = (from, dur, n) => Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? 0.3 + (0.62 * i) / (n - 1) : 0.62;
    return from + Math.floor((dur - 1) * t);
  });
  if (sceneID) {
    const sc = m.scenes.find((s) => s.id === sceneID || s.component === sceneID);
    if (!sc) throw new Error(`场景不存在：${sceneID}（manifest 里的场景 id）`);
    return [...new Set(pick(sc.from, sc.duration, Math.min(count, 6)))];
  }
  if (!m.scenes.length) return [0];
  if (m.scenes.length >= count) {
    return [...new Set(Array.from({ length: count }, (_, i) => Math.floor((m.durationInFrames - 1) * (i + 0.5) / count)))];
  }
  const alloc = m.scenes.map(() => 1);
  let left = count - m.scenes.length;
  const order = m.scenes.map((s, i) => [s.duration, i]).sort((x, y) => y[0] - x[0]);
  for (let k = 0; k < order.length && left > 0; k++) { alloc[order[k][1]] += 1; left -= 1; }
  const out = [];
  m.scenes.forEach((sc, i) => out.push(...pick(sc.from, sc.duration, Math.min(alloc[i], 6))));
  return [...new Set(out)].sort((x, y) => x - y);
}

function sceneAt(m, frame) {
  let cur = m.scenes[0];
  for (const sc of m.scenes) { if (frame >= sc.from) cur = sc; }
  return cur;
}

def("inspect_frames",
  "渲染关键帧并把画面附给模型自查（默认整片均匀 6 帧；scene+frames 看指定场景动效）。这是你看画面的唯一方式——交付前必须看过。",
  {
    type: "object",
    properties: {
      dir: DIR,
      scene: P("只看某个场景（manifest 里的场景 id）；看动效时与 frames 搭配"),
      frames: { type: "array", items: { type: "integer" }, description: "该场景内的相对帧（如 [0,6,12,18,24,30]，4-8 帧看动效）" },
      count: { type: "integer", description: "整片模式下的帧数（缺省 6，≤9）" },
    },
  },
  async (a) => {
    const dir = resolveDir(a);
    const m = readManifest(dir);
    const scene = a.scene ? m.scenes.find((s) => s.id === a.scene || s.component === a.scene) : null;
    let frames;
    if (scene && Array.isArray(a.frames) && a.frames.length) {
      frames = a.frames.map((f) => Math.max(scene.from, Math.min(scene.from + scene.duration - 1, scene.from + Math.round(f))));
    } else {
      frames = autoStillFrames(m, a.scene || "", a.count || 6);
    }
    return serial(async () => {
      const bundleDir = await ensureBundle(dir);
      const stillsDir = path.join(dir, "out", ".vsstills");
      fs.rmSync(stillsDir, { recursive: true, force: true });
      fs.mkdirSync(stillsDir, { recursive: true });
      for (const f of frames) {
        const out = path.join(stillsDir, `frame_${String(f).padStart(5, "0")}.jpg`);
        const r = await remotion(dir, ["still", bundleDir, "Film", out,
          "--frame", String(f), "--image-format=jpeg", "--jpeg-quality=70", "--scale=0.4", ...browserArgs()]);
        if (r.code !== 0 || !fs.existsSync(out)) {
          throw new Error(`第 ${f} 帧渲染失败：${(r.err || r.out).slice(-800)}`);
        }
      }
      const labels = frames.map((f, i) => {
        const sc = sceneAt(m, f);
        return `#${i + 1} 帧 ${f}（${timecode(f, m.fps)}）· 场景「${sc.title}」src/scenes/${sc.component}`;
      });
      const parts = frames.map((f, i) => {
        const buf = fs.readFileSync(path.join(stillsDir, `frame_${String(f).padStart(5, "0")}.jpg`));
        if (buf.length > 120 * 1024) return `#${i + 1}（帧 ${f}）图过大未内联：${path.join(stillsDir, `frame_${String(f).padStart(5, "0")}.jpg`)}`;
        return `[IMAGE jpeg ${buf.toString("base64")}]\n${labels[i]}`;
      });
      // 顺带刷新每场景缩略图（同一次 bundle，右栏分镜条跟着更新）
      try {
        const thumbsDir = path.join(dir, "out", "thumbs");
        fs.mkdirSync(thumbsDir, { recursive: true });
        const valid = new Set(m.scenes.map((sc) => sc.id));
        try {
          for (const f of fs.readdirSync(thumbsDir)) {
            if (f.endsWith(".jpg") && !valid.has(f.replace(/\.jpg$/, ""))) fs.rmSync(path.join(thumbsDir, f), { force: true });
          }
        } catch { /* 清理失败无妨 */ }
        for (const sc of m.scenes) {
          const at = sc.from + Math.floor(sc.duration * 0.45);
          const out2 = path.join(thumbsDir, `${sc.id}.jpg`);
          if (!fs.existsSync(out2) || Date.now() - fs.statSync(out2).mtimeMs > 60_000) {
            const r2 = await remotion(dir, ["still", bundleDir, "Film", out2,
              "--frame", String(at), "--image-format=jpeg", "--jpeg-quality=75", "--scale=0.22", ...browserArgs()]);
            if (r2.code !== 0) break; // 缩略图失败不影响本次自查结果
          }
        }
      } catch { /* 缩略图是附赠品，失败不阻断 */ }
      return { __frames: { parts, labels, frames } };
    });
  });

def("view_image",
  "把一张素材图（public/ 下的用户上传/生成图片，或任意本地图片）附给模型查看。jpg/png/webp/gif 均可。",
  { type: "object", properties: { path: P("图片路径（绝对路径，或相对项目目录）"), dir: DIR }, required: ["path"] },
  async (a) => {
    const base = a.dir ? path.resolve(String(a.dir)) : lastDir || process.cwd();
    const abs = path.isAbsolute(String(a.path)) ? path.resolve(String(a.path)) : path.resolve(base, String(a.path));
    if (!fs.existsSync(abs)) throw new Error(`图片不存在：${abs}`);
    const ext = path.extname(abs).toLowerCase();
    const media = ext === ".jpg" || ext === ".jpeg" ? "jpeg" : ext === ".png" ? "png" : ext === ".webp" ? "webp" : ext === ".gif" ? "gif" : null;
    if (!media) throw new Error(`不支持的图片格式：${ext}（jpg/png/webp/gif）`);
    const buf = fs.readFileSync(abs);
    if (buf.length > 300 * 1024) throw new Error(`图片过大（${(buf.length / 1024).toFixed(0)}KB > 300KB），无法内联`);
    return { __image: { b64: buf.toString("base64"), media, abs } };
  });

// ---------- MCP stdio 循环（与其它自带 server 同一约定：回包带 jsonrpc，通知静默） ----------

const textResult = (text, isError) => ({ content: [{ type: "text", text: String(text) }], isError: !!isError });

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return null; // 通知不回包
  try {
    if (method === "initialize") {
      return {
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "video-studio", version: "2.0.0" },
        },
      };
    }
    if (method === "tools/list") {
      return { id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
    }
    if (method === "tools/call") {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return { id, result: textResult(`未知工具: ${params.name}`, true) };
      try {
        const r = await tool.handler(params.arguments || {});
        if (r && r.__image) {
          const img = r.__image;
          if (!img.b64 || img.b64.length < 100) return { id, result: textResult("图片读取失败：数据为空", true) };
          return { id, result: textResult(`[IMAGE ${img.media || "jpeg"} ${img.b64}]\n图片已附上：${img.abs}`) };
        }
        if (r && r.__frames) {
          const text = `渲染了 ${r.__frames.parts.length} 帧：\n\n${r.__frames.labels.join("\n")}\n\n逐帧自查要点：构图/排版是否溢出重叠、文字对比度、入场是否完成、节奏是否够读。有问题改代码后重跑本工具再看。\n\n${r.__frames.parts.join("\n\n")}`;
          return { id, result: textResult(text) };
        }
        return { id, result: textResult(typeof r === "string" ? r : JSON.stringify(r, null, 2)) };
      } catch (e) {
        const msg2 = String(e.message || e);
        const guidance = /npm install|不存在|未找到|失败/.test(msg2)
          ? "\n\n（可恢复失败：不是终止信号。按提示处理后立即重试；不要结束回合。）" : "";
        return { id, result: textResult(msg2 + guidance, true) };
      }
    }
    if (method === "ping") return { id, result: {} };
    return { id, error: { code: -32601, message: `Method not found: ${method}` } };
  } catch (e) {
    return { id, error: { code: -32603, message: String(e.message || e) } };
  }
}

const reply = (resp) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...resp }) + "\n");

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    handle(msg).then((resp) => { if (resp) reply(resp); });
  }
});
process.stdin.on("end", () => process.exit(0));
