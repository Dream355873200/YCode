#!/usr/bin/env node
// video-edit MCP server（stdio，零依赖）——剪辑间的「校验器 + 渲染器 + 评审」。
//
// 职责边界：文件读写 = YCode 原生工具；素材内容分析 = 视频工坊的 analyze_video；
// 这个 server 只补三件别的事做不到的事：
//   probe_media  摸底单个素材（时长/分辨率/音轨）——排刀前必做
//   check_edl    剪辑决策校验（来源/时间/转场词表/时间线数学）
//   render_cut   按决策执行 ffmpeg 合成（单趟 filter graph），渲完自动终审
//   cut_review   防幻灯片六维评分——verdict 过低不许交付
// 项目目录由调用方显式传 dir：项目根放 edl.json，素材在 assets/，产物出 out/。
"use strict";
const fs = require("fs");
const path = require("path");

// ---------- 基础 ----------

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = require("child_process").spawn(cmd, args, { windowsHide: true });
    let out = "", err = "";
    let done = false;
    const finish = (code) => { if (!done) { done = true; resolve({ code, out, err }); } };
    const timer = opts.timeoutMs ? setTimeout(() => {
      try { p.kill(); } catch { /* 已退出 */ }
      if (process.platform === "win32" && p.pid) {
        try { require("child_process").spawn("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* 兜底 */ }
      }
      finish(-1); err += "\n（执行超时）";
    }, opts.timeoutMs || 15 * 60_000) : null;
    if (opts.stdinStr) { try { p.stdin.write(opts.stdinStr); p.stdin.end(); } catch { /* 输入流关闭 */ } }
    else if (p.stdin) p.stdin.end();
    p.stdout.on("data", (c) => { out += c; if (out.length > 60000) out = out.slice(-30000); });
    p.stderr.on("data", (c) => { err += c; if (err.length > 60000) err = err.slice(-30000); });
    p.on("error", (e) => { clearTimeout(timer); finish(-1); err += String(e.message); });
    p.on("close", (code) => { clearTimeout(timer); finish(code); });
  });
}

let ffmpegOk = null;
async function ensureFfmpeg() {
  if (ffmpegOk === null) ffmpegOk = (await runCmd("ffmpeg", ["-version"], { timeoutMs: 15_000 })).code === 0;
  if (!ffmpegOk) throw new Error("找不到 ffmpeg——剪辑间靠它合成，先安装并加入 PATH（https://ffmpeg.org 或 winget install Gyan.FFmpeg）");
}

async function ffprobe(file) {
  const r = await runCmd("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`ffprobe 失败：${path.basename(file)}——${(r.err || r.out).slice(-300)}`);
  return JSON.parse(r.out);
}

function mediaInfo(probe) {
  const v = (probe.streams || []).find((s) => s.codec_type === "video");
  const a = (probe.streams || []).find((s) => s.codec_type === "audio");
  const fps = v && v.avg_frame_rate ? (() => { const [x, y] = String(v.avg_frame_rate).split("/").map(Number); return y ? x / y : 0; })() : 0;
  const IMG_CODECS = ["png", "mjpeg", "jpeg", "webp", "bmp", "gif", "tiff"];
  return {
    duration: Number((probe.format && probe.format.duration) || 0),
    width: (v && v.width) || 0,
    height: (v && v.height) || 0,
    fps: Math.round(fps * 100) / 100,
    hasAudio: !!a,
    isImage: !!v && IMG_CODECS.includes(String(v.codec_name || "").toLowerCase()),
  };
}

// ---------- EDL 解析与校验 ----------

const XFADE = { fade: "fade", dissolve: "dissolve", wipe: "wipeleft", slide: "slideleft", zoom: "zoomin", fadeblack: "fadeblack", radial: "radial" };
const TRANSITION_TYPES = ["cut", "none", "fade", "dissolve", "wipe", "slide", "zoom", "fadeblack", "radial"];
const ANIMATIONS = ["static", "ken_burns_in", "ken_burns_out", "pan_left", "pan_right", "zoom_slow"];
const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];

function resolveSource(dir, p) {
  const raw = String(p || "").trim();
  if (!raw) return null;
  if (path.isAbsolute(raw)) return fs.existsSync(raw) ? raw : null;
  for (const cand of [path.join(dir, raw), path.join(dir, "assets", raw)]) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function loadEdl(dir) {
  const edlPath = path.join(dir, "edl.json");
  if (!fs.existsSync(edlPath)) throw new Error(`没有找到 ${edlPath}——剪辑项目根目录下必须有 edl.json`);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(edlPath, "utf8")); } catch (e) {
    throw new Error(`edl.json 不是合法 JSON：${e.message}`);
  }
  return raw;
}

/** 校验 EDL：返回 { errors[], warns[], tl, cuts(normalized), overlays, audio, subs, D } */
async function validateEdl(dir) {
  const edl = loadEdl(dir);
  const errors = [], warns = [];
  const tl = edl.timeline || {};
  const W = Number(tl.width) || 1920, H = Number(tl.height) || 1080, FPS = Number(tl.fps) || 30;

  const cutsIn = Array.isArray(edl.cuts) ? edl.cuts : [];
  if (!cutsIn.length) errors.push("cuts 为空——时间线上至少要有一个镜头");
  const ids = new Set();
  const probeCache = new Map();
  const probeOf = async (abs) => {
    if (!probeCache.has(abs)) probeCache.set(abs, await ffprobe(abs).then(mediaInfo).catch((e) => { throw new Error(e.message); }));
    return probeCache.get(abs);
  };

  const cuts = [];
  for (let i = 0; i < cutsIn.length; i++) {
    const c = cutsIn[i];
    const at = `cuts[${i}]${c.id ? `(${c.id})` : ""}`;
    if (c.id) {
      if (ids.has(c.id)) errors.push(`${at} id 重复：${c.id}`);
      ids.add(c.id);
    }
    const abs = resolveSource(dir, c.source);
    if (!abs) { errors.push(`${at} 素材不存在：${c.source}（相对项目根或 assets/）`); continue; }
    const info = await probeOf(abs);
    const isImg = info.isImage;
    let d, srcDur;
    if (isImg) {
      d = Number(c.duration);
      if (!(d > 0)) errors.push(`${at} 图片素材必须写 duration（秒）`);
      srcDur = null;
    } else {
      const tin = Number(c.in), tout = Number(c.out);
      if (!(tout > tin)) { errors.push(`${at} 视频素材需要合法的 in/out（out > in，秒）`); continue; }
      if (info.duration > 0 && tout > info.duration + 0.05) warns.push(`${at} out=${tout} 超过素材时长 ${info.duration.toFixed(2)}s，会被截断`);
      srcDur = tout - tin;
      d = srcDur / (Number(c.speed) || 1);
    }
    const speed = Number(c.speed) || 1;
    if (speed < 0.25 || speed > 4) errors.push(`${at} speed=${speed} 超出 0.25-4`);
    if (d > 0 && d < 0.3) warns.push(`${at} 镜头时长 ${d.toFixed(2)}s 短于 0.3s，观众反应不过来`);
    const anim = c.animation || "static";
    if (!ANIMATIONS.includes(anim)) errors.push(`${at} 未知动画 ${anim}（可选：${ANIMATIONS.join("/")}）`);
    else if (!isImg && anim !== "static") warns.push(`${at} 动画 ${anim} 只对图片素材生效，视频镜头会忽略`);
    let tr = null;
    if (c.transition && c.transition.type !== "cut" && c.transition.type !== "none") {
      if (!TRANSITION_TYPES.includes(c.transition.type)) {
        errors.push(`${at} 未知转场 ${c.transition.type}（词表：${TRANSITION_TYPES.join("/")}）`);
      } else if (i === 0) {
        warns.push(`${at} 第一个镜头的转场没有意义（前面没有画面），忽略`);
      } else {
        const dur = Number(c.transition.duration);
        if (!(dur > 0 && dur <= 3)) errors.push(`${at} 转场 duration 需在 0-3 秒之间`);
        else tr = { type: c.transition.type, duration: dur };
      }
    }
    if (!c.reason || !String(c.reason).trim()) warns.push(`${at} 缺 reason——说不出这一刀为什么存在，观众也看不出它为什么在`);
    cuts.push({ raw: c, abs, isImg, d, srcDur, speed, anim, transition: tr, rel: c.source });
  }

  // 时间线数学
  let D = 0;
  for (const c of cuts) {
    const t = c.transition ? c.transition.duration : 0;
    D += c.d - t;
  }
  if (cuts.length && D <= 0) errors.push(`时间线总时长 ${D.toFixed(2)}s 非正——转场重叠吃光了全部镜头`);
  if (D > 0 && D < 5) warns.push(`成片只有 ${D.toFixed(1)}s——确定不是在做一个镜头？`);

  // overlays
  const overlays = [];
  for (const ov of (Array.isArray(edl.overlays) ? edl.overlays : [])) {
    const abs = resolveSource(dir, ov.source);
    if (!abs) { errors.push(`overlays 素材不存在：${ov.source}`); continue; }
    const from = Number(ov.from) || 0, to = Number(ov.to) || 0;
    if (!(to > from)) { errors.push(`overlays(${ov.source}) 需要 from < to`); continue; }
    if (D > 0 && to > D + 0.05) warns.push(`overlays(${ov.source}) 结束于 ${to}s，超过成片时长 ${D.toFixed(2)}s`);
    const position = ov.position || "top-right";
    if (!POSITIONS.includes(position)) errors.push(`overlays(${ov.source}) 未知位置 ${position}（可选：${POSITIONS.join("/")}）`);
    const opacity = ov.opacity == null ? 1 : Number(ov.opacity);
    if (!(opacity > 0 && opacity <= 1)) errors.push(`overlays(${ov.source}) opacity 需在 (0,1]`);
    overlays.push({ abs, from, to, position, margin: Number(ov.margin) || Math.round(W * 0.03), opacity, scale: ov.scale == null ? null : Number(ov.scale) });
  }

  // audio
  const au = edl.audio || {};
  const audio = { music: null, narration: [], sfx: [] };
  if (au.music) {
    const abs = resolveSource(dir, au.music.source);
    if (!abs) errors.push(`audio.music 素材不存在：${au.music.source}`);
    else audio.music = { abs, volume: au.music.volume == null ? 0.5 : Number(au.music.volume), fadeIn: Number(au.music.fade_in) || 0, fadeOut: Number(au.music.fade_out) || 0, ducking: au.music.ducking !== false };
  }
  for (const n of (Array.isArray(au.narration) ? au.narration : [])) {
    const abs = resolveSource(dir, n.source);
    if (!abs) { errors.push(`audio.narration 素材不存在：${n.source}`); continue; }
    audio.narration.push({ abs, at: Math.max(0, Number(n.at) || 0) });
  }
  for (const s of (Array.isArray(au.sfx) ? au.sfx : [])) {
    const abs = resolveSource(dir, s.source);
    if (!abs) { errors.push(`audio.sfx 素材不存在：${s.source}`); continue; }
    audio.sfx.push({ abs, at: Math.max(0, Number(s.at) || 0), volume: s.volume == null ? 1 : Number(s.volume) });
  }
  if (cuts.length && !audio.music && !audio.narration.length && !audio.sfx.length) {
    warns.push("没有任何音频（music/narration/sfx 全空）——全片无声，确定要这样吗");
  }

  // subtitles
  let subs = null;
  if (edl.subtitles && edl.subtitles.source) {
    const abs = resolveSource(dir, edl.subtitles.source);
    if (!abs) errors.push(`subtitles 字幕文件不存在：${edl.subtitles.source}`);
    else subs = { abs, fontSize: Number(edl.subtitles.font_size) || 14, marginV: edl.subtitles.margin_v == null ? Math.round(H * 0.06) : Number(edl.subtitles.margin_v), outline: edl.subtitles.outline == null ? 2 : Number(edl.subtitles.outline) };
  }

  return { errors, warns, W, H, FPS, cuts, overlays, audio, subs, D, edl };
}

// ---------- ffmpeg 合成（单趟 filter graph） ----------

function posExpr(position, m) {
  switch (position) {
    case "top-left": return [`${m}`, `${m}`];
    case "top-right": return [`W-w-${m}`, `${m}`];
    case "bottom-left": return [`${m}`, `H-h-${m}`];
    case "bottom-right": return [`W-w-${m}`, `H-h-${m}`];
    default: return ["(W-w)/2", "(H-h)/2"];
  }
}

function zoompanExpr(anim, frames) {
  const cx = "x='iw/2-(iw/zoom/2)'", cy = "y='ih/2-(ih/zoom/2)'";
  switch (anim) {
    case "ken_burns_in": return `z='min(1+0.12*on/${frames},1.12)':${cx}:${cy}`;
    case "ken_burns_out": return `z='max(1.12-0.12*on/${frames},1)':${cx}:${cy}`;
    case "pan_left": return `z='1.1':x='(iw-iw/zoom)*on/${frames}':${cy}`;
    case "pan_right": return `z='1.1':x='(iw-iw/zoom)*(1-on/${frames})':${cy}`;
    case "zoom_slow": return `z='min(1+0.05*on/${frames},1.05)':${cx}:${cy}`;
    default: return null;
  }
}

function escSubsPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** 组 filter graph 与 ffmpeg 参数。返回 { args, filterScript, D } */
async function buildRender(dir, v, quality) {
  const { W, H, FPS, cuts, overlays, audio, subs, D } = v;
  const lines = [];
  const inputs = [];
  const q = quality === "final" ? { crf: 20, preset: "medium" } : { crf: 28, preset: "veryfast" };

  // 每个镜头一个输入 + 规格化分支
  cuts.forEach((c, i) => {
    if (c.isImg) inputs.push(["-i", c.abs]);
    else inputs.push(["-ss", String(c.raw.in), "-t", String(c.srcDur), "-i", c.abs]);
    const parts = [];
    if (c.isImg) {
      // 静帧要靠 zoompan 复帧出满时长（单帧输入流会立即结束），顺带统一做动画
      parts.push(`scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2}`);
      const frames = Math.max(1, Math.round(c.d * FPS));
      const zp = zoompanExpr(c.anim, frames) || "z='1'";
      parts.push(`zoompan=${zp}:d=${frames}:s=${W}x${H}:fps=${FPS}`);
    } else {
      parts.push("setpts=PTS-STARTPTS");
      if (c.speed !== 1) parts.push(`setpts=PTS/${c.speed}`);
      parts.push(`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`);
    }
    // 注意：时长由输入端控制（视频 -ss/-t，图片 zoompan 帧数），分支里不再 trim——
    // fps 之后再 trim/setpts 会把帧率元数据打掉，xfade 会报 "constant frame rate" 错
    parts.push(`fps=${FPS}`, "setsar=1", "settb=AVTB", "format=yuv420p");
    lines.push(`[${inputs.length - 1}:v]${parts.join(",")}[v${i}]`);
  });

  // 相邻镜头接续：有转场走 xfade（重叠），默认硬切走 concat
  let cur = "v0", acc = cuts[0].d;
  for (let k = 1; k < cuts.length; k++) {
    const c = cuts[k];
    let t = c.transition ? c.transition.duration : 0;
    if (t > 0) t = Math.min(t, acc * 0.8, c.d * 0.8);
    if (t > 0) {
      lines.push(`[${cur}][v${k}]xfade=transition=${XFADE[c.transition.type]}:duration=${t.toFixed(3)}:offset=${(acc - t).toFixed(3)}[x${k}]`);
      cur = `x${k}`;
      acc = acc + c.d - t;
    } else {
      lines.push(`[${cur}][v${k}]concat=n=2:v=1:a=0[c${k}]`);
      cur = `c${k}`;
      acc = acc + c.d;
    }
  }

  // 草稿档降分辨率（后续字幕按输出分辨率给字号）
  if (quality !== "final" && H > 720) {
    lines.push(`[${cur}]scale=-2:720[dr]`);
    cur = "dr";
  }

  // 覆盖层（图片，全时长铺底 + enable 窗口）
  overlays.forEach((ov, i) => {
    inputs.push(["-loop", "1", "-t", D.toFixed(3), "-i", ov.abs]);
    const idx = inputs.length - 1;
    const parts = [];
    if (ov.scale) parts.push(`scale=iw*${ov.scale}:ih*${ov.scale}`);
    parts.push("format=rgba");
    if (ov.opacity < 1) parts.push(`colorchannelmixer=aa=${ov.opacity}`);
    lines.push(`[${idx}:v]${parts.join(",")}[ov${i}]`);
    const [px, py] = posExpr(ov.position, ov.margin);
    lines.push(`[${cur}][ov${i}]overlay=${px}:${py}:enable='between(t,${ov.from},${ov.to})'[ovo${i}]`);
    cur = `ovo${i}`;
  });

  // 字幕
  if (subs) {
    const style = `FontSize=${subs.fontSize},Outline=${subs.outline},MarginV=${subs.marginV},BorderStyle=1`;
    lines.push(`[${cur}]subtitles=filename='${escSubsPath(subs.abs)}':force_style='${style}'[vs]`);
    cur = "vs";
  }
  lines.push(`[${cur}]null[vout]`);

  // 音频：music（ducking）/ narration / sfx 三通道混合
  let audioLabel = null;
  const hasNarr = audio.narration.length > 0;
  const audioInputs = [];
  const AUD_NORM = "aformat=channel_layouts=stereo,aresample=48000";
  if (audio.music) {
    audioInputs.push(audio.music.abs);
    const mi = inputs.length + audioInputs.length - 1;
    const parts = [`volume=${Math.max(0, Math.min(1, audio.music.volume))}`];
    if (audio.music.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${audio.music.fadeIn}`);
    if (audio.music.fadeOut > 0) parts.push(`afade=t=out:st=${Math.max(0, D - audio.music.fadeOut).toFixed(3)}:d=${Math.min(audio.music.fadeOut, D)}`);
    lines.push(`[${mi}:a]${parts.join(",")},${AUD_NORM}[am]`);
  }
  if (hasNarr) {
    const narrLabels = [];
    audio.narration.forEach((n) => {
      audioInputs.push(n.abs);
      const ni = inputs.length + audioInputs.length - 1;
      const ms = Math.round(n.at * 1000);
      lines.push(`[${ni}:a]adelay=${ms}:all=1,${AUD_NORM}[an${narrLabels.length}]`);
      narrLabels.push(`an${narrLabels.length}`);
    });
    lines.push(`${narrLabels.map((l) => `[${l}]`).join("")}amix=inputs=${narrLabels.length}:normalize=0:duration=longest[an]`);
  }
  if (audio.sfx.length) {
    const sfxLabels = [];
    audio.sfx.forEach((s) => {
      audioInputs.push(s.abs);
      const si = inputs.length + audioInputs.length - 1;
      const ms = Math.round(s.at * 1000);
      lines.push(`[${si}:a]volume=${Math.max(0, Math.min(1, s.volume))},adelay=${ms}:all=1,${AUD_NORM}[as${sfxLabels.length}]`);
      sfxLabels.push(`as${sfxLabels.length}`);
    });
    lines.push(`${sfxLabels.map((l) => `[${l}]`).join("")}amix=inputs=${sfxLabels.length}:normalize=0:duration=longest[asx]`);
  }
  if (audio.music && hasNarr && audio.music.ducking) {
    lines.push("[am][an]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=350[amd]");
    audioLabel = "amd";
  } else if (audio.music) {
    lines.push("[am]anull[amd]");
    audioLabel = "amd";
  }
  const mixLabels = [];
  if (audioLabel) mixLabels.push(audioLabel);
  if (hasNarr) mixLabels.push("an");
  if (audio.sfx.length) mixLabels.push("asx");
  if (mixLabels.length === 1) {
    lines.push(`[${mixLabels[0]}]apad,atrim=0:${D.toFixed(3)},alimiter=limit=0.95,aresample=48000[aout]`);
  } else if (mixLabels.length > 1) {
    lines.push(`${mixLabels.map((l) => `[${l}]`).join("")}amix=inputs=${mixLabels.length}:normalize=0:duration=longest,apad,atrim=0:${D.toFixed(3)},alimiter=limit=0.95,aresample=48000[aout]`);
  }

  const args = [];
  for (const inp of inputs) args.push(...inp);
  for (const a of audioInputs) args.push("-i", a);

  return {
    args, lines, D, crf: q.crf, preset: q.preset,
    hasAudio: mixLabels.length > 0,
  };
}

async function renderCut(a) {
  await ensureFfmpeg();
  const dir = path.resolve(String(a.dir || "").trim());
  if (!dir || !fs.existsSync(dir)) throw new Error("dir 必填（剪辑项目根目录绝对路径）");
  const quality = a.quality === "final" ? "final" : "draft";

  const v = await validateEdl(dir);
  if (v.errors.length) {
    return `检查未通过（${v.errors.length} 个错误），先修复再渲染：\n${v.errors.map((e) => `- [错误] ${e}`).join("\n")}${v.warns.length ? `\n另有 ${v.warns.length} 个提醒未阻塞（check_edl 看全）` : ""}`;
  }
  if (!v.cuts.length) throw new Error("cuts 为空，无可渲染内容");

  const plan = await buildRender(dir, v, quality);
  const outDir = path.join(dir, "out");
  fs.mkdirSync(outDir, { recursive: true });
  const outName = quality === "final" ? "final.mp4" : "preview.mp4";
  const outPath = path.join(outDir, outName);

  const args = [...plan.args, "-filter_complex_script"];
  // Windows 的 ffmpeg 不接受 "-" 作脚本文件名：落到 out/ 下用真实路径
  const fgPath = path.join(outDir, ".fg.txt");
  fs.writeFileSync(fgPath, plan.lines.join(";\n"));
  args.push(fgPath, "-map", "[vout]");
  if (plan.hasAudio) args.push("-map", "[aout]");
  args.push("-c:v", "libx264", "-preset", plan.preset, "-crf", String(plan.crf));
  if (plan.hasAudio) args.push("-c:a", "aac", "-b:a", "192k");
  else args.push("-an");
  args.push("-movflags", "+faststart", "-y", outPath);

  const r = await runCmd("ffmpeg", [...args], { timeoutMs: 30 * 60_000 });
  if (r.code !== 0 || !fs.existsSync(outPath)) {
    throw new Error(`ffmpeg 合成失败（filtergraph 保留在 ${fgPath} 供排查）：${(r.err || r.out).slice(-1200)}`);
  }
  try { fs.rmSync(fgPath, { force: true }); } catch { /* 清理失败无妨 */ }

  // ---- 渲后终审（强制）：时长/音轨/封装 ----
  const probe = await ffprobe(outPath);
  const info = mediaInfo(probe);
  const issues = [];
  const tol = Math.max(0.6, plan.D * 0.03);
  if (Math.abs(info.duration - plan.D) > tol) {
    issues.push(`成片时长 ${info.duration.toFixed(2)}s，决策表预期 ${plan.D.toFixed(2)}s（偏差超过允许值 ${tol.toFixed(2)}s）——时间线数学和实际输出不一致，检查转场重叠`);
  }
  if (plan.hasAudio && !info.hasAudio) issues.push("决策表里有音频，成片却没音轨——混音链路出问题了");
  if (!plan.hasAudio && info.hasAudio) issues.push("决策表无音频但成片带音轨——不该发生，检查素材");
  const sizeMB = fs.statSync(outPath).size / 1e6;
  let report = `${quality === "final" ? "成片" : "小样"}已合成：${outPath}\n${info.width}x${info.height} ${info.duration.toFixed(2)}s（预期 ${plan.D.toFixed(2)}s） ${sizeMB.toFixed(1)}MB crf${plan.crf}`;
  if (issues.length) {
    throw new Error(`终审未通过（成片已生成但不可交付）：\n${issues.map((i) => `- ${i}`).join("\n")}`);
  }
  report += "\n终审通过：时长与决策表一致，音轨正常。";
  if (quality !== "final") report += "\n下一步：先自己看一遍（小样在 out/preview.mp4），节奏没问题再跑 cut_review，过了再出 final。";
  else report += "\n下一步：跑 cut_review 拿评分结论，随成片一起向用户汇报。";
  return report;
}

// ---------- 防幻灯片六维评分 ----------

async function cutReview(a) {
  const dir = path.resolve(String(a.dir || "").trim());
  const v = await validateEdl(dir);
  if (v.errors.length) {
    return `EDL 还有 ${v.errors.length} 个错误，先 check_edl 修完再评分。`;
  }
  const { cuts, D, audio, subs, overlays } = v;
  if (!cuts.length) throw new Error("cuts 为空");

  const dims = {};

  // 1 复读：连续镜头同动画+同转场+同档时长
  let run = 1, maxRun = 1;
  for (let i = 1; i < cuts.length; i++) {
    const prev = cuts[i - 1], c = cuts[i];
    const bucket = (d) => Math.round(d * 2) / 2;
    const same = c.anim === prev.anim && (c.transition ? c.transition.type : "cut") === (prev.transition ? prev.transition.type : "cut") && bucket(c.d) === bucket(prev.d);
    run = same ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
  }
  dims.repetition = {
    score: maxRun >= 4 ? 5 : maxRun === 3 ? 3.5 : maxRun === 2 ? 1.5 : 0,
    reason: maxRun >= 3 ? `最长连续 ${maxRun} 个镜头同动画+同转场+同长度，机械感明显` : `最长连续同构镜头 ${maxRun} 个，节奏有变化`,
  };

  // 2 静帧依赖：图片静止镜头占的时长比例
  const stillDur = cuts.filter((c) => c.isImg && c.anim === "static").reduce((s, c) => s + c.d, 0);
  const stillRatio = D > 0 ? stillDur / D : 0;
  dims.stillness = {
    score: stillRatio > 0.6 ? 5 : stillRatio > 0.4 ? 3 : stillRatio > 0.2 ? 1 : 0,
    reason: stillRatio > 0.2 ? `静止图片镜头占 ${Math.round(stillRatio * 100)}% 时长，幻灯片感的主要来源` : "静止图片占比低，画面持续有运动",
  };

  // 3 节奏单调：镜头时长方差
  const ds = cuts.map((c) => c.d);
  const mean = ds.reduce((s, x) => s + x, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((s, x) => s + (x - mean) ** 2, 0) / ds.length);
  const mono = ds.length >= 5 && sd / mean < 0.15;
  dims.rhythm = {
    score: mean > 8 ? 4.5 : mono ? 3.5 : mean < 0.8 ? 3 : sd / mean < 0.25 ? 1.5 : 0,
    reason: mean > 8 ? `平均镜头 ${mean.toFixed(1)}s 太长，拖` : mono ? `${ds.length} 个镜头长度几乎一样（变异系数 ${(sd / mean).toFixed(2)}），缺乏长短对比` : `平均 ${mean.toFixed(1)}s，变异系数 ${(sd / mean).toFixed(2)}，长短有对比`,
  };

  // 4 文字依赖：覆盖层+字幕存在感
  const ovDur = overlays.reduce((s, o) => s + (o.to - o.from), 0);
  const textRatio = D > 0 ? ovDur / D : 0;
  const heavy = textRatio > 0.7 || (subs && cuts.length <= 3);
  dims.text_dependency = {
    score: heavy ? 4 : textRatio > 0.45 ? 2 : 0,
    reason: heavy ? `覆盖层铺了 ${Math.round(textRatio * 100)}% 时长${subs ? "且全程字幕" : ""}——画面自己在说话吗` : "文字点缀得克制，画面是主角",
  };

  // 5 声音动量
  const soundN = (audio.music ? 1 : 0) + audio.narration.length + audio.sfx.length;
  dims.audio_momentum = {
    score: soundN === 0 ? 4 : audio.music && !audio.sfx.length && !audio.narration.length ? 1.5 : 0,
    reason: soundN === 0 ? "全片无声——视频不是 GIF" : soundN === 1 && audio.music ? "只有一条铺底音乐，关键动作点考虑加音效" : "声音有层次",
  };

  // 6 决策可见性：reason 覆盖率
  const noReason = cuts.filter((c) => !c.raw.reason || !String(c.raw.reason).trim()).length;
  dims.decision_clarity = {
    score: noReason === 0 ? 0 : noReason / cuts.length > 0.4 ? 3.5 : 1.5,
    reason: noReason > 0 ? `${noReason}/${cuts.length} 个镜头没写 reason——评审时这些刀无法被挑战，也无法被复用` : "每刀都有理由，决策可审计",
  };

  const scores = Object.values(dims).map((d) => d.score);
  const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
  const verdict = avg < 2 ? "strong" : avg < 3 ? "acceptable" : avg < 4 ? "revise" : "fail";
  const cn = { strong: "强", acceptable: "合格", revise: "要改", fail: "不过" };
  const lines = [
    `防幻灯片评分：${avg.toFixed(2)} / 5（verdict: ${verdict}〔${cn[verdict]}〕，镜头 ${cuts.length} 个，时长 ${D.toFixed(1)}s）`,
    "",
    ...Object.entries(dims).map(([k, d]) => `- ${k}：${d.score.toFixed(1)} —— ${d.reason}`),
    "",
  ];
  if (verdict === "revise" || verdict === "fail") {
    const worst = Object.entries(dims).sort((x, y) => y[1].score - x[1].score).filter(([, d]) => d.score >= 3).slice(0, 3);
    lines.push("优先修（按得分从高到低）：");
    worst.forEach(([k, d]) => lines.push(`- ${k}：${d.reason}`));
    lines.push("");
    lines.push("改完重排 EDL → check_edl → render_cut(draft) → 再 cut_review。verdict 到 acceptable 以上才交付。");
  } else if (verdict === "acceptable") {
    lines.push("可以交付；如果时间允许，优先把 stillness 和 rhythm 再优化一档。");
  } else {
    lines.push("结构上没有幻灯片风险，交付。");
  }
  return lines.join("\n");
}

// ---------- 其余工具 ----------

async function probeMedia(a) {
  await ensureFfmpeg();
  const abs = resolveSource(process.cwd(), a.path) || (fs.existsSync(String(a.path)) ? path.resolve(String(a.path)) : null);
  if (!abs) throw new Error(`素材不存在：${a.path}`);
  const info = mediaInfo(await ffprobe(abs));
  const kind = info.isImage ? "图片" : "视频";
  const lines = [`${kind}：${abs}`, info.isImage
    ? `${info.width}x${info.height}`
    : `${info.width}x${info.height} ${info.fps}fps，${info.duration.toFixed(2)}s，${info.hasAudio ? "有音轨" : "无音轨"}`];
  if (!info.isImage && info.hasAudio) lines.push("（剪辑时素材原声默认不进成片；需要就提出来挂 narration/sfx 通道）");
  return lines.join("\n");
}

async function checkEdl(a) {
  const dir = path.resolve(String(a.dir || "").trim());
  if (!dir || !fs.existsSync(dir)) throw new Error("dir 必填（剪辑项目根目录绝对路径）");
  const v = await validateEdl(dir);
  const head = v.errors.length
    ? `检查未通过：${v.errors.length} 个错误，${v.warns.length} 个提醒`
    : v.warns.length ? `检查通过，${v.warns.length} 个提醒` : "检查通过，没有问题";
  const lines = [head, ""];
  v.errors.forEach((e) => lines.push(`- [错误] ${e}`));
  v.warns.forEach((w) => lines.push(`- [提醒] ${w}`));
  if (!v.errors.length && v.cuts.length) {
    lines.push("", `时间线：${v.cuts.length} 个镜头，总时长 ${v.D.toFixed(2)}s（${v.W}x${v.H} ${v.FPS}fps）`);
  }
  return lines.join("\n");
}

// ---------- MCP stdio 循环 ----------

const DIR_DESC = "剪辑项目根目录（绝对路径，含 edl.json）";
const tools = [];
const def = (name, description, inputSchema, handler) => tools.push({ name, description, inputSchema, handler });
const P = (description) => ({ type: "string", description });

def("probe_media",
  "摸底一个素材文件（视频/图片/音频）：时长、分辨率、帧率、有没有音轨。排 EDL 之前每个素材都要过一遍，不知道素材多长就没法定入出点。",
  { type: "object", properties: { path: P("素材路径（绝对路径，或相对剪辑项目根/assets/）") }, required: ["path"] },
  probeMedia);

def("check_edl",
  "校验剪辑决策表 edl.json：素材存在性、入出点合法性、转场词表、时间线数学、缺 reason 的镜头。渲染前必须全绿。只检查不渲染。",
  { type: "object", properties: { dir: P(DIR_DESC) }, required: ["dir"] },
  checkEdl);

def("render_cut",
  "按 edl.json 执行 ffmpeg 合成（裁切/变速/图片动画/转场/覆盖层/字幕/三通道混音一次完成），渲完自动终审（时长与决策表核对、音轨检查），终审不过会直接报错不许交付。quality=draft 出 out/preview.mp4（草稿档，快），final 出 out/final.mp4（成片档）。",
  {
    type: "object",
    properties: {
      dir: P(DIR_DESC),
      quality: { type: "string", enum: ["draft", "final"], description: "draft 草稿（缺省，先看节奏）/ final 成片" },
    },
    required: ["dir"],
  },
  renderCut);

def("cut_review",
  "对 EDL 做防幻灯片六维评分（复读/静帧依赖/节奏/文字依赖/声音动量/决策可见性），verdict 为 revise 或 fail 时按给出的优先级改完重排。交付前必跑。",
  { type: "object", properties: { dir: P(DIR_DESC) }, required: ["dir"] },
  cutReview);

function textResult(text, isError = false) {
  return { content: [{ type: "text", text }], isError };
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  try {
    if (method === "initialize") {
      return { id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "video-edit", version: "1.0.0" } } };
    }
    if (method === "tools/list") {
      return { id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
    }
    if (method === "tools/call") {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return { id, result: textResult(`未知工具: ${params.name}`, true) };
      try {
        const r = await tool.handler(params.arguments || {});
        return { id, result: textResult(typeof r === "string" ? r : JSON.stringify(r, null, 2)) };
      } catch (e) {
        const msg2 = String(e.message || e);
        const guidance = /不存在|未找到|失败|没有找到/.test(msg2) ? "\n\n（可恢复失败：按提示处理后立即重试，不要结束回合。）" : "";
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

// 调试直通：node server.js --check <dir> | --render <dir> [quality] | --review <dir> | --probe <path>
if (process.argv.length > 2) {
  const [cmd, a1, a2] = process.argv.slice(2);
  const run = async () => {
    if (cmd === "--check") console.log(await checkEdl({ dir: a1 }));
    else if (cmd === "--render") console.log(await renderCut({ dir: a1, quality: a2 || "draft" }));
    else if (cmd === "--review") console.log(await cutReview({ dir: a1 }));
    else if (cmd === "--probe") console.log(await probeMedia({ path: a1 }));
    else console.error("用法：--check <dir> | --render <dir> [draft|final] | --review <dir> | --probe <path>");
  };
  run().then(() => process.exit(0), (e) => { console.error(String(e.message || e)); process.exit(1); });
} else {
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
}
