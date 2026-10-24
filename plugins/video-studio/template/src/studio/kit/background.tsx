import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { alpha, useTheme } from "../theme";
import { useLayout } from "./layout";

// 背景层：给画面「质感」的关键。全部用渐变/SVG 实现（不用大面积 CSS blur 滤镜——
// 软件光栅下极慢），颜色缺省取主题色板。叠法：<Background/> 打底 → 内容 → <Grain/>/<Vignette/> 收尾。

/** 线性渐变底，animate 时角度缓慢旋转 */
export const GradientBackground: React.FC<{ colors?: string[]; angle?: number; animate?: boolean; speed?: number }> = ({
  colors,
  angle = 135,
  animate = true,
  speed = 0.15,
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const cs = colors ?? [theme.palette.background, theme.palette.surface];
  const a = animate ? angle + frame * speed : angle;
  return <AbsoluteFill style={{ background: `linear-gradient(${a}deg, ${cs.join(", ")})` }} />;
};

/**
 * 网格渐变（mesh）：几团大色斑缓慢漂移，现代感最强的背景。
 * colors 缺省用 primary/secondary/accent；intensity 控制色斑浓度（0-1）。
 */
export const MeshBackground: React.FC<{ colors?: string[]; base?: string; intensity?: number; speed?: number; seed?: string }> = ({
  colors,
  base,
  intensity,
  speed = 0.004,
  seed = "mesh",
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  // 浅色底上色斑叠加易发脏：浅色主题降浓度、只用主辅两色
  const light = theme.mode === "light";
  const k = intensity ?? (light ? 0.26 : 0.55);
  const cs = colors ?? (light ? [theme.palette.primary, theme.palette.secondary] : [theme.palette.primary, theme.palette.secondary, theme.palette.accent]);
  const blobs = cs.map((c, i) => {
    const x = 50 + noise2D(`${seed}-x${i}`, frame * speed, i) * 38;
    const y = 50 + noise2D(`${seed}-y${i}`, i, frame * speed) * 34;
    const size = 55 + i * 8;
    return `radial-gradient(circle at ${x}% ${y}%, ${alpha(c, k)} 0%, ${alpha(c, k * 0.35)} ${size * 0.45}%, transparent ${size}%)`;
  });
  return <AbsoluteFill style={{ background: [...blobs, base ?? theme.palette.background].join(", ") }} />;
};

/** 极光：偏上方的柔和色带，适合深色主题的标题页 */
export const Aurora: React.FC<{ colors?: string[]; speed?: number }> = ({ colors, speed = 0.006 }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const cs = colors ?? [theme.palette.primary, theme.palette.secondary, theme.palette.accent];
  const k = theme.mode === "light" ? 0.24 : 0.42;
  const bands = cs.map((c, i) => {
    const x = 20 + i * 30 + noise2D(`aurora-${i}`, frame * speed, 0) * 18;
    const y = 18 + noise2D(`aurora-y${i}`, 0, frame * speed) * 10;
    return `radial-gradient(ellipse 45% 30% at ${x}% ${y}%, ${alpha(c, k)} 0%, transparent 70%)`;
  });
  return <AbsoluteFill style={{ background: [...bands, theme.palette.background].join(", ") }} />;
};

/** 聚光：一束柔光（x/y 为百分比位置） */
export const Spotlight: React.FC<{ x?: number; y?: number; size?: number; color?: string; opacity?: number }> = ({
  x = 50,
  y = 35,
  size = 60,
  color,
  opacity = 0.35,
}) => {
  const theme = useTheme();
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${x}% ${y}%, ${alpha(color ?? theme.palette.primary, opacity)} 0%, transparent ${size}%)`,
      }}
    />
  );
};

/** 胶片颗粒：SVG 噪声叠层，逐帧换种子形成颗粒跳动（opacity 0.04-0.12 为宜） */
export const Grain: React.FC<{ opacity?: number; animated?: boolean }> = ({ opacity = 0.07, animated = true }) => {
  const frame = useCurrentFrame();
  const seed = animated ? frame % 12 : 1;
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** 暗角：四周压暗，聚焦画面中心 */
export const Vignette: React.FC<{ strength?: number; color?: string }> = ({ strength = 0.55, color = "#000000" }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at center, transparent 45%, ${alpha(color, strength)} 100%)`,
      pointerEvents: "none",
    }}
  />
);

/** 网格线：科技感底纹；move 时缓慢平移，fade 时边缘渐隐 */
export const GridPattern: React.FC<{ size?: number; color?: string; opacity?: number; move?: boolean; fade?: boolean }> = ({
  size = 80,
  color,
  opacity = 0.12,
  move = true,
  fade = true,
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const s = u(size);
  const offset = move ? (frame * 0.4) % s : 0;
  const c = alpha(color ?? theme.palette.text, opacity);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`,
        backgroundSize: `${s}px ${s}px`,
        backgroundPosition: `${offset}px ${offset}px`,
        maskImage: fade ? "radial-gradient(ellipse at center, black 30%, transparent 80%)" : undefined,
        WebkitMaskImage: fade ? "radial-gradient(ellipse at center, black 30%, transparent 80%)" : undefined,
      }}
    />
  );
};

/** 点阵底纹 */
export const DotPattern: React.FC<{ gap?: number; size?: number; color?: string; opacity?: number; fade?: boolean }> = ({
  gap = 36,
  size = 2.5,
  color,
  opacity = 0.25,
  fade = true,
}) => {
  const theme = useTheme();
  const { u } = useLayout();
  const c = alpha(color ?? theme.palette.text, opacity);
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `radial-gradient(${c} ${u(size)}px, transparent ${u(size) + 0.5}px)`,
        backgroundSize: `${u(gap)}px ${u(gap)}px`,
        maskImage: fade ? "radial-gradient(ellipse at center, black 25%, transparent 75%)" : undefined,
        WebkitMaskImage: fade ? "radial-gradient(ellipse at center, black 25%, transparent 75%)" : undefined,
      }}
    />
  );
};

/** 星空：固定种子的星点 + 闪烁 */
export const Starfield: React.FC<{ count?: number; seed?: string | number; color?: string; twinkle?: boolean; maxSize?: number }> = ({
  count = 80,
  seed = "stars",
  color = "#FFFFFF",
  twinkle = true,
  maxSize = 3,
}) => {
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const stars = useMemo(
    () =>
      new Array(count).fill(0).map((_, i) => ({
        x: random(`${seed}-x-${i}`) * 100,
        y: random(`${seed}-y-${i}`) * 100,
        size: 0.6 + random(`${seed}-s-${i}`) * (maxSize - 0.6),
        phase: random(`${seed}-p-${i}`) * Math.PI * 2,
        speed: 0.03 + random(`${seed}-v-${i}`) * 0.06,
      })),
    [count, seed, maxSize],
  );
  return (
    <AbsoluteFill>
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: u(s.size),
            height: u(s.size),
            borderRadius: "50%",
            background: color,
            opacity: twinkle ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(frame * s.speed + s.phase)) : 0.8,
            boxShadow: s.size > maxSize * 0.7 ? `0 0 ${u(6)}px ${color}` : undefined,
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** 漂浮粒子：缓慢上升的光点（seed 固定，循环无缝） */
export const Particles: React.FC<{ count?: number; seed?: string; color?: string; size?: number; speed?: number }> = ({
  count = 40,
  seed = "particles",
  color,
  size = 6,
  speed = 1,
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();
  const { u } = useLayout();
  const c = color ?? theme.palette.primary;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {new Array(count).fill(0).map((_, i) => {
        const x = random(`${seed}-x-${i}`) * 100;
        const v = (0.4 + random(`${seed}-v-${i}`) * 0.8) * speed;
        const travel = height + u(80);
        const y = height + u(40) - ((frame * v + random(`${seed}-o-${i}`) * travel) % travel);
        const s = u(size * (0.4 + random(`${seed}-s-${i}`) * 0.9));
        const sway = noise2D(`${seed}-w-${i}`, frame * 0.01, 0) * u(30);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `calc(${x}% + ${sway}px)`,
              top: y,
              width: s,
              height: s,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${alpha(c, 0.95)} 0%, ${alpha(c, 0)} 70%)`,
              opacity: 0.35 + random(`${seed}-a-${i}`) * 0.5,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** 光束扫过：一道斜向高光从左扫到右（start/duration 为帧） */
export const LightSweep: React.FC<{ start?: number; duration?: number; color?: string; opacity?: number }> = ({
  start = 10,
  duration = 40,
  color = "#FFFFFF",
  opacity = 0.18,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [start, start + duration], [-40, 140], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(105deg, transparent ${p - 12}%, ${alpha(color, opacity)} ${p}%, transparent ${p + 12}%)`,
        pointerEvents: "none",
      }}
    />
  );
};

export type BackgroundVariant = "mesh" | "aurora" | "gradient" | "solid" | "grid" | "dots" | "stars" | "spotlight";

/**
 * 一站式背景：variant 选风格，grain/vignette 加质感。
 * <Background variant="mesh" grain vignette />
 */
export const Background: React.FC<{
  variant?: BackgroundVariant;
  colors?: string[];
  grain?: boolean | number;
  vignette?: boolean | number;
}> = ({ variant = "mesh", colors, grain = false, vignette = false }) => {
  const theme = useTheme();
  return (
    <AbsoluteFill style={{ background: theme.palette.background }}>
      {variant === "mesh" && <MeshBackground colors={colors} />}
      {variant === "aurora" && <Aurora colors={colors} />}
      {variant === "gradient" && <GradientBackground colors={colors} />}
      {variant === "grid" && (
        <>
          <Spotlight y={30} opacity={0.25} />
          <GridPattern />
        </>
      )}
      {variant === "dots" && (
        <>
          <Spotlight y={40} opacity={0.22} />
          <DotPattern />
        </>
      )}
      {variant === "stars" && (
        <>
          <Aurora colors={colors} />
          <Starfield />
        </>
      )}
      {variant === "spotlight" && <Spotlight opacity={0.4} size={70} />}
      {vignette ? <Vignette strength={typeof vignette === "number" ? vignette : theme.mode === "dark" ? 0.55 : 0.18} /> : null}
      {grain ? <Grain opacity={typeof grain === "number" ? grain : 0.06} /> : null}
    </AbsoluteFill>
  );
};
