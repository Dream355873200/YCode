// ContextMeter — 上下文容量指示器（ZCode 式）：细进度条 + 悬停明细。
// 数据：引擎每轮 SSE 携带 usage（input/output/cache_read/cache_creation），
// 本组件取最近一轮的 input_tokens 作为「上下文已用」，窗口大小来自设置；
// 分类占比按本地会话可见内容估算（字符数/4），系统+工具定义为常量估计。
import { useEffect, useMemo, useState } from 'react';
import { useConversation } from '../conversation/store';
import { cn } from '../components/lib/utils';

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export default function ContextMeter({ sid }: { sid: string }) {
  const usage = useConversation((s) => s.sessions[sid]?.usage) as Usage | null | undefined;
  const rows = useConversation((s) => s.sessions[sid]?.rows);
  const [ctx, setCtx] = useState(200_000);

  useEffect(() => {
    (window as unknown as { amc?: { config?: { get?: () => Promise<Record<string, unknown>> } } })
      .amc?.config?.get?.()
      .then((c) => {
        const w = (c?.engine as { contextWindow?: number } | undefined)?.contextWindow;
        if (w) setCtx(Number(w) || 200_000);
      })
      .catch(() => {});
  }, []);

  const used = usage?.input_tokens || 0;
  const pct = Math.min(100, Math.round((used / ctx) * 100));
  const hit = usage?.cache_read_input_tokens && used
    ? Math.round((usage.cache_read_input_tokens / used) * 100)
    : null;

  // 分类占比估算（字符/4，含截图每张 ≈1.5k token 的粗估）
  const est = useMemo(() => {
    let user = 0, asst = 0, tool = 0;
    for (const r of rows || []) {
      const row = r as { kind?: string; role?: string; text?: string; input?: unknown; result?: string };
      if (row.kind === 'tool') {
        tool += ((row.result || '').length + JSON.stringify(row.input || '').length) / 4 + 40;
      } else if (row.text) {
        const t = row.text.length / 4;
        if (row.role === 'user') user += t; else asst += t;
      }
    }
    const system = 15_000; // 系统提示 + 工具定义（引擎注入，前端不可见，按常数估）
    return { user: Math.round(user), asst: Math.round(asst), tool: Math.round(tool), system };
  }, [rows]);

  const title = [
    `上下文 ${fmtK(used)} / ${fmtK(ctx)} tokens（${pct}%）`,
    hit != null ? `缓存命中 ${hit}%` : null,
    `估算占比: 用户 ${fmtK(est.user)} · 助手 ${fmtK(est.asst)} · 工具结果 ${fmtK(est.tool)} · 系统+工具定义 ≈${fmtK(est.system)}`,
  ].filter(Boolean).join('\n');

  if (!used) return null;

  return (
    <div className="shrink-0 px-4 pb-1" title={title}>
      <div className="flex items-center gap-2">
        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-input">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500',
              pct > 85 ? 'bg-destructive' : pct > 65 ? 'bg-warning' : 'bg-brand')}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <span className="shrink-0 text-ui-2xs text-foreground-subtlest">
          {fmtK(used)}/{fmtK(ctx)}{hit != null ? ` · 缓存 ${hit}%` : ''}
        </span>
      </div>
    </div>
  );
}
