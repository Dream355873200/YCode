// scrcpy 4.1 协议解析 + WebCodecs 解码（Worker 专职线程，主线程零字节处理）：
//   输入：postMessage {type:'data', buf: Uint8Array}（buffer 已 transfer，零拷贝）
//   输出：{type:'frame', bitmap}（ImageBitmap，transferable）/ {type:'size'} / {type:'control'} / {type:'log'}
// 格式对照官方 server 源码 Streamer.java / DesktopConnection.java：
//   设备名 64B 定长 → codec id u32 → session meta（flags u32 + w u32 + h u32）
//   → 包循环 [ptsAndFlags i64 + size u32 + data]，高位标志：
//     bit63=SESSION（w 在 i64 低 32 位，h 是 size 字段）bit62=CONFIG bit61=KEY_FRAME
const F_SESSION = 1n << 63n;
const F_CONFIG = 1n << 62n;
const F_KEY = 1n << 61n;
const PTS_MASK = (1n << 61n) - 1n;

// 流式缓冲：跨 chunk 的结构化读取
class Buf {
  constructor() { this.chunks = []; this.len = 0; }
  push(d) { this.chunks.push(d); this.len += d.length; }
  unshift(d) { this.chunks.unshift(d); this.len += d.length; }
  get size() { return this.len; }
  take(n) {
    if (this.len < n) return null;
    const out = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const c = this.chunks[0];
      const need = n - got;
      if (c.length <= need) { out.set(c, got); got += c.length; this.chunks.shift(); }
      else { out.set(c.subarray(0, need), got); this.chunks[0] = c.subarray(need); got = n; }
    }
    this.len -= n;
    return out;
  }
}

// Annex-B（00 00 01 起始码分隔 NAL）→ NAL 列表
function splitAnnexB(d) {
  const nals = [];
  let starts = [];
  for (let i = 0; i + 2 < d.length; i++) {
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1) { starts.push(i + 3); i += 2; }
  }
  for (let k = 0; k < starts.length; k++) {
    let end = k + 1 < starts.length ? starts[k + 1] - 3 : d.length;
    if (k + 1 < starts.length && end > starts[k] && d[end - 1] === 0) end -= 1; // 4 字节起始码的额外 0
    if (end > starts[k]) nals.push(d.subarray(starts[k], end));
  }
  return nals;
}

// AVCC 帧：每个 NAL 前加 u32 BE 长度（WebCodecs description 模式的要求）
function annexbToAvcc(d) {
  const nals = splitAnnexB(d);
  if (!nals.length) return null;
  let total = 0;
  for (const n of nals) total += 4 + n.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const n of nals) {
    out[off] = (n.length >>> 24) & 0xff; out[off + 1] = (n.length >>> 16) & 0xff;
    out[off + 2] = (n.length >>> 8) & 0xff; out[off + 3] = n.length & 0xff;
    out.set(n, off + 4);
    off += 4 + n.length;
  }
  return out;
}

// 由 SPS/PPS 构造 AVCDecoderConfigurationRecord + codec 字符串
function buildAvcConfig(nals) {
  const sps = nals.find((n) => (n[0] & 0x1f) === 7);
  const pps = nals.find((n) => (n[0] & 0x1f) === 8);
  if (!sps || !pps) return null;
  const desc = new Uint8Array(11 + sps.length + pps.length);
  desc[0] = 1;
  desc[1] = sps[1]; desc[2] = sps[2]; desc[3] = sps[3]; // profile / compat / level
  desc[4] = 0xff; // lengthSizeMinusOne = 3
  desc[5] = 0xe1; // numOfSPS
  desc[6] = (sps.length >>> 8) & 0xff; desc[7] = sps.length & 0xff;
  desc.set(sps, 8);
  desc[8 + sps.length] = 1; // numOfPPS
  desc[9 + sps.length] = (pps.length >>> 8) & 0xff; desc[10 + sps.length] = pps.length & 0xff;
  desc.set(pps, 11 + sps.length);
  const hex = (b) => b.toString(16).padStart(2, '0');
  const codec = `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
  return { description: desc, codec };
}

const log = (...args) => postMessage({ type: 'log', args });
const control = (data) => postMessage({ type: 'control', data });

const buf = new Buf();
let decoder = null;
let lastCfg = null;  // 最近一次 codec configuration（decoder 重建时复用）
let decoderDead = false; // error 回调后实例已废：等关键帧重建
let lastOutputAt = 0;    // 最近一次解码输出的 frameCount（停滞检测）
let lastTs = -1;         // 最近送入 decoder 的 timestamp（强制单调递增）
let lastStatAt = 0;      // 上次周期状态日志时间
let frameCount = 0;
let phase = 0; // 0=设备名 1=codec id 2=session meta 3=包循环

// 解码输出：画到主线程移交来的 OffscreenCanvas（transferControlToOffscreen，
// worker 永久持有画布控制权，主线程 canvas 只负责显示——native 播放器结构）
let offCtx = null;
let curW = 0;
let curH = 0;
let reqW = 0; // 已向主线程请求过画布的尺寸（防同尺寸重复请求→清空后没人补）

function makeDecoder() {
  let outCount = 0;
  return new VideoDecoder({
    output: (frame) => {
      lastOutputAt = frameCount;
      try {
        outCount += 1;
        if (outCount <= 3 || outCount % 300 === 0) {
          log(`[mirror] 解码输出 #${outCount}: ${frame.displayWidth}x${frame.displayHeight} offCtx=${offCtx ? '有' : '无'}`);
        }
        if (frame.displayWidth !== curW || frame.displayHeight !== curH) {
          curW = frame.displayWidth; curH = frame.displayHeight;
          offCtx = null; // 旧画布尺寸不对：丢弃
        }
        if (!offCtx && (curW !== reqW || curH !== reqH)) {
          // 请求主线程按新尺寸建画布移交（只发一次：主线程收到后必回）
          reqW = curW; reqH = curH;
          postMessage({ type: 'size', w: curW, h: curH });
        }
        if (offCtx) offCtx.drawImage(frame, 0, 0);
      } catch (e) { if (outCount <= 3) log('[mirror] drawImage 异常:', String(e)); }
      frame.close();
    },
    error: (e) => {
      // 解码器进入错误态后实例作废（decode 静默无效）：标记，等关键帧整体重建
      log('[mirror] 解码错误，等关键帧重建:', String(e));
      decoderDead = true;
    },
  });
}

// 重建解码器（error / 停滞后调用）：丢弃旧实例，用最近 config 重新配置
function rebuildDecoder() {
  if (!lastCfg) return;
  try { if (decoder) decoder.close(); } catch { /* */ }
  decoder = makeDecoder();
  decoder.configure({ codec: lastCfg.codec, description: lastCfg.description, optimizeForLatency: true });
  decoderDead = false;
}

function handlePacket(v, size, data) {
  if (v & F_SESSION) {
    const w = Number(v & 0xffffffffn);
    // RESET_VIDEO 后 server 会重发 session meta：尺寸没变就复用现有画布，
    // 不触发重建（重建窗口期的交接竞态会导致永久黑屏）
    if (w !== curW || size !== curH) {
      curW = w; curH = size;
      offCtx = null;
    }
    return;
  }
  if (v & F_CONFIG) {
    const cfg = buildAvcConfig(splitAnnexB(data));
    if (!cfg) { log('[mirror] config 包中未见 SPS/PPS'); return; }
    if (decoder) { try { decoder.close(); } catch { /* */ } }
    decoder = makeDecoder();
    lastCfg = cfg;
    lastTs = -1; // 新编码会话：时间戳基准重置
    decoder.configure({ codec: cfg.codec, description: cfg.description, optimizeForLatency: true });
    log('[mirror] codec configuration:', cfg.codec);
    return;
  }
  if (!decoder) return;
  const avcc = annexbToAvcc(data);
  if (!avcc) return;
  const isKey = (v & F_KEY) !== 0n;
  // 自愈 ①：解码器错误态 / 输出停滞（收了 60 帧却无输出=硬解队列卡死）
  //   → 关键帧到达时整体重建，避免画面永久冻结
  const stalled = frameCount - lastOutputAt > 60;
  if ((decoderDead || stalled) && isKey) {
    log(`[mirror] 解码器${decoderDead ? '错误' : '停滞'}，关键帧重建（decode ${frameCount} / output ${lastOutputAt}）`);
    rebuildDecoder();
  }
  // 背压：解码队列明显积压时才丢非关键帧（阈值过低会让 delta 帧全被丢，
  // 画面冻结在关键帧上）。
  // 注意：不主动发 RESET_VIDEO 请求画质刷新——实测 server 重置编码会话后
  // （Video capture reset）画面会永久冻结（只剩触控），权衡后放弃该机制：
  // 丢帧导致的模糊会在下一个关键帧自然恢复，不值得冒冻结风险。
  if (decoder.decodeQueueSize > 8 && !isKey) return;
  try {
    // 时间戳必须单调递增：RESET_VIDEO 后编码器 pts 从头计，回退的帧会被
    // WebCodecs 静默丢弃（表现为画面永久冻结但数据照常到达）。强制 +1 递增。
    let ts = Number(v & PTS_MASK);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    decoder.decode(new EncodedVideoChunk({
      type: isKey ? 'key' : 'delta',
      timestamp: ts,
      data: avcc,
    }));
    frameCount += 1;
    // 周期状态（10s 一条）：区分「解析卡住/解码停滞/时间戳丢弃」三种冻结
    const nowMs = Date.now();
    if (nowMs - lastStatAt > 10_000) {
      lastStatAt = nowMs;
      log(`[mirror] 状态: buf=${buf.size}B decode=${frameCount} output=${lastOutputAt} queue=${decoder.decodeQueueSize}`);
    }
  } catch (e) {
    if (frameCount === 0) log('[mirror] 首帧解码失败（等 config）:', String(e));
  }
}

// 同步状态机（worker 专职处理，阻塞无妨——新数据在事件循环下一轮继续）
function parse() {
  for (;;) {
    if (phase === 0) {
      const name = buf.take(64);
      if (!name) return;
      log('[mirror] 设备:', new TextDecoder().decode(name).replace(/\0+$/, '') || '(未发送)');
      phase = 1;
    } else if (phase === 1) {
      const c = buf.take(4);
      if (!c) return;
      const id = (c[0] << 24 | c[1] << 16 | c[2] << 8 | c[3]) >>> 0;
      if (id !== 0x68323634) { log('[mirror] codec 不支持: 0x' + id.toString(16), '（期望 h264）'); return; }
      phase = 2;
    } else if (phase === 2) {
      const sm = buf.take(12);
      if (!sm) return;
      const w = (sm[4] << 24 | sm[5] << 16 | sm[6] << 8 | sm[7]) >>> 0;
      const h = (sm[8] << 24 | sm[9] << 16 | sm[10] << 8 | sm[11]) >>> 0;
      curW = w; curH = h; // 解码首帧尺寸与此一致：不触发画布重建
      postMessage({ type: 'size', w, h });
      log(`[mirror] session: ${w}x${h}`);
      phase = 3;
    } else {
      if (buf.size < 12) return;
      const head = buf.take(12);
      let v = 0n;
      for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(head[i]);
      const size = (head[8] << 24 | head[9] << 16 | head[10] << 8 | head[11]) >>> 0;
      if (buf.size < size) { buf.unshift(head); return; } // 数据不完整：head 放回
      handlePacket(v, size, buf.take(size));
    }
  }
}

onmessage = (e) => {
  if (!e.data) return;
  if (e.data.type === 'data') {
    buf.push(new Uint8Array(e.data.buf));
    parse();
  } else if (e.data.type === 'canvas') {
    // 主线程 transferControlToOffscreen 移交来的画布控制权（尺寸由主线程定）
    offCtx = e.data.canvas.getContext('2d');
    log('[mirror] 收到画布，尺寸', e.data.canvas.width, 'x', e.data.canvas.height);
  }
};
