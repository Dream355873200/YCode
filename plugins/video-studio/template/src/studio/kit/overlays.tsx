import React from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Corner } from "../manifest";
import { resolveSrc } from "../manifest";
import { alpha, fontFamily, useTheme } from "../theme";
import { useLayout } from "./layout";
import { ease, springs } from "./motion";

// 覆盖层：字幕、人名条、水印、整片进度。film.tsx 会按 manifest.overlays 自动叠加
// 字幕/水印/进度条；场景内也可以单独使用这些组件。

export interface Cue {
  text: string;
  /** 相对起点的帧 */
  from: number;
  duration: number;
}

/** 文案按标点与长度切成字幕句，并按字数比例分配时长 */
export const splitCaptions = (text: string, totalFrames: number, maxChars = 18): Cue[] => {
  const parts = text
    .split(/(?<=[。！？!?；;…])|(?<=[，,、：:])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines: string[] = [];
  for (const p of parts) {
    const chars = Array.from(p);
    if (chars.length <= maxChars) {
      lines.push(p);
      continue;
    }
    for (let i = 0; i < chars.length; i += maxChars) lines.push(chars.slice(i, i + maxChars).join(""));
  }
  const weights = lines.map((l) => Math.max(2, Array.from(l).length));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let cursor = 0;
  return lines.map((l, i) => {
    const duration = Math.max(8, Math.round((weights[i] / sum) * totalFrames));
    const cue = { text: l.replace(/[，,、：:；;]$/, ""), from: cursor, duration };
    cursor += duration;
    return cue;
  });
};

/** 字幕：给定文案与时长自动切句轮播；style 为 bar（底条）/ outline（描边）/ minimal（无底） */
export const Captions: React.FC<{
  text: string;
  /** 字幕覆盖的总帧数（缺省 = 当前序列时长） */
  duration?: number;
  start?: number;
  style?: "bar" | "outline" | "minimal";
  position?: "bottom" | "top";
  size?: number;
}> = ({ text, duration, start = 0, style = "bar", position = "bottom", size }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const theme = useTheme();
  const { u, isPortrait, safeY, width } = useLayout();
  const total = Math.max(1, (duration ?? durationInFrames) - start);
  const cues = React.useMemo(() => splitCaptions(text, total, isPortrait ? 13 : 20), [text, total, isPortrait]);
  const local = frame - start;
  const cue = cues.find((c) => local >= c.from && local < c.from + c.duration);
  if (!cue) return null;
  const t = local - cue.from;
  const fade = interpolate(t, [0, 5, cue.duration - 4, cue.duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fs = u(size ?? (isPortrait ? 52 : 44));
  const textStyle: React.CSSProperties = {
    fontFamily: fontFamily(theme.fonts.body),
    fontWeight: 600,
    fontSize: fs,
    lineHeight: 1.35,
    color: "#FFFFFF",
    textAlign: "center",
    maxWidth: width * 0.84,
    ...(style === "outline"
      ? { WebkitTextStroke: `${u(6)}px rgba(0,0,0,0.85)`, paintOrder: "stroke fill" }
      : style === "minimal"
        ? { textShadow: `0 ${u(2)}px ${u(12)}px rgba(0,0,0,0.85)` }
        : {}),
  };
  return (
    <AbsoluteFill
      style={{
        justifyContent: position === "bottom" ? "flex-end" : "flex-start",
        alignItems: "center",
        padding: `${isPortrait ? safeY * 1.6 : safeY * 0.55}px 0`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          opacity: fade,
          transform: `translateY(${(1 - fade) * u(10)}px)`,
          ...(style === "bar"
            ? { background: "rgba(0,0,0,0.62)", padding: `${u(14)}px ${u(30)}px`, borderRadius: u(14), backdropFilter: undefined }
            : {}),
        }}
      >
        <div style={textStyle}>{cue.text}</div>
      </div>
    </AbsoluteFill>
  );
};

/** 人名条/标题条：左下角滑入的两行信息条 */
export const LowerThird: React.FC<{ title: string; subtitle?: string; delay?: number; color?: string; position?: "left" | "right" }> = ({
  title,
  subtitle,
  delay = 10,
  color,
  position = "left",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const theme = useTheme();
  const { u, safeX, safeY } = useLayout();
  const p = spring({ frame: frame - delay, fps, config: springs.snappy });
  const out = interpolate(frame, [durationInFrames - 12, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const c = color ?? theme.palette.primary;
  const dir = position === "left" ? -1 : 1;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: position === "left" ? "flex-start" : "flex-end", padding: `${safeY * 1.4}px ${safeX}px` }}>
      <div style={{ display: "flex", alignItems: "stretch", gap: u(18), opacity: p * (1 - out), transform: `translateX(${dir * (1 - p) * u(120)}px)` }}>
        <div style={{ width: u(8), borderRadius: u(4), background: c }} />
        <div style={{ background: alpha(theme.palette.surface, 0.88), padding: `${u(18)}px ${u(30)}px`, borderRadius: u(12) }}>
          <div style={{ fontFamily: fontFamily(theme.fonts.heading), fontWeight: theme.fonts.headingWeight >= 700 ? 700 : theme.fonts.headingWeight, fontSize: u(40), color: theme.palette.text }}>{title}</div>
          {subtitle ? <div style={{ fontFamily: fontFamily(theme.fonts.body), fontSize: u(26), color: theme.palette.muted, marginTop: u(4) }}>{subtitle}</div> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 角标水印：文字或 logo 图片 */
export const Watermark: React.FC<{ text?: string; logo?: string; position?: Corner; opacity?: number; size?: number }> = ({
  text,
  logo,
  position = "top-left",
  opacity = 0.75,
  size = 30,
}) => {
  const theme = useTheme();
  const { u, safeX, safeY } = useLayout();
  const [v, h] = position.split("-") as ["top" | "bottom", "left" | "right"];
  return (
    <AbsoluteFill style={{ justifyContent: v === "top" ? "flex-start" : "flex-end", alignItems: h === "left" ? "flex-start" : "flex-end", padding: `${safeY * 0.55}px ${safeX * 0.55}px`, pointerEvents: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: u(12), opacity }}>
        {logo ? <Img src={resolveSrc(logo)} style={{ height: u(size * 1.5), objectFit: "contain" }} /> : null}
        {text ? <div style={{ fontFamily: fontFamily(theme.fonts.heading), fontWeight: 700, fontSize: u(size), color: theme.palette.text, letterSpacing: "0.04em" }}>{text}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

/** 整片进度条（细线，底部） */
export const FilmProgress: React.FC<{ color?: string; height?: number }> = ({ color, height = 6 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const theme = useTheme();
  const { u } = useLayout();
  const p = interpolate(frame, [0, durationInFrames - 1], [0, 100], { extrapolateRight: "clamp", easing: ease.linear });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", pointerEvents: "none" }}>
      <div style={{ height: u(height), width: `${p}%`, background: color ?? theme.palette.primary, opacity: 0.85 }} />
    </AbsoluteFill>
  );
};
