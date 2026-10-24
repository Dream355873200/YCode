import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { resolveSrc } from "../manifest";
import { alpha, fontFamily, useTheme } from "../theme";
import { useLayout } from "./layout";
import { ease } from "./motion";

// 媒体：图片/视频素材与设备样机。素材路径写 public/ 下的相对路径（assets/hero.png、
// uploads/logo.png、clips/shot1.mp4），组件内部经 staticFile 解析；http(s) URL 原样使用。

/** public/ 素材路径 → 可加载 URL（与 staticFile 等价，额外兼容 http URL 与 "public/" 前缀） */
export const asset = (path: string): string => resolveSrc(path);

/** 推拉摇移（Ken Burns）：静态图片做缓慢的缩放平移，把图片变成镜头 */
export const KenBurns: React.FC<{
  src: string;
  /** 起止缩放 */
  zoom?: [number, number];
  /** 起止平移（百分比，正值向右/下） */
  pan?: [[number, number], [number, number]];
  fit?: "cover" | "contain";
  /** 叠一层底部渐变（压字幕/标题用） */
  shade?: boolean;
  style?: React.CSSProperties;
}> = ({ src, zoom = [1.05, 1.18], pan = [[0, 0], [-2, -1.5]], fit = "cover", shade = false, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: "clamp", easing: ease.inOut });
  const s = zoom[0] + (zoom[1] - zoom[0]) * t;
  const x = pan[0][0] + (pan[1][0] - pan[0][0]) * t;
  const y = pan[0][1] + (pan[1][1] - pan[0][1]) * t;
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      <Img src={asset(src)} style={{ width: "100%", height: "100%", objectFit: fit, transform: `scale(${s}) translate(${x}%, ${y}%)` }} />
      {shade ? <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.65) 100%)" }} /> : null}
    </AbsoluteFill>
  );
};

/** 图片框：圆角 + 阴影 + 入场 */
export const ImageFrame: React.FC<{
  src: string;
  width?: number;
  height?: number;
  radius?: number;
  fit?: "cover" | "contain";
  delay?: number;
  border?: boolean;
  style?: React.CSSProperties;
}> = ({ src, width = 900, height = 600, radius, fit = "cover", delay = 0, border = true, style }) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u } = useLayout();
  const p = interpolate(frame, [delay, delay + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  return (
    <div
      style={{
        width: u(width),
        height: u(height),
        borderRadius: u(radius ?? theme.radius),
        overflow: "hidden",
        boxShadow: `0 ${u(30)}px ${u(80)}px rgba(0,0,0,0.4)`,
        border: border ? `${u(2)}px solid ${theme.palette.border}` : undefined,
        opacity: p,
        transform: `translateY(${(1 - p) * u(40)}px) scale(${0.96 + 0.04 * p})`,
        ...style,
      }}
    >
      <Img src={asset(src)} style={{ width: "100%", height: "100%", objectFit: fit }} />
    </div>
  );
};

/** 视频片段：铺满画面播放素材（AI 生成镜头/用户上传视频） */
export const VideoClip: React.FC<{
  src: string;
  fit?: "cover" | "contain";
  trimStart?: number;
  volume?: number;
  muted?: boolean;
  shade?: boolean;
  style?: React.CSSProperties;
}> = ({ src, fit = "cover", trimStart = 0, volume = 1, muted = false, shade = false, style }) => (
  <AbsoluteFill style={{ background: "#000", ...style }}>
    <OffthreadVideo src={asset(src)} startFrom={trimStart} volume={muted ? 0 : volume} muted={muted} style={{ width: "100%", height: "100%", objectFit: fit }} />
    {shade ? <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 50%, rgba(0,0,0,0.7) 100%)" }} /> : null}
  </AbsoluteFill>
);

/**
 * 设备样机：手机 / 笔记本 / 浏览器窗口，children 是屏幕内容（可放 ImageFrame/任意组件）。
 * 尺寸 width 为样机外框宽度（u），高度按设备比例自动算。
 */
export const DeviceFrame: React.FC<{
  type?: "phone" | "laptop" | "browser";
  width?: number;
  children?: React.ReactNode;
  /** 屏幕内容直接放一张图 */
  screen?: string;
  url?: string;
  delay?: number;
  tilt?: boolean;
}> = ({ type = "phone", width, children, screen, url = "example.com", delay = 0, tilt = false }) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u } = useLayout();
  const p = interpolate(frame, [delay, delay + 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  const content = screen ? <Img src={asset(screen)} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : children;
  const enter: React.CSSProperties = {
    opacity: p,
    transform: `translateY(${(1 - p) * u(80)}px) ${tilt ? `perspective(${u(2400)}px) rotateY(-14deg) rotateX(6deg)` : ""}`,
  };
  if (type === "phone") {
    const w = u(width ?? 420);
    const h = w * 2.08;
    return (
      <div style={{ width: w, height: h, borderRadius: w * 0.14, background: "#0B0B0F", padding: w * 0.035, boxShadow: `0 ${u(40)}px ${u(100)}px rgba(0,0,0,0.5), inset 0 0 0 ${u(2)}px #2A2A33`, boxSizing: "border-box", position: "relative", ...enter }}>
        <div style={{ width: "100%", height: "100%", borderRadius: w * 0.11, overflow: "hidden", background: theme.palette.surface, position: "relative" }}>
          {content}
          <div style={{ position: "absolute", top: w * 0.03, left: "50%", transform: "translateX(-50%)", width: w * 0.3, height: w * 0.075, borderRadius: 999, background: "#0B0B0F" }} />
        </div>
      </div>
    );
  }
  if (type === "laptop") {
    const w = u(width ?? 1300);
    const screenH = w * 0.6;
    return (
      <div style={{ width: w, display: "flex", flexDirection: "column", alignItems: "center", ...enter }}>
        <div style={{ width: w * 0.86, height: screenH, borderRadius: `${w * 0.02}px ${w * 0.02}px 0 0`, background: "#0B0B0F", padding: w * 0.012, boxSizing: "border-box", boxShadow: `0 ${u(30)}px ${u(80)}px rgba(0,0,0,0.45)` }}>
          <div style={{ width: "100%", height: "100%", overflow: "hidden", borderRadius: w * 0.006, background: theme.palette.surface, position: "relative" }}>{content}</div>
        </div>
        <div style={{ width: w, height: w * 0.028, borderRadius: `0 0 ${w * 0.02}px ${w * 0.02}px`, background: "linear-gradient(180deg, #C9CBD3, #8E9099)" }} />
      </div>
    );
  }
  const w = u(width ?? 1400);
  return (
    <div style={{ width: w, borderRadius: u(18), overflow: "hidden", background: theme.palette.surface, border: `${u(1.5)}px solid ${theme.palette.border}`, boxShadow: `0 ${u(40)}px ${u(100)}px rgba(0,0,0,0.45)`, ...enter }}>
      <div style={{ height: u(56), display: "flex", alignItems: "center", gap: u(10), padding: `0 ${u(22)}px`, background: alpha(theme.palette.text, 0.05), borderBottom: `${u(1.5)}px solid ${theme.palette.border}` }}>
        {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
          <div key={c} style={{ width: u(16), height: u(16), borderRadius: "50%", background: c }} />
        ))}
        <div style={{ marginLeft: u(24), flex: 1, height: u(32), borderRadius: u(10), background: alpha(theme.palette.text, 0.07), display: "flex", alignItems: "center", padding: `0 ${u(16)}px`, fontFamily: fontFamily(theme.fonts.body), fontSize: u(20), color: theme.palette.muted }}>{url}</div>
      </div>
      <div style={{ width: "100%", height: w * 0.56, position: "relative", overflow: "hidden" }}>{content}</div>
    </div>
  );
};
