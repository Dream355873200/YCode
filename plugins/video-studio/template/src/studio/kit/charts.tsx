import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { evolvePath } from "@remotion/paths";
import { alpha, fontFamily, useTheme } from "../theme";
import { useLayout } from "./layout";
import { ease, springs } from "./motion";

// 数据可视化：柱状图/折线图/环形图/进度条/步骤时间线/清单。全部逐帧生长，delay 控制起点。
// 数据直接传数组；颜色缺省按主题 primary → secondary → accent 轮换。

const seriesColors = (p: { primary: string; secondary: string; accent: string }) => [p.primary, p.secondary, p.accent];

export interface Datum {
  label: string;
  value: number;
  color?: string;
}

/** 柱状图：竖向（缺省）或横向，柱子交错生长，数值随柱顶滚动 */
export const BarChart: React.FC<{
  data: Datum[];
  max?: number;
  horizontal?: boolean;
  width?: number;
  height?: number;
  delay?: number;
  stagger?: number;
  showValues?: boolean;
  valueSuffix?: string;
  decimals?: number;
  color?: string;
}> = ({ data, max, horizontal = false, width = 1200, height = 560, delay = 0, stagger = 6, showValues = true, valueSuffix = "", decimals = 0, color }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u } = useLayout();
  const top = max ?? Math.max(...data.map((d) => d.value), 1);
  const colors = seriesColors(theme.palette);
  const font = fontFamily(theme.fonts.body);
  return (
    <div
      style={{
        width: u(width),
        height: u(height),
        display: "flex",
        flexDirection: horizontal ? "column" : "row",
        alignItems: horizontal ? "stretch" : "flex-end",
        justifyContent: "space-around",
        gap: u(horizontal ? 22 : 28),
      }}
    >
      {data.map((d, i) => {
        const p = spring({ frame: frame - delay - i * stagger, fps, config: springs.gentle });
        const c = d.color ?? color ?? colors[i % colors.length];
        const ratio = (d.value / top) * p;
        const valueText = `${(d.value * p).toFixed(decimals)}${valueSuffix}`;
        if (horizontal) {
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: u(24) }}>
              <div style={{ width: u(220), fontFamily: font, fontSize: u(30), color: theme.palette.muted, textAlign: "right", flexShrink: 0 }}>{d.label}</div>
              <div style={{ flex: 1, height: u(46), background: alpha(theme.palette.text, 0.07), borderRadius: u(12), overflow: "hidden" }}>
                <div style={{ width: `${ratio * 100}%`, height: "100%", borderRadius: u(12), background: `linear-gradient(90deg, ${alpha(c, 0.7)}, ${c})` }} />
              </div>
              {showValues ? <div style={{ width: u(150), fontFamily: font, fontSize: u(32), fontWeight: 700, color: theme.palette.text, fontVariantNumeric: "tabular-nums" }}>{valueText}</div> : null}
            </div>
          );
        }
        return (
          <div key={i} style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: u(16) }}>
            {showValues ? (
              <div style={{ fontFamily: font, fontSize: u(34), fontWeight: 700, color: theme.palette.text, opacity: Math.min(1, p * 1.5), fontVariantNumeric: "tabular-nums" }}>{valueText}</div>
            ) : null}
            <div
              style={{
                width: "62%",
                height: `${ratio * 78}%`,
                minHeight: u(4),
                borderRadius: `${u(14)}px ${u(14)}px ${u(4)}px ${u(4)}px`,
                background: `linear-gradient(180deg, ${c}, ${alpha(c, 0.55)})`,
                boxShadow: `0 ${u(10)}px ${u(40)}px ${alpha(c, 0.3)}`,
              }}
            />
            <div style={{ fontFamily: font, fontSize: u(28), color: theme.palette.muted, textAlign: "center", whiteSpace: "nowrap" }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
};

/** 折线图：路径逐帧绘出 + 面积渐变 + 数据点弹出 */
export const LineChart: React.FC<{
  data: number[];
  labels?: string[];
  width?: number;
  height?: number;
  color?: string;
  delay?: number;
  duration?: number;
  area?: boolean;
  dots?: boolean;
  min?: number;
  max?: number;
  strokeWidth?: number;
}> = ({ data, labels, width = 1300, height = 560, color, delay = 0, duration = 50, area = true, dots = true, min, max, strokeWidth = 6 }) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u } = useLayout();
  const c = color ?? theme.palette.primary;
  const w = u(width);
  const h = u(height);
  const pad = u(28);
  const lo = min ?? Math.min(...data);
  const hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => ({
    x: pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2),
    y: pad + (1 - (v - lo) / span) * (h - pad * 2 - (labels ? u(50) : 0)),
  }));
  // Catmull-Rom → 三次贝塞尔，曲线平滑
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  const progress = interpolate(frame, [delay, delay + duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.inOut });
  const evolved = evolvePath(progress, d);
  const baseY = h - pad - (labels ? u(50) : 0);
  const areaD = `${d} L ${pts[pts.length - 1].x} ${baseY} L ${pts[0].x} ${baseY} Z`;
  const gradId = `lc-grad-${c.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.35} />
          <stop offset="100%" stopColor={c} stopOpacity={0} />
        </linearGradient>
        <clipPath id={`${gradId}-clip`}>
          <rect x={0} y={0} width={w * progress} height={h} />
        </clipPath>
      </defs>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={pad} x2={w - pad} y1={pad + g * (baseY - pad)} y2={pad + g * (baseY - pad)} stroke={alpha(theme.palette.text, 0.08)} strokeWidth={u(1.5)} />
      ))}
      {area ? <path d={areaD} fill={`url(#${gradId})`} clipPath={`url(#${gradId}-clip)`} /> : null}
      <path d={d} fill="none" stroke={c} strokeWidth={u(strokeWidth)} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={evolved.strokeDasharray} strokeDashoffset={evolved.strokeDashoffset} />
      {dots
        ? pts.map((p, i) => {
            const t = i / Math.max(1, pts.length - 1);
            const s = interpolate(progress, [t - 0.02, t + 0.06], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return <circle key={i} cx={p.x} cy={p.y} r={u(strokeWidth * 1.6) * s} fill={theme.palette.background} stroke={c} strokeWidth={u(strokeWidth * 0.7)} />;
          })
        : null}
      {labels
        ? labels.map((l, i) => (
            <text key={i} x={pts[i]?.x ?? 0} y={h - u(8)} textAnchor="middle" fontSize={u(26)} fill={theme.palette.muted} fontFamily={fontFamily(theme.fonts.body)}>
              {l}
            </text>
          ))
        : null}
    </svg>
  );
};

/** 环形图：单值百分比（value 0-100）或多段 segments */
export const DonutChart: React.FC<{
  value?: number;
  segments?: Datum[];
  size?: number;
  thickness?: number;
  delay?: number;
  duration?: number;
  label?: string;
  showValue?: boolean;
  color?: string;
}> = ({ value, segments, size = 420, thickness = 46, delay = 0, duration = 45, label, showValue = true, color }) => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  const { u } = useLayout();
  const s = u(size);
  const r = (s - u(thickness)) / 2;
  const circ = 2 * Math.PI * r;
  const progress = interpolate(frame, [delay, delay + duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.out });
  const colors = seriesColors(theme.palette);
  const segs: Datum[] = segments ?? [{ label: label ?? "", value: value ?? 0, color }];
  const total = segments ? segs.reduce((a, b) => a + b.value, 0) || 1 : 100;
  let acc = 0;
  return (
    <div style={{ position: "relative", width: s, height: s }}>
      <svg width={s} height={s} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={alpha(theme.palette.text, 0.08)} strokeWidth={u(thickness)} />
        {segs.map((sg, i) => {
          const frac = (sg.value / total) * progress;
          const offset = acc;
          acc += sg.value / total;
          return (
            <circle
              key={i}
              cx={s / 2}
              cy={s / 2}
              r={r}
              fill="none"
              stroke={sg.color ?? colors[i % colors.length]}
              strokeWidth={u(thickness)}
              strokeLinecap={segments ? "butt" : "round"}
              strokeDasharray={`${frac * circ} ${circ}`}
              strokeDashoffset={-offset * circ * progress}
            />
          );
        })}
      </svg>
      {showValue && !segments ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: fontFamily(theme.fonts.heading), fontWeight: theme.fonts.headingWeight, fontSize: u(size * 0.22), color: theme.palette.text, fontVariantNumeric: "tabular-nums" }}>
            {Math.round((value ?? 0) * progress)}%
          </div>
          {label ? <div style={{ fontFamily: fontFamily(theme.fonts.body), fontSize: u(size * 0.075), color: theme.palette.muted }}>{label}</div> : null}
        </div>
      ) : null}
    </div>
  );
};

/** 进度条（带标签与百分比） */
export const ProgressBar: React.FC<{ value: number; label?: string; color?: string; delay?: number; width?: number; height?: number; showValue?: boolean }> = ({
  value,
  label,
  color,
  delay = 0,
  width = 1000,
  height = 26,
  showValue = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u } = useLayout();
  const p = spring({ frame: frame - delay, fps, config: springs.gentle });
  const c = color ?? theme.palette.primary;
  const v = Math.min(100, Math.max(0, value)) * p;
  return (
    <div style={{ width: u(width), display: "flex", flexDirection: "column", gap: u(12) }}>
      {label || showValue ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: fontFamily(theme.fonts.body), fontSize: u(30), color: theme.palette.text }}>
          <span>{label}</span>
          {showValue ? <span style={{ fontVariantNumeric: "tabular-nums", color: c, fontWeight: 700 }}>{Math.round(v)}%</span> : null}
        </div>
      ) : null}
      <div style={{ height: u(height), borderRadius: u(height), background: alpha(theme.palette.text, 0.08), overflow: "hidden" }}>
        <div style={{ width: `${v}%`, height: "100%", borderRadius: u(height), background: `linear-gradient(90deg, ${alpha(c, 0.75)}, ${c})`, boxShadow: `0 0 ${u(24)}px ${alpha(c, 0.5)}` }} />
      </div>
    </div>
  );
};

/** 步骤/时间线：节点依次点亮，连接线生长 */
export const Steps: React.FC<{
  items: { title: string; description?: string }[];
  direction?: "horizontal" | "vertical";
  delay?: number;
  stagger?: number;
  color?: string;
  width?: number;
}> = ({ items, direction = "horizontal", delay = 0, stagger = 14, color, width = 1500 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u } = useLayout();
  const c = color ?? theme.palette.primary;
  const horizontal = direction === "horizontal";
  return (
    <div style={{ display: "flex", flexDirection: horizontal ? "row" : "column", width: horizontal ? u(width) : undefined, gap: horizontal ? 0 : u(36) }}>
      {items.map((it, i) => {
        const p = spring({ frame: frame - delay - i * stagger, fps, config: springs.snappy });
        const lineP = interpolate(frame, [delay + i * stagger + 6, delay + (i + 1) * stagger], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={i} style={{ flex: horizontal ? 1 : undefined, display: "flex", flexDirection: horizontal ? "column" : "row", alignItems: horizontal ? "center" : "flex-start", gap: u(22), position: "relative" }}>
            {i < items.length - 1 ? (
              <div
                style={
                  horizontal
                    ? { position: "absolute", top: u(34), left: "50%", width: `${lineP * 100}%`, height: u(4), background: alpha(c, 0.5), borderRadius: u(2) }
                    : { position: "absolute", left: u(34), top: u(70), width: u(4), height: `calc(${lineP * 100}% + ${u(10)}px)`, background: alpha(c, 0.5), borderRadius: u(2) }
                }
              />
            ) : null}
            <div
              style={{
                width: u(68),
                height: u(68),
                borderRadius: "50%",
                background: `linear-gradient(145deg, ${c}, ${theme.palette.secondary})`,
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: fontFamily(theme.fonts.heading),
                fontWeight: 700,
                fontSize: u(30),
                transform: `scale(${p})`,
                boxShadow: `0 0 ${u(30)}px ${alpha(c, 0.5)}`,
                zIndex: 1,
                flexShrink: 0,
              }}
            >
              {i + 1}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: u(8), alignItems: horizontal ? "center" : "flex-start", opacity: p, maxWidth: horizontal ? u(width / items.length - 40) : u(900) }}>
              <div style={{ fontFamily: fontFamily(theme.fonts.heading), fontWeight: theme.fonts.headingWeight >= 700 ? 700 : theme.fonts.headingWeight, fontSize: u(36), color: theme.palette.text, textAlign: horizontal ? "center" : "left" }}>
                {it.title}
              </div>
              {it.description ? (
                <div style={{ fontFamily: fontFamily(theme.fonts.body), fontSize: u(26), lineHeight: 1.5, color: theme.palette.muted, textAlign: horizontal ? "center" : "left" }}>{it.description}</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** 清单：逐条打勾出现 */
export const Checklist: React.FC<{ items: string[]; delay?: number; stagger?: number; color?: string; size?: number }> = ({ items, delay = 0, stagger = 10, color, size = 40 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const theme = useTheme();
  const { u } = useLayout();
  const c = color ?? theme.palette.primary;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: u(size * 0.7) }}>
      {items.map((it, i) => {
        const p = spring({ frame: frame - delay - i * stagger, fps, config: springs.snappy });
        const tick = interpolate(frame, [delay + i * stagger + 4, delay + i * stagger + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: u(size * 0.6), opacity: p, transform: `translateX(${(1 - p) * u(-40)}px)` }}>
            <svg width={u(size * 1.2)} height={u(size * 1.2)} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="11" fill={alpha(c, 0.18)} stroke={c} strokeWidth="1.5" />
              <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - tick} />
            </svg>
            <div style={{ fontFamily: fontFamily(theme.fonts.body), fontSize: u(size), color: theme.palette.text }}>{it}</div>
          </div>
        );
      })}
    </div>
  );
};
