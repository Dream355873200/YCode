import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { alpha, fontFamily, mixColor, useTheme } from "../theme";
import { useLayout } from "./layout";
import { ease, springs } from "./motion";
import { CountUp } from "./text";

// 面板与信息块：卡片、数据卡、特性卡、徽章、按钮、引言。尺寸单位均为 u。
// 所有组件都自带入场（delay 控制先后），列表用 stagger(i) 错开即可。

const useEnter = (delay: number, preset: keyof typeof springs = "snappy") => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: springs[preset] });
};

export type CardVariant = "glass" | "solid" | "outline" | "gradient" | "elevated";

/** 卡片：玻璃/实色/描边/渐变/悬浮 五种质感，自带弹性入场 */
export const Card: React.FC<{
  children?: React.ReactNode;
  variant?: CardVariant;
  padding?: number;
  radius?: number;
  width?: number | string;
  height?: number | string;
  delay?: number;
  /** 入场方式：pop 弹出 / rise 上移 / fade 淡入 / none */
  enter?: "pop" | "rise" | "fade" | "none";
  glow?: boolean;
  accent?: string;
  style?: React.CSSProperties;
}> = ({ children, variant = "glass", padding = 48, radius, width, height, delay = 0, enter = "rise", glow = false, accent, style }) => {
  const theme = useTheme();
  const { u } = useLayout();
  const p = useEnter(delay);
  const c = accent ?? theme.palette.primary;
  const dark = theme.mode === "dark";
  const surfaces: Record<CardVariant, React.CSSProperties> = {
    glass: {
      background: dark ? "linear-gradient(160deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03))" : "rgba(255,255,255,0.72)",
      border: `${u(1.5)}px solid ${dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.06)"}`,
      boxShadow: dark ? `0 ${u(30)}px ${u(80)}px rgba(0,0,0,0.35)` : `0 ${u(24)}px ${u(60)}px rgba(15,23,42,0.10)`,
    },
    solid: { background: theme.palette.surface, border: `${u(1.5)}px solid ${theme.palette.border}` },
    outline: { background: "transparent", border: `${u(2)}px solid ${alpha(c, 0.6)}` },
    gradient: {
      background: `linear-gradient(145deg, ${alpha(c, 0.9)}, ${alpha(theme.palette.secondary, 0.85)})`,
      color: "#FFFFFF",
      boxShadow: `0 ${u(30)}px ${u(80)}px ${alpha(c, 0.35)}`,
    },
    elevated: {
      background: theme.palette.surface,
      boxShadow: dark ? `0 ${u(40)}px ${u(100)}px rgba(0,0,0,0.55)` : `0 ${u(30)}px ${u(80)}px rgba(15,23,42,0.14)`,
    },
  };
  const motion: React.CSSProperties =
    enter === "none"
      ? {}
      : enter === "fade"
        ? { opacity: p }
        : enter === "pop"
          ? { opacity: Math.min(1, p * 1.4), transform: `scale(${0.82 + 0.18 * p})` }
          : { opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * u(60)}px)` };
  return (
    <div
      style={{
        borderRadius: u(radius ?? theme.radius),
        padding: u(padding),
        width: typeof width === "number" ? u(width) : width,
        height: typeof height === "number" ? u(height) : height,
        boxSizing: "border-box",
        position: "relative",
        ...surfaces[variant],
        ...(glow ? { boxShadow: `0 0 ${u(60)}px ${alpha(c, 0.45)}, ${surfaces[variant].boxShadow ?? ""}`.replace(/, $/, "") } : {}),
        ...motion,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** 图标徽章：圆角方块/圆形底 + 图标（传 lucide-react 图标元素） */
export const IconBadge: React.FC<{
  icon: React.ReactNode;
  size?: number;
  color?: string;
  shape?: "rounded" | "circle";
  variant?: "soft" | "solid";
  delay?: number;
}> = ({ icon, size = 96, color, shape = "rounded", variant = "soft", delay = 0 }) => {
  const theme = useTheme();
  const { u } = useLayout();
  const p = useEnter(delay, "bouncy");
  const c = color ?? theme.palette.primary;
  return (
    <div
      style={{
        width: u(size),
        height: u(size),
        borderRadius: shape === "circle" ? "50%" : u(size * 0.28),
        background: variant === "solid" ? `linear-gradient(145deg, ${c}, ${mixColor(c, "#000000", 0.25)})` : alpha(c, 0.16),
        border: variant === "soft" ? `${u(1.5)}px solid ${alpha(c, 0.35)}` : undefined,
        color: variant === "solid" ? "#FFFFFF" : c,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transform: `scale(${p})`,
        boxShadow: variant === "solid" ? `0 ${u(14)}px ${u(36)}px ${alpha(c, 0.4)}` : undefined,
      }}
    >
      {React.isValidElement(icon)
        ? React.cloneElement(icon as React.ReactElement<{ size?: number; strokeWidth?: number }>, {
            size: u(size * 0.5),
            strokeWidth: 1.9,
          })
        : icon}
    </div>
  );
};

/** 数据卡：大数字（自动滚动）+ 标签 + 可选涨幅 */
export const StatCard: React.FC<{
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  delta?: string;
  icon?: React.ReactNode;
  color?: string;
  delay?: number;
  variant?: CardVariant;
  width?: number;
  /** 数字字号（u），缺省 96；竖屏两列时建议 72-80 */
  valueSize?: number;
}> = ({ value, label, prefix, suffix, decimals = 0, delta, icon, color, delay = 0, variant = "glass", width, valueSize = 96 }) => {
  const theme = useTheme();
  const { u } = useLayout();
  const c = color ?? theme.palette.primary;
  return (
    <Card variant={variant} delay={delay} padding={valueSize < 90 ? 36 : 44} width={width}>
      <div style={{ display: "flex", flexDirection: "column", gap: u(14), alignItems: "flex-start" }}>
        {icon ? <IconBadge icon={icon} size={72} color={variant === "gradient" ? "#FFFFFF" : c} delay={delay + 4} /> : null}
        <CountUp to={value} prefix={prefix} suffix={suffix} decimals={decimals} delay={delay + 6} size={valueSize} color={variant === "gradient" ? "#FFFFFF" : c} />
        <div style={{ fontFamily: fontFamily(theme.fonts.body), fontSize: u(32), color: variant === "gradient" ? "rgba(255,255,255,0.85)" : theme.palette.muted }}>
          {label}
        </div>
        {delta ? (
          <div
            style={{
              fontFamily: fontFamily(theme.fonts.body),
              fontSize: u(24),
              fontWeight: 600,
              color: delta.trim().startsWith("-") ? "#F87171" : "#4ADE80",
            }}
          >
            {delta}
          </div>
        ) : null}
      </div>
    </Card>
  );
};

/** 特性卡：图标 + 标题 + 说明 */
export const FeatureCard: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  color?: string;
  delay?: number;
  variant?: CardVariant;
  width?: number;
  layout?: "vertical" | "horizontal";
}> = ({ icon, title, description, color, delay = 0, variant = "glass", width, layout = "vertical" }) => {
  const theme = useTheme();
  const { u } = useLayout();
  const horizontal = layout === "horizontal";
  return (
    <Card variant={variant} delay={delay} padding={horizontal ? 36 : 44} width={width}>
      <div style={{ display: "flex", flexDirection: horizontal ? "row" : "column", gap: u(horizontal ? 28 : 22), alignItems: horizontal ? "center" : "flex-start" }}>
        {icon ? <IconBadge icon={icon} size={horizontal ? 84 : 88} color={variant === "gradient" ? "#FFFFFF" : color} delay={delay + 4} /> : null}
        <div style={{ display: "flex", flexDirection: "column", gap: u(10) }}>
          <div style={{ fontFamily: fontFamily(theme.fonts.heading), fontWeight: theme.fonts.headingWeight, fontSize: u(42), color: variant === "gradient" ? "#FFFFFF" : theme.palette.text, lineHeight: 1.2 }}>
            {title}
          </div>
          {description ? (
            <div style={{ fontFamily: fontFamily(theme.fonts.body), fontSize: u(28), lineHeight: 1.5, color: variant === "gradient" ? "rgba(255,255,255,0.85)" : theme.palette.muted }}>
              {description}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};

/** 胶囊标签 */
export const Pill: React.FC<{ children: React.ReactNode; color?: string; size?: number; delay?: number; variant?: "soft" | "solid" | "outline" }> = ({
  children,
  color,
  size = 26,
  delay = 0,
  variant = "soft",
}) => {
  const theme = useTheme();
  const { u } = useLayout();
  const p = useEnter(delay);
  const c = color ?? theme.palette.primary;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: u(10),
        padding: `${u(size * 0.45)}px ${u(size * 0.95)}px`,
        borderRadius: 999,
        fontFamily: fontFamily(theme.fonts.body),
        fontSize: u(size),
        fontWeight: 600,
        color: variant === "solid" ? "#FFFFFF" : c,
        background: variant === "solid" ? c : variant === "soft" ? alpha(c, 0.14) : "transparent",
        border: variant === "outline" || variant === "soft" ? `${u(1.5)}px solid ${alpha(c, 0.45)}` : undefined,
        opacity: p,
        transform: `scale(${0.9 + 0.1 * p})`,
      }}
    >
      {children}
    </span>
  );
};

/** 行动按钮（CTA）：渐变底 + 呼吸光晕 */
export const Button: React.FC<{ label: string; icon?: React.ReactNode; color?: string; size?: number; delay?: number; pulse?: boolean }> = ({
  label,
  icon,
  color,
  size = 40,
  delay = 0,
  pulse = true,
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const p = useEnter(delay, "bouncy");
  const c = color ?? theme.palette.primary;
  const glow = pulse ? 0.35 + 0.25 * (0.5 + 0.5 * Math.sin((frame - delay) / 9)) : 0.35;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: u(16),
        padding: `${u(size * 0.62)}px ${u(size * 1.5)}px`,
        borderRadius: 999,
        background: `linear-gradient(135deg, ${c}, ${theme.palette.secondary})`,
        color: "#FFFFFF",
        fontFamily: fontFamily(theme.fonts.body),
        fontWeight: 700,
        fontSize: u(size),
        boxShadow: `0 ${u(18)}px ${u(50)}px ${alpha(c, glow)}`,
        transform: `scale(${p})`,
      }}
    >
      {icon && React.isValidElement(icon)
        ? React.cloneElement(icon as React.ReactElement<{ size?: number; strokeWidth?: number }>, { size: u(size * 1.05), strokeWidth: 2.2 })
        : icon}
      {label}
    </div>
  );
};

/** 引言：大号引号 + 引文 + 署名 */
export const Quote: React.FC<{ text: string; author?: string; role?: string; delay?: number; size?: number; maxWidth?: number }> = ({
  text,
  author,
  role,
  delay = 0,
  size = 56,
  maxWidth = 1400,
}) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const p = interpolate(frame, [delay, delay + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  const p2 = interpolate(frame, [delay + 16, delay + 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: u(28), maxWidth: u(maxWidth) }}>
      <div style={{ fontFamily: fontFamily("Playfair Display"), fontSize: u(180), lineHeight: 0.6, color: theme.palette.primary, opacity: p, height: u(80) }}>“</div>
      <div
        style={{
          fontFamily: fontFamily(theme.fonts.heading),
          fontWeight: theme.fonts.headingWeight >= 700 ? 600 : theme.fonts.headingWeight,
          fontSize: u(size),
          lineHeight: 1.45,
          textAlign: "center",
          color: theme.palette.text,
          opacity: p,
          transform: `translateY(${(1 - p) * u(20)}px)`,
        }}
      >
        {text}
      </div>
      {author ? (
        <div style={{ fontFamily: fontFamily(theme.fonts.body), fontSize: u(30), color: theme.palette.muted, opacity: p2 }}>
          — {author}
          {role ? <span style={{ opacity: 0.7 }}> · {role}</span> : null}
        </div>
      ) : null}
    </div>
  );
};

/** 头像：图片或首字母圆 */
export const Avatar: React.FC<{ name: string; src?: string; size?: number; color?: string; delay?: number }> = ({ name, src, size = 120, color, delay = 0 }) => {
  const theme = useTheme();
  const { u } = useLayout();
  const p = useEnter(delay, "bouncy");
  const c = color ?? theme.palette.primary;
  return (
    <div
      style={{
        width: u(size),
        height: u(size),
        borderRadius: "50%",
        overflow: "hidden",
        background: `linear-gradient(145deg, ${c}, ${theme.palette.secondary})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#FFFFFF",
        fontFamily: fontFamily(theme.fonts.heading),
        fontWeight: 700,
        fontSize: u(size * 0.42),
        border: `${u(4)}px solid ${alpha("#FFFFFF", 0.85)}`,
        transform: `scale(${p})`,
        flexShrink: 0,
      }}
    >
      {src ? <img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : Array.from(name)[0]}
    </div>
  );
};

/** 分隔线：从中间向两侧展开 */
export const Divider: React.FC<{ width?: number; color?: string; delay?: number; thickness?: number }> = ({ width = 240, color, delay = 0, thickness = 3 }) => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const { u } = useLayout();
  const p = interpolate(frame, [delay, delay + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  return <div style={{ width: u(width) * p, height: u(thickness), borderRadius: u(thickness), background: color ?? theme.palette.primary }} />;
};
