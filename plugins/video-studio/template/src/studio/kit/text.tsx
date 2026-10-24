import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { alpha, fontFamily, useTheme, type FontName } from "../theme";
import { useLayout } from "./layout";
import { ease, springs } from "./motion";
import { spring } from "remotion";

// 文字组件：整支片子的主体。尺寸参数一律以 u 为单位（1080p 下 = 像素）。
// 标题默认用主题标题字体与字重；正文用正文字体。中文按字拆分、英文按词拆分做逐字/逐词动画。

export type Reveal = "rise" | "fade" | "blur" | "mask" | "scale" | "chars" | "words" | "typewriter" | "none";
type FontRole = "heading" | "body" | "mono";

const LATIN = /[A-Za-z0-9'’\-_.%$€¥+#@&]/;

export interface TextUnit {
  text: string;
  /** 是否是空白（不参与动画、允许换行） */
  space: boolean;
  /** 是否换行符 */
  br: boolean;
  /** 是否属于高亮片段 */
  highlight: boolean;
}

/** 文本拆成动画单元：mode=words 时英文按词、中文按字；mode=chars 时一律按字 */
export const splitUnits = (text: string, mode: "words" | "chars" = "words", highlights: string[] = []): TextUnit[] => {
  // 先按高亮词切段
  type Seg = { text: string; highlight: boolean };
  let segs: Seg[] = [{ text, highlight: false }];
  for (const h of highlights.filter(Boolean)) {
    const next: Seg[] = [];
    for (const s of segs) {
      if (s.highlight) {
        next.push(s);
        continue;
      }
      const parts = s.text.split(h);
      parts.forEach((p, i) => {
        if (p) next.push({ text: p, highlight: false });
        if (i < parts.length - 1) next.push({ text: h, highlight: true });
      });
    }
    segs = next;
  }
  const units: TextUnit[] = [];
  for (const seg of segs) {
    let buf = "";
    const flush = () => {
      if (buf) units.push({ text: buf, space: false, br: false, highlight: seg.highlight });
      buf = "";
    };
    for (const ch of Array.from(seg.text)) {
      if (ch === "\n") {
        flush();
        units.push({ text: "\n", space: false, br: true, highlight: seg.highlight });
      } else if (/\s/.test(ch)) {
        flush();
        units.push({ text: ch, space: true, br: false, highlight: seg.highlight });
      } else if (mode === "words" && LATIN.test(ch)) {
        buf += ch;
      } else {
        flush();
        units.push({ text: ch, space: false, br: false, highlight: seg.highlight });
      }
    }
    flush();
  }
  return units;
};

const useFont = (role: FontRole | FontName = "heading") => {
  const theme = useTheme();
  if (role === "heading") return { family: fontFamily(theme.fonts.heading), weight: theme.fonts.headingWeight, name: theme.fonts.heading };
  if (role === "body") return { family: fontFamily(theme.fonts.body), weight: theme.fonts.bodyWeight, name: theme.fonts.body };
  if (role === "mono") return { family: fontFamily(theme.fonts.mono), weight: 500, name: theme.fonts.mono };
  return { family: fontFamily(role), weight: 700, name: role };
};

const gradientFill = (colors: string[]): React.CSSProperties => ({
  backgroundImage: `linear-gradient(100deg, ${colors.join(", ")})`,
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
  WebkitTextFillColor: "transparent",
});

export interface TitleProps {
  text: string;
  /** 字号（u），缺省 96 */
  size?: number;
  weight?: number;
  color?: string;
  align?: "left" | "center" | "right";
  /** 入场方式，缺省 rise */
  reveal?: Reveal;
  /** 入场开始帧 */
  delay?: number;
  /** 入场时长（帧）；chars/words 为单个单元的时长 */
  duration?: number;
  /** chars/words 相邻单元的间隔帧 */
  stagger?: number;
  /** 渐变填充：true 用主题主色→辅色，或传颜色数组 */
  gradient?: boolean | string[];
  /** 需要用强调色突出的词（原文中的子串） */
  highlight?: string[];
  highlightColor?: string;
  /** 最大宽度（u），超出自动换行 */
  maxWidth?: number;
  lineHeight?: number;
  letterSpacing?: string;
  font?: FontRole | FontName;
  /** 场景结尾前淡出 */
  exit?: boolean;
  /** 加文字阴影（压在图片/视频上时保证可读） */
  shadow?: boolean;
  style?: React.CSSProperties;
}

/** 大标题：多种入场（rise/fade/blur/mask/scale/chars/words/typewriter） */
export const Title: React.FC<TitleProps> = ({
  text,
  size = 96,
  weight,
  color,
  align = "center",
  reveal = "rise",
  delay = 0,
  duration,
  stagger,
  gradient,
  highlight = [],
  highlightColor,
  maxWidth,
  lineHeight = 1.15,
  letterSpacing,
  font = "heading",
  exit = false,
  shadow = false,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const theme = useTheme();
  const { u } = useLayout();
  const f = useFont(font);
  const dur = duration ?? (reveal === "chars" || reveal === "words" ? 14 : 22);
  const exitOpacity = exit
    ? interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 1;
  const fill: React.CSSProperties = gradient
    ? gradientFill(Array.isArray(gradient) ? gradient : [theme.palette.primary, theme.palette.secondary])
    : { color: color ?? theme.palette.text };
  const hiColor = highlightColor ?? theme.palette.primary;
  const base: React.CSSProperties = {
    fontFamily: f.family,
    fontWeight: weight ?? f.weight,
    fontSize: u(size),
    lineHeight,
    letterSpacing: letterSpacing ?? (/[A-Za-z]/.test(text) ? "-0.015em" : "0.02em"),
    textAlign: align,
    maxWidth: maxWidth ? u(maxWidth) : undefined,
    textShadow: shadow ? `0 ${u(4)}px ${u(24)}px rgba(0,0,0,0.55)` : undefined,
    whiteSpace: "pre-wrap",
    wordBreak: "keep-all",
    overflowWrap: "break-word",
    margin: 0,
    opacity: exitOpacity,
    ...style,
  };

  if (reveal === "chars" || reveal === "words") {
    const units = splitUnits(text, reveal, highlight);
    const step = stagger ?? (reveal === "chars" ? 1.6 : 3.5);
    let k = 0;
    return (
      <div style={base}>
        {units.map((un, i) => {
          if (un.br) return <br key={i} />;
          if (un.space) return <span key={i}>{un.text}</span>;
          const d = delay + k++ * step;
          const p = spring({ frame: frame - d, fps, config: springs.snappy, durationInFrames: dur });
          const unitFill = un.highlight ? (gradient ? fill : { color: hiColor }) : fill;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: interpolate(p, [0, 0.6], [0, 1], { extrapolateRight: "clamp" }),
                transform: `translateY(${interpolate(p, [0, 1], [0.45, 0])}em)`,
                filter: p < 0.98 ? `blur(${interpolate(p, [0, 1], [6, 0])}px)` : undefined,
                ...unitFill,
              }}
            >
              {un.text}
            </span>
          );
        })}
      </div>
    );
  }

  const p = interpolate(frame, [delay, delay + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  const content = highlight.length
    ? splitUnits(text, "words", highlight).map((un, i) =>
        un.br ? <br key={i} /> : <span key={i} style={un.highlight ? { color: hiColor } : undefined}>{un.text}</span>,
      )
    : text;

  if (reveal === "typewriter") {
    const chars = Array.from(text);
    const shown = Math.floor(interpolate(frame, [delay, delay + Math.max(dur, chars.length * 2)], [0, chars.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    const cursorOn = Math.floor(frame / 15) % 2 === 0 || shown < chars.length;
    return (
      <div style={{ ...base, ...fill }}>
        {chars.slice(0, shown).join("")}
        <span style={{ opacity: cursorOn ? 1 : 0, color: theme.palette.primary, WebkitTextFillColor: theme.palette.primary }}>▍</span>
      </div>
    );
  }

  if (reveal === "mask") {
    return (
      <div style={{ overflow: "hidden", paddingBottom: "0.08em", maxWidth: base.maxWidth }}>
        <div style={{ ...base, ...fill, transform: `translateY(${(1 - p) * 110}%)` }}>{content}</div>
      </div>
    );
  }

  const motion: React.CSSProperties =
    reveal === "none"
      ? {}
      : reveal === "fade"
        ? { opacity: p * exitOpacity }
        : reveal === "blur"
          ? { opacity: p * exitOpacity, filter: p < 0.99 ? `blur(${(1 - p) * 18}px)` : undefined, transform: `scale(${1.06 - 0.06 * p})` }
          : reveal === "scale"
            ? { opacity: p * exitOpacity, transform: `scale(${0.85 + 0.15 * p})` }
            : { opacity: p * exitOpacity, transform: `translateY(${(1 - p) * 0.5}em)` };
  return <div style={{ ...base, ...fill, ...motion }}>{content}</div>;
};

/** 正文段落：淡入/上移入场，缺省次要文字色 */
export const Text: React.FC<{
  text?: string;
  children?: React.ReactNode;
  size?: number;
  color?: string;
  weight?: number;
  align?: "left" | "center" | "right";
  reveal?: "rise" | "fade" | "none";
  delay?: number;
  duration?: number;
  maxWidth?: number;
  lineHeight?: number;
  font?: FontRole | FontName;
  shadow?: boolean;
  style?: React.CSSProperties;
}> = ({ text, children, size = 40, color, weight, align = "center", reveal = "rise", delay = 0, duration = 20, maxWidth, lineHeight = 1.55, font = "body", shadow = false, style }) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u } = useLayout();
  const f = useFont(font);
  const p = interpolate(frame, [delay, delay + duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  return (
    <div
      style={{
        fontFamily: f.family,
        fontWeight: weight ?? f.weight,
        fontSize: u(size),
        lineHeight,
        color: color ?? theme.palette.muted,
        textAlign: align,
        maxWidth: maxWidth ? u(maxWidth) : undefined,
        whiteSpace: "pre-wrap",
        textShadow: shadow ? `0 ${u(2)}px ${u(16)}px rgba(0,0,0,0.6)` : undefined,
        opacity: reveal === "none" ? 1 : p,
        transform: reveal === "rise" ? `translateY(${(1 - p) * u(24)}px)` : undefined,
        margin: 0,
        ...style,
      }}
    >
      {text ?? children}
    </div>
  );
};

/** 小标签（kicker）：标题上方的分类/引导语，带强调色短线 */
export const Kicker: React.FC<{ text: string; color?: string; size?: number; delay?: number; line?: boolean; align?: "left" | "center" }> = ({
  text,
  color,
  size = 26,
  delay = 0,
  line = true,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u } = useLayout();
  const p = interpolate(frame, [delay, delay + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  const c = color ?? theme.palette.primary;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : "flex-start",
        gap: u(14),
        opacity: p,
        transform: `translateY(${(1 - p) * u(12)}px)`,
      }}
    >
      {line && <div style={{ width: u(48) * p, height: u(3), borderRadius: u(2), background: c }} />}
      <div
        style={{
          fontFamily: fontFamily(theme.fonts.body),
          fontSize: u(size),
          fontWeight: 600,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: c,
        }}
      >
        {text}
      </div>
    </div>
  );
};

/** 荧光笔高亮：文字背后一道色块从左扫到右 */
export const Marker: React.FC<{ children: React.ReactNode; color?: string; delay?: number; duration?: number; opacity?: number }> = ({
  children,
  color,
  delay = 10,
  duration = 16,
  opacity = 0.45,
}) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const p = interpolate(frame, [delay, delay + duration], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.inOut });
  const c = alpha(color ?? theme.palette.accent, opacity);
  return (
    <span
      style={{
        backgroundImage: `linear-gradient(${c}, ${c})`,
        backgroundRepeat: "no-repeat",
        backgroundSize: `${p}% 42%`,
        backgroundPosition: "0 88%",
        padding: "0 0.08em",
      }}
    >
      {children}
    </span>
  );
};

/** 渐变文字（行内） */
export const GradientText: React.FC<{ children: React.ReactNode; colors?: string[] }> = ({ children, colors }) => {
  const theme = useTheme();
  return <span style={gradientFill(colors ?? [theme.palette.primary, theme.palette.secondary])}>{children}</span>;
};

/** 数字滚动：from → to，支持小数位、前后缀、千分位 */
export const CountUp: React.FC<{
  to: number;
  from?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  separator?: boolean;
  delay?: number;
  duration?: number;
  size?: number;
  color?: string;
  weight?: number;
  font?: FontRole | FontName;
  style?: React.CSSProperties;
}> = ({ to, from = 0, decimals = 0, prefix = "", suffix = "", separator = true, delay = 0, duration = 45, size = 120, color, weight, font = "heading", style }) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u } = useLayout();
  const f = useFont(font);
  const p = interpolate(frame, [delay, delay + duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  const v = from + (to - from) * p;
  const fixed = v.toFixed(decimals);
  const [int, dec] = fixed.split(".");
  const intFmt = separator ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
  return (
    <span
      style={{
        fontFamily: f.family,
        fontWeight: weight ?? f.weight,
        fontSize: u(size),
        color: color ?? theme.palette.text,
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1,
        ...style,
      }}
    >
      {prefix}
      {intFmt}
      {dec !== undefined ? `.${dec}` : ""}
      {suffix}
    </span>
  );
};

/**
 * 自适应字号：按文字长度估算，保证一行放得下 maxWidth（u）。
 * 估算与字体加载无关（中文 1em/字、英文约 0.56em/字），渲染与预览结果一致。
 */
export const fitFontSize = (text: string, maxWidth: number, maxSize = 120, minSize = 28): number => {
  let em = 0;
  for (const ch of Array.from(text)) {
    if (/\s/.test(ch)) em += 0.3;
    else if (/[\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF\u3000-\u303F]/.test(ch)) em += 1.0;
    else if (/[A-Z0-9]/.test(ch)) em += 0.66;
    else em += 0.54;
  }
  if (em <= 0) return maxSize;
  return Math.max(minSize, Math.min(maxSize, Math.floor(maxWidth / em)));
};

/** 单行自适应标题：<FitText text="..." maxWidth={1500} /> */
export const FitText: React.FC<Omit<TitleProps, "size"> & { maxWidth: number; maxSize?: number; minSize?: number }> = ({
  text,
  maxWidth,
  maxSize = 140,
  minSize = 28,
  ...rest
}) => <Title {...rest} text={text} maxWidth={maxWidth} size={fitFontSize(text, maxWidth, maxSize, minSize)} />;
