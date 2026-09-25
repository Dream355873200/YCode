// ContextRing — 上下文容量指示器（完全复刻 ZCode chat-input-toolbar/contextUsage
// + ai-elements/context 的触发器与面板结构，Apache-2.0，见 ZCode 仓库）。
// 触发器：模型选择器旁的 SVG 圆环（环弧 = 上下文占用比例）；
// 悬停面板：标题行 + 分类分段进度条 + 分类明细 + 缓存命中行（≥78% 才展示）。
// 数据：引擎每轮 usage SSE 帧（input/output/cache_read）；分类占比按本地
// 会话可见内容估算（字符/4），系统提示与工具定义为常数估计。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConversation } from './store';
import { useDismiss } from '../components/lib/useDismiss';
import { cn } from '../components/lib/utils';

const PERCENT_MAX = 100;
const CACHE_HIT_RATE_DISPLAY_THRESHOLD = 0.78;
const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 4;

// 分类色调（对齐 ZCode CONTEXT_PROGRESS_TONE_COLORS：主色向表面色递减混色）
const TONE_COLORS = [
  'var(--color-brand)',
  'color-mix(in oklab, var(--color-brand) 78%, var(--color-panel))',
  'color-mix(in oklab, var(--color-brand) 58%, var(--color-panel))',
  'color-mix(in oklab, var(--color-brand) 42%, var(--color-panel))',
  'color-mix(in oklab, var(--color-brand) 28%, var(--color-panel))',
];

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const fmtPct = (p: number) => `${(p * 100).toFixed(1)}%`;

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export default function ContextRing({ sid }: { sid: string }) {
  const usage = useConversation((s) => s.sessions[sid]?.usage) as Usage | null | undefined;
  const rows = useConversation((s) => s.sessions[sid]?.rows);
  const [ctx, setCtx] = useState(200_000);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(0);
  // 点击外部 / Esc 关闭（面板挂在 wrapRef 容器内，容器内点击不关闭）
  const wrapRef = useDismiss(open, () => { setOpen(false); window.clearTimeout(closeTimer.current); });

  useEffect(() => {
    (window as unknown as { amc?: { config?: { get?: () => Promise<Record<string, unknown>> } } })
      .amc?.config?.get?.()
      .then((c) => {
        const w = (c?.engine as { contextWindow?: number } | undefined)?.contextWindow;
        if (w) setCtx(Number(w) || 200_000);
      })
      .catch(() => {});
  }, []);

  // 分类估算 → 分段（token 粗估：文本字符/4，截图每张 ≈1.5k，系统+工具定义常数）
  const { segments, estTotal } = useMemo(() => {
    let messages = 0, tool = 0;
    for (const r of rows || []) {
      const row = r as { kind?: string; text?: string; input?: unknown; result?: string };
      if (row.kind === 'tool') {
        const resultLen = (row.result || '').length;
        const isImage = (row.result || '').startsWith('[IMAGE');
        tool += (isImage ? 1500 : resultLen / 4) + JSON.stringify(row.input || '').length / 4 + 40;
      } else if (row.text) {
        messages += row.text.length / 4;
      }
    }
    const raw = [
      { source: 'messages', label: '对话消息', tokens: Math.round(messages) },
      { source: 'tool_prompt', label: '工具结果', tokens: Math.round(tool) },
      { source: 'system_prompt', label: '系统提示', tokens: 4_000 },
      { source: 'system_tool_schemas', label: '工具定义', tokens: 1_500 },
    ].filter((s) => s.tokens > 0);
    const total = raw.reduce((sum, s) => sum + s.tokens, 0) || 1;
    return { segments: raw.map((s) => ({ ...s, percent: s.tokens / total })), estTotal: total };
  }, [rows]);

  // 已用 token：优先引擎实时 usage（精确）；无帧（恢复会话/新会话未跑完一轮）
  // 时用本地估算兜底，标记 ≈——保证打开有消息的会话立刻可见，不再等一轮。
  const isEstimated = !usage?.input_tokens;
  const used = usage?.input_tokens || estTotal;
  const percent = ctx > 0 ? Math.min(Math.max(used / ctx, 0), 1) : 0;
  const hitRate = !isEstimated && usage?.cache_read_input_tokens
    ? usage.cache_read_input_tokens / used
    : null;
  // ZCode：生产面板只展示明显有收益的缓存命中（≥78%）
  const hitLabel = hitRate != null && hitRate >= CACHE_HIT_RATE_DISPLAY_THRESHOLD
    ? fmtPct(hitRate)
    : null;
  const usedLabel = `${isEstimated ? '≈' : ''}${fmtK(used)}`;

  const ring = (() => {
    const circumference = 2 * Math.PI * ICON_RADIUS;
    const dashOffset = circumference * (1 - percent);
    return (
      <svg aria-hidden="true" className="size-3.5" viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}>
        <circle cx={ICON_CENTER} cy={ICON_CENTER} fill="none" opacity="0.25" r={ICON_RADIUS}
          stroke="currentColor" strokeWidth={ICON_STROKE_WIDTH} />
        <circle cx={ICON_CENTER} cy={ICON_CENTER} fill="none" opacity="0.7" r={ICON_RADIUS}
          stroke="currentColor" strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={dashOffset} strokeLinecap="round" strokeWidth={ICON_STROKE_WIDTH}
          style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }} />
      </svg>
    );
  })();

  const openPanel = () => { window.clearTimeout(closeTimer.current); setOpen(true); };
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 150);
  };

  return (
    <div ref={wrapRef} className="relative shrink-0"
      onMouseEnter={openPanel} onMouseLeave={scheduleClose}>
      <button type="button" aria-label="上下文用量"
        className={cn('flex h-7 items-center justify-center rounded-lg px-1 text-foreground-subtlest transition-colors',
          open ? 'text-foreground' : 'hover:bg-hover hover:text-foreground')}
        onClick={() => setOpen(!open)}>
        {ring}
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-40 mb-2 w-64 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          <div className="space-y-2 p-3">
            <div className="mb-3 flex items-center gap-3">
              <span className="shrink-0 text-ui-base font-medium text-foreground">上下文</span>
              <span className="ml-auto shrink-0 text-right font-mono text-ui-sm text-foreground-subtle">
                {usedLabel}/{fmtK(ctx)} ({fmtPct(percent)})
              </span>
            </div>
            {/* 分类分段进度条（对齐 ZCode Progress segments） */}
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-input">
              {segments.map((s, i) => (
                <div key={s.source} className="h-full"
                  style={{ width: `${s.percent * 100}%`, background: TONE_COLORS[Math.min(i, TONE_COLORS.length - 1)] }} />
              ))}
            </div>
          </div>
          <div className="space-y-1.5 bg-menu p-3 pt-0">
            {segments.map((s, i) => (
              <div key={s.source} className="flex min-w-0 items-center gap-2 text-ui-sm">
                <span aria-hidden="true" className="size-2 shrink-0 rounded-sm border border-border"
                  style={{ background: TONE_COLORS[Math.min(i, TONE_COLORS.length - 1)] }} />
                <span className="min-w-0 truncate text-foreground-subtle">{s.label}</span>
                <span className="ml-auto min-w-10 shrink-0 text-right font-mono text-ui-sm text-foreground">
                  {fmtPct(s.percent)}
                </span>
              </div>
            ))}
            {hitLabel && (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-ui-sm">
                <span className="text-foreground-subtle">缓存命中率</span>
                <span className="font-mono text-ui-sm text-foreground">{hitLabel}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
