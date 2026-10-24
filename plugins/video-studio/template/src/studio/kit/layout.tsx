import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { useTheme } from "../theme";

// 布局与尺寸：kit 的一切尺寸以「u」为单位——1u = 画面短边 / 1080。
// 1920×1080、1080×1920、1080×1080 下 1u 都是 1px，横竖屏切换时排版自动等比适配。

export interface LayoutInfo {
  width: number;
  height: number;
  /** 1u 对应的像素 */
  unit: number;
  isPortrait: boolean;
  isSquare: boolean;
  /** 安全边距（像素）：标题/字幕不要出这个框 */
  safeX: number;
  safeY: number;
  /** n 个 u 换算成像素 */
  u: (n: number) => number;
  /** 宽度百分比换算像素 */
  vw: (percent: number) => number;
  /** 高度百分比换算像素 */
  vh: (percent: number) => number;
}

export const useLayout = (): LayoutInfo => {
  const { width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 1080;
  const isPortrait = height > width * 1.05;
  const isSquare = !isPortrait && width < height * 1.05;
  return {
    width,
    height,
    unit,
    isPortrait,
    isSquare,
    safeX: Math.round(width * (isPortrait ? 0.08 : 0.07)),
    safeY: Math.round(height * (isPortrait ? 0.07 : 0.09)),
    u: (n: number) => n * unit,
    vw: (p: number) => (width * p) / 100,
    vh: (p: number) => (height * p) / 100,
  };
};

type Align = "center" | "start" | "end" | "stretch" | "space-between";
const flexAlign = (a?: Align): React.CSSProperties["alignItems"] =>
  a === "start" ? "flex-start" : a === "end" ? "flex-end" : a === "space-between" ? "stretch" : a ?? "center";
const flexJustify = (a?: Align): React.CSSProperties["justifyContent"] =>
  a === "start" ? "flex-start" : a === "end" ? "flex-end" : a === "space-between" ? "space-between" : a === "stretch" ? "stretch" : a ?? "center";

/**
 * 舞台：整帧内容容器（安全边距 + 主题文字色 + flex 排版）。每个场景的内容层用它。
 * 缺省透明——先放 <Background/> 打底，再放 <Stage>；需要纯色底时传 background。
 */
export const Stage: React.FC<{
  children?: React.ReactNode;
  background?: string | false;
  /** 内容对齐：垂直方向 */
  align?: Align;
  /** 内容对齐：水平方向 */
  justify?: Align;
  /** 去掉安全边距（满版画面） */
  bleed?: boolean;
  direction?: "column" | "row";
  gap?: number;
  style?: React.CSSProperties;
}> = ({ children, background, align = "center", justify = "center", bleed = false, direction = "column", gap = 0, style }) => {
  const theme = useTheme();
  const { safeX, safeY, u } = useLayout();
  return (
    <AbsoluteFill
      style={{
        background: background === false ? undefined : background,
        color: theme.palette.text,
        padding: bleed ? 0 : `${safeY}px ${safeX}px`,
        display: "flex",
        flexDirection: direction,
        justifyContent: direction === "column" ? flexJustify(align) : flexJustify(justify),
        alignItems: direction === "column" ? flexAlign(justify) : flexAlign(align),
        gap: u(gap),
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** 叠层：满画面绝对定位容器（背景、装饰、前景分层用） */
export const Layer: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties; pointer?: boolean }> = ({ children, style }) => (
  <AbsoluteFill style={style}>{children}</AbsoluteFill>
);

/** 弹性排列：gap 以 u 为单位 */
export const Stack: React.FC<{
  children?: React.ReactNode;
  direction?: "column" | "row";
  gap?: number;
  align?: Align;
  justify?: Align;
  wrap?: boolean;
  style?: React.CSSProperties;
}> = ({ children, direction = "column", gap = 24, align = "center", justify = "center", wrap = false, style }) => {
  const { u } = useLayout();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: direction,
        gap: u(gap),
        alignItems: flexAlign(align),
        justifyContent: flexJustify(justify),
        flexWrap: wrap ? "wrap" : "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** 居中容器 */
export const Center: React.FC<{ children?: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <AbsoluteFill style={{ display: "flex", alignItems: "center", justifyContent: "center", ...style }}>{children}</AbsoluteFill>
);

/** 网格：columns 列等宽，gap 以 u 为单位 */
export const Grid: React.FC<{
  children?: React.ReactNode;
  columns?: number;
  gap?: number;
  style?: React.CSSProperties;
}> = ({ children, columns = 3, gap = 32, style }) => {
  const { u } = useLayout();
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: u(gap),
        width: "100%",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** 分栏：左右（竖屏自动上下）两栏，ratio 为左栏占比 */
export const Split: React.FC<{
  left: React.ReactNode;
  right: React.ReactNode;
  ratio?: number;
  gap?: number;
  style?: React.CSSProperties;
}> = ({ left, right, ratio = 0.5, gap = 64, style }) => {
  const { u, isPortrait } = useLayout();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isPortrait ? "column" : "row",
        gap: u(gap),
        width: "100%",
        height: "100%",
        alignItems: "center",
        ...style,
      }}
    >
      <div style={{ flex: ratio, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>{left}</div>
      <div style={{ flex: 1 - ratio, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>{right}</div>
    </div>
  );
};
