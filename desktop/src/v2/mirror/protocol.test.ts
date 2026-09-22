import { describe, it, expect } from 'vitest';
import {
  ByteBuf, splitAnnexB, annexbToAvcc, buildAvcConfig, createScrcpyParser,
  F_SESSION, F_CONFIG, F_KEY, CODEC_H264,
} from './protocol';

const u8 = (...bytes: number[]): Uint8Array => new Uint8Array(bytes);
const u32 = (v: number): Uint8Array =>
  u8((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);

/** 组一个设备名 64B 定长块。 */
const deviceBlock = (name: string): Uint8Array => {
  const b = new Uint8Array(64);
  b.set(new TextEncoder().encode(name));
  return b;
};

/** 组包头：ptsAndFlags i64 + size u32。 */
const packetHead = (pts: bigint, flags: bigint, size: number): Uint8Array => {
  const v = pts | flags;
  const head = new Uint8Array(12);
  for (let i = 0; i < 8; i++) head[i] = Number((v >> BigInt((7 - i) * 8)) & 0xffn);
  head.set(u32(size), 8);
  return head;
};

describe('ByteBuf 跨 chunk 结构化读取', () => {
  it('take 跨 chunk 拼接', () => {
    const b = new ByteBuf();
    b.push(u8(1, 2, 3));
    b.push(u8(4, 5));
    expect(b.take(5)).toEqual(u8(1, 2, 3, 4, 5));
    expect(b.size).toBe(0);
  });

  it('不足时返回 null 且不消费', () => {
    const b = new ByteBuf();
    b.push(u8(1, 2, 3));
    expect(b.take(5)).toBeNull();
    expect(b.size).toBe(3);
    expect(b.take(2)).toEqual(u8(1, 2));
  });

  it('unshift 头部放回恢复现场', () => {
    const b = new ByteBuf();
    b.push(u8(1, 2, 3, 4));
    const head = b.take(2)!;
    b.unshift(head);
    expect(b.take(4)).toEqual(u8(1, 2, 3, 4));
  });
});

describe('Annex-B ↔ AVCC', () => {
  it('3 字节起始码切分', () => {
    const nals = splitAnnexB(u8(0, 0, 1, 0xaa, 0xbb, 0, 0, 1, 0xcc));
    expect(nals).toEqual([u8(0xaa, 0xbb), u8(0xcc)]);
  });

  it('4 字节起始码切分（长 NAL 前导 0）', () => {
    const nals = splitAnnexB(u8(0, 0, 0, 1, 0xaa, 0, 0, 0, 1, 0xbb));
    expect(nals).toEqual([u8(0xaa), u8(0xbb)]);
  });

  it('avcc 输出每个 NAL 前 4B 长度', () => {
    const out = annexbToAvcc(u8(0, 0, 1, 0xaa, 0xbb, 0, 0, 1, 0xcc));
    expect(out).toEqual(u8(0, 0, 0, 2, 0xaa, 0xbb, 0, 0, 0, 1, 0xcc));
  });

  it('无起始码返回 null', () => {
    expect(annexbToAvcc(u8(1, 2, 3))).toBeNull();
  });
});

describe('buildAvcConfig', () => {
  // NAL 头 5bit 类型：7=SPS 8=PPS。首字节手造，其余字节随意（只取 [1..3] 进 codec 串）。
  const sps = u8(0x67, 0x64, 0x00, 0x28, 0xac);
  const pps = u8(0x68, 0xeb, 0xec, 0xb2);

  it('提取 SPS/PPS 构造 description 与 codec 串', () => {
    const cfg = buildAvcConfig([sps, pps])!;
    expect(cfg.codec).toBe('avc1.640028');
    expect(cfg.description[0]).toBe(1);            // version
    expect(cfg.description[4]).toBe(0xff);         // lengthSizeMinusOne=3
    expect(cfg.description[5]).toBe(0xe1);         // numOfSPS
    expect(Array.from(cfg.description.subarray(8, 8 + sps.length))).toEqual([...sps]);
    expect(cfg.description[8 + sps.length]).toBe(1); // numOfPPS
  });

  it('缺 PPS 返回 null', () => {
    expect(buildAvcConfig([sps])).toBeNull();
  });
});

describe('scrcpy 解析状态机', () => {
  const meta = (flags: bigint, w: number, h: number): Uint8Array => {
    const v = flags;
    const out = new Uint8Array(12);
    for (let i = 0; i < 8; i++) out[i] = Number((v >> BigInt((7 - i) * 8)) & 0xffn);
    out.set(u32(w), 4);
    out.set(u32(h), 8);
    return out;
  };

  it('完整握手：设备名 → codec id → session meta', () => {
    const p = createScrcpyParser();
    const evts = p.feed(new Uint8Array([
      ...deviceBlock('Pixel'), ...u32(CODEC_H264), ...meta(0n, 1080, 2400),
    ]));
    expect(evts).toEqual([
      { type: 'device', name: 'Pixel' },
      { type: 'codec', id: CODEC_H264, ok: true },
      { type: 'session', w: 1080, h: 2400 },
    ]);
  });

  it('包循环：config / 关键帧 / delta 帧按标志分流', () => {
    const p = createScrcpyParser();
    p.feed(new Uint8Array([...deviceBlock('d'), ...u32(CODEC_H264), ...meta(0n, 10, 20)]));
    const cfg = u8(0, 0, 1, 0x67, 1);
    const evts = p.feed(new Uint8Array([
      ...packetHead(0n, F_CONFIG, cfg.length), ...cfg,
      ...packetHead(100n, F_KEY, 3), ...u8(0xaa, 0xbb, 0xcc),
      ...packetHead(133n, 0n, 1), ...u8(0xdd),
    ]));
    expect(evts).toEqual([
      { type: 'config', data: cfg },
      { type: 'frame', data: u8(0xaa, 0xbb, 0xcc), pts: 100n, key: true },
      { type: 'frame', data: u8(0xdd), pts: 133n, key: false },
    ]);
  });

  it('包头与包体跨 chunk 分帧，不完整时等待补齐', () => {
    const p = createScrcpyParser();
    p.feed(new Uint8Array([...deviceBlock('d'), ...u32(CODEC_H264), ...meta(0n, 10, 20)]));
    const data = u8(0xaa, 0xbb, 0xcc);
    const full = new Uint8Array([...packetHead(7n, F_KEY, 3), ...data]);
    // 半个包头 / 剩余包头 / 前半个包体 / 后半个包体
    expect(p.feed(full.subarray(0, 5))).toEqual([]);
    expect(p.feed(full.subarray(5, 12))).toEqual([]);
    expect(p.feed(full.subarray(12, 13))).toEqual([]);
    expect(p.feed(full.subarray(13))).toEqual([
      { type: 'frame', data, pts: 7n, key: true },
    ]);
  });

  it('SESSION 包：w 取 i64 低 32 位，h 取 size 字段', () => {
    const p = createScrcpyParser();
    p.feed(new Uint8Array([...deviceBlock('d'), ...u32(CODEC_H264), ...meta(0n, 10, 20)]));
    const evts = p.feed(packetHead(1920n, F_SESSION, 1080));
    expect(evts).toEqual([{ type: 'session', w: 1920, h: 1080 }]);
  });

  it('codec id 非 h264：报 codec 事件后停止产事件', () => {
    const p = createScrcpyParser();
    const evts = p.feed(new Uint8Array([
      ...deviceBlock('d'), ...u32(0x68323635), ...meta(0n, 10, 20),
      ...packetHead(1n, F_KEY, 1), ...u8(1),
    ]));
    expect(evts).toEqual([
      { type: 'device', name: 'd' },
      { type: 'codec', id: 0x68323635, ok: false },
    ]);
  });

  it('feed 任意分片结果与一次性喂入一致（分片不变量）', () => {
    const build = (): Uint8Array => new Uint8Array([
      ...deviceBlock('Pixel'), ...u32(CODEC_H264), ...meta(0n, 1080, 2400),
      ...packetHead(0n, F_CONFIG, 5), ...u8(0, 0, 1, 0x67, 1),
      ...packetHead(42n, F_KEY, 2), ...u8(0xaa, 0xbb),
    ]);
    const once = createScrcpyParser().feed(build());
    let bytewise = createScrcpyParser();
    const acc: ReturnType<typeof bytewise.feed> = [];
    for (const b of build()) acc.push(...bytewise.feed(u8(b)));
    expect(acc).toEqual(once);
  });
});
