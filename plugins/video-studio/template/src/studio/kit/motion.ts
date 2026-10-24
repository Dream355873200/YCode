import { Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig, type SpringConfig } from "remotion";
import { noise2D } from "@remotion/noise";

// 动效基础：所有动画都由 useCurrentFrame 推导（确定性渲染的硬要求）。
// 约定：delay / duration 一律以「帧」为单位；需要秒时用 sec(n) 换算。

/** 缓动曲线（cubic-bezier）：out 适合入场、inOut 适合位移、back 带一点回弹 */
export const ease = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  outSoft: Easing.bezier(0.25, 0.8, 0.25, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  back: Easing.bezier(0.34, 1.56, 0.64, 1),
  linear: Easing.linear,
};

/** 弹簧预设：gentle 平滑无回弹、snappy 利落、bouncy 明显回弹、heavy 厚重缓慢 */
export const springs: Record<"gentle" | "snappy" | "bouncy" | "heavy", Partial<SpringConfig>> = {
  gentle: { damping: 200 },
  snappy: { damping: 20, stiffness: 200, mass: 0.6 },
  bouncy: { damping: 9, stiffness: 120 },
  heavy: { damping: 28, mass: 2, stiffness: 90 },
};

export const clamp = (v: number, min = 0, max = 1): number => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 秒 → 帧（按当前 fps） */
export const useSec = (): ((seconds: number) => number) => {
  const { fps } = useVideoConfig();
  return (seconds: number) => Math.round(seconds * fps);
};

/** start 帧起、duration 帧内从 0 走到 1 的进度（带缓动，前后钳制） */
export const useProgress = (start = 0, duration = 20, easing: (t: number) => number = ease.out): number => {
  const frame = useCurrentFrame();
  return interpolate(frame, [start, start + Math.max(1, duration)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });
};

/** 弹簧进度 0→1（delay 帧后开始） */
export const useSpring = (delay = 0, config: keyof typeof springs | Partial<SpringConfig> = "gentle", durationInFrames?: number): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    config: typeof config === "string" ? springs[config] : config,
    durationInFrames,
  });
};

/**
 * 入场 + 退场：enter 在场景开头 delay 帧后用 enterDuration 帧走到 1，
 * exit 在场景结尾前 exitDuration 帧开始走到 1。visible = enter * (1 - exit)。
 * 用法：const { visible, enter } = useEnterExit({ delay: 10 }); style={{ opacity: visible }}
 */
export const useEnterExit = ({
  delay = 0,
  enterDuration = 18,
  exitDuration = 14,
  exit = true,
}: { delay?: number; enterDuration?: number; exitDuration?: number; exit?: boolean } = {}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enter = interpolate(frame, [delay, delay + enterDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease.out,
  });
  const out = exit
    ? interpolate(frame, [durationInFrames - exitDuration, durationInFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: ease.in,
      })
    : 0;
  return { enter, exit: out, visible: enter * (1 - out) };
};

/** 列表交错入场的延迟：第 i 项晚 step 帧 */
export const stagger = (index: number, step = 5, base = 0): number => base + index * step;

/** 循环相位 0→1（period 帧一圈），做呼吸/旋转/脉冲 */
export const useLoop = (period = 60, offset = 0): number => {
  const frame = useCurrentFrame();
  return (((frame + offset) % period) + period) % period / period;
};

/** 正弦呼吸 0→1→0（period 帧一个周期） */
export const usePulse = (period = 60, offset = 0): number => {
  const phase = useLoop(period, offset);
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
};

/** 确定性随机数 [0,1)：同一 seed 每次渲染结果一致（禁用 Math.random） */
export const seeded = (seed: string | number): number => random(seed);

/** 兼容 v1 kit 的命名 */
export const seededRandom = (seed: number): number => random(seed);

/** 平滑噪声漂移：给元素加「手持感」/漂浮感，返回 [-amp, amp] */
export const useDrift = (seed: string | number, amplitude = 10, speed = 0.01): { x: number; y: number } => {
  const frame = useCurrentFrame();
  const s = String(seed);
  return {
    x: noise2D(`${s}-x`, frame * speed, 0) * amplitude,
    y: noise2D(`${s}-y`, 0, frame * speed) * amplitude,
  };
};

/** 数值区间映射（带钳制）：mapRange(frame, [0, 30], [0, 100]) */
export const mapRange = (
  value: number,
  input: [number, number] | number[],
  output: [number, number] | number[],
  easing?: (t: number) => number,
): number =>
  interpolate(value, input, output, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
