// scrcpy 4.x 视频流协议解析 —— 纯函数模块（无 DOM / Worker / WebCodecs 依赖）。
// 从 mirrorWorker.js 抽出：格式对照官方 server 源码 Streamer.java / DesktopConnection.java。
//   设备名 64B 定长 → codec id u32 → session meta（flags u32 + w u32 + h u32）
//   → 包循环 [ptsAndFlags i64 + size u32 + data]，高位标志：
//     bit63=SESSION（w 在 i64 低 32 位，h 是 size 字段）bit62=CONFIG bit61=KEY_FRAME
// 消费方（worker）拿到事件流后自行处理解码器生命周期与画布尺寸。

export const F_SESSION = 1n << 63n;
export const F_CONFIG = 1n << 62n;
export const F_KEY = 1n << 61n;
export const PTS_MASK = (1n << 61n) - 1n;

/** 'h264' 的 u32 BE 编码值（scrcpy 兜底无 scid 时的裸流只有这一种 codec）。 */
export const CODEC_H264 = 0x68323634;

/** 流式缓冲：跨 chunk 的结构化读取。take 不足时返回 null 不消费。 */
export class ByteBuf {
  private chunks: Uint8Array[] = [];
  private len = 0;

  push(d: Uint8Array): void { this.chunks.push(d); this.len += d.length; }

  /** 头部放回（包不完整时恢复现场，等下一 chunk 补齐）。 */
  unshift(d: Uint8Array): void { this.chunks.unshift(d); this.len += d.length; }

  get size(): number { return this.len; }

  take(n: number): Uint8Array | null {
    if (this.len < n) return null;
    const out = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const c = this.chunks[0]!;
      const need = n - got;
      if (c.length <= need) { out.set(c, got); got += c.length; this.chunks.shift(); }
      else { out.set(c.subarray(0, need), got); this.chunks[0] = c.subarray(need); got = n; }
    }
    this.len -= n;
    return out;
  }
}

/** Annex-B（00 00 01 起始码分隔 NAL）→ NAL 列表（3/4 字节起始码均支持）。 */
export function splitAnnexB(d: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = [];
  const starts: number[] = [];
  for (let i = 0; i + 2 < d.length; i++) {
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 1) { starts.push(i + 3); i += 2; }
  }
  for (let k = 0; k < starts.length; k++) {
    const start = starts[k]!;
    let end = k + 1 < starts.length ? starts[k + 1]! - 3 : d.length;
    if (k + 1 < starts.length && end > start && d[end - 1] === 0) end -= 1; // 4 字节起始码的额外 0
    if (end > start) nals.push(d.subarray(start, end));
  }
  return nals;
}

/** AVCC 帧：每个 NAL 前加 u32 BE 长度（WebCodecs description 模式的要求）。 */
export function annexbToAvcc(d: Uint8Array): Uint8Array | null {
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

export interface AvcConfig { description: Uint8Array; codec: string }

/** 由 SPS/PPS 构造 AVCDecoderConfigurationRecord + codec 字符串。 */
export function buildAvcConfig(nals: readonly Uint8Array[]): AvcConfig | null {
  const sps = nals.find((n) => (n[0]! & 0x1f) === 7);
  const pps = nals.find((n) => (n[0]! & 0x1f) === 8);
  if (!sps || !pps) return null;
  const desc = new Uint8Array(11 + sps.length + pps.length);
  desc[0] = 1;
  desc[1] = sps[1]!; desc[2] = sps[2]!; desc[3] = sps[3]!; // profile / compat / level
  desc[4] = 0xff; // lengthSizeMinusOne = 3
  desc[5] = 0xe1; // numOfSPS
  desc[6] = (sps.length >>> 8) & 0xff; desc[7] = sps.length & 0xff;
  desc.set(sps, 8);
  desc[8 + sps.length] = 1; // numOfPPS
  desc[9 + sps.length] = (pps.length >>> 8) & 0xff; desc[10 + sps.length] = pps.length & 0xff;
  desc.set(pps, 11 + sps.length);
  const hex = (b: number) => b.toString(16).padStart(2, '0');
  const codec = `avc1.${hex(sps[1]!)}${hex(sps[2]!)}${hex(sps[3]!)}`;
  return { description: desc, codec };
}

export type StreamEvent =
  | { type: 'device'; name: string }
  | { type: 'codec'; id: number; ok: boolean }
  | { type: 'session'; w: number; h: number }
  | { type: 'config'; data: Uint8Array }
  | { type: 'frame'; data: Uint8Array; pts: bigint; key: boolean };

const u32be = (b: Uint8Array, off: number): number =>
  ((b[off]! << 24) | (b[off + 1]! << 16) | (b[off + 2]! << 8) | b[off + 3]!) >>> 0;

const i64be = (b: Uint8Array, off: number): bigint => {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[off + i]!);
  return v;
};

export interface ScrcpyParser { feed(chunk: Uint8Array): StreamEvent[] }

/**
 * 流式解析状态机：feed 任意分片的字节流，吐出完整事件。
 * 包不完整时在内部缓冲等待，跨 chunk 分帧由测试覆盖。
 */
export function createScrcpyParser(): ScrcpyParser {
  const buf = new ByteBuf();
  let phase = 0; // 0=设备名 1=codec id 2=session meta 3=包循环
  let codecOk = true; // codec 不支持后停止产事件（消费方负责断开重连）

  const emit = (out: StreamEvent[]) => (e: StreamEvent) => { if (codecOk) out.push(e); };

  return {
    feed(chunk: Uint8Array): StreamEvent[] {
      buf.push(chunk);
      const out: StreamEvent[] = [];
      const push = emit(out);
      for (;;) {
        if (phase === 0) {
          const name = buf.take(64);
          if (!name) return out;
          push({ type: 'device', name: new TextDecoder().decode(name).replace(/\0+$/, '') });
          phase = 1;
        } else if (phase === 1) {
          const c = buf.take(4);
          if (!c) return out;
          const id = u32be(c, 0);
          // 先产事件再挂「停止」标志：否则 codec 事件本身被吞
          out.push({ type: 'codec', id, ok: id === CODEC_H264 });
          codecOk = id === CODEC_H264;
          phase = 2;
        } else if (phase === 2) {
          const sm = buf.take(12);
          if (!sm) return out;
          push({ type: 'session', w: u32be(sm, 4), h: u32be(sm, 8) });
          phase = 3;
        } else {
          if (buf.size < 12) return out;
          const head = buf.take(12)!;
          const v = i64be(head, 0);
          const size = u32be(head, 8);
          if (v & F_SESSION) {
            // SESSION 包无 payload：w 在 i64 低 32 位、h 在 size 字段，
            // 只消费 12B 头（不等待 size 字节——那是 h 值不是数据长度）
            push({ type: 'session', w: Number(v & 0xffffffffn), h: size });
            continue;
          }
          if (buf.size < size) { buf.unshift(head); return out; } // 数据不完整：head 放回
          const data = buf.take(size)!;
          if (v & F_CONFIG) {
            push({ type: 'config', data });
          } else {
            push({ type: 'frame', data, pts: v & PTS_MASK, key: (v & F_KEY) !== 0n });
          }
        }
      }
    },
  };
}
