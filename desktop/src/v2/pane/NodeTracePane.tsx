// NodeTracePane — pipeline 节点的只读工作过程时间线（右栏面板 tab）。
// 复刻 ZCode 的子代理查看形态：点节点 → 打开面板 tab → 用只读会话视图
// 渲染节点轨迹（思考 / 工具调用链 / 文本产出 / 错误），运行中自动刷新。
// 数据源：引擎 GET /pipelines/{runId|live}/nodes/{node}/trace（JSONL 轨迹）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangleIcon, BrainIcon, ChevronRightIcon, WrenchIcon } from 'lucide-react';
import { engine } from '../protocol';
import { useApp } from '../app/appState';
import { cn } from '../components/lib/utils';

export interface TraceEntry {
  ts?: number;
  type: 'text' | 'thinking' | 'tool_start' | 'tool_done' | 'error';
  text?: string;
  tool?: string;
  input?: string;
  result?: string;
}

export function nodeTraceTabId(runId: string, node: string): string {
  return `pnode:${runId}:${node}`;
}
export function parseNodeTraceTabId(id: string): { runId: string; node: string } | null {
  if (!id.startsWith('pnode:')) return null;
  const rest = id.slice(6);
  const i = rest.indexOf(':');
  if (i <= 0) return null;
  return { runId: rest.slice(0, i), node: rest.slice(i + 1) };
}

async function fetchTrace(dir: string, runId: string, node: string): Promise<TraceEntry[]> {
  try {
    const r = await engine.get(`/pipelines/${runId}/nodes/${encodeURIComponent(node)}/trace?dir=${encodeURIComponent(dir)}`);
    const t = (r.body as { trace?: TraceEntry[] })?.trace;
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

export function NodeTracePane({ runId, node }: { runId: string; node: string }) {
  const { project } = useApp();
  const dir = project?.dir ?? '';
  const [trace, setTrace] = useState<TraceEntry[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!dir) return;
    const t = await fetchTrace(dir, runId, node);
    setTrace(t);
  }, [dir, runId, node]);

  useEffect(() => {
    setTrace(null);
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load]);
  // 新内容到达时贴底（运行中跟随，像主对话的流式体验）
  useEffect(() => {
    if (trace && trace.length > 0) bottomRef.current?.scrollIntoView();
  }, [trace?.length]);

  if (!dir) {
    return <div className="p-6 text-center text-ui-xs text-foreground-subtlest">选择项目后查看节点</div>;
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/50 px-3 py-1.5 text-ui-2xs text-foreground-subtlest">
        节点 <span className="font-medium text-foreground">{node}</span> 的运行过程（只读{runId === 'live' ? ' · 实时' : ''}）
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {trace === null ? (
          <div className="py-6 text-center text-ui-xs text-foreground-subtlest">加载中…</div>
        ) : trace.length === 0 ? (
          <div className="py-6 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
            暂无轨迹<br />节点开始运行后，思考 / 工具调用 / 产出会实时出现在这里
          </div>
        ) : (
          <div className="grid gap-2">
            {trace.map((e, i) => <TraceRow key={i} e={e} />)}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function TraceRow({ e }: { e: TraceEntry }) {
  if (e.type === 'thinking') {
    return (
      <div className="rounded-lg border border-border/50 bg-card px-2.5 py-1.5">
        <div className="flex items-center gap-1 text-ui-2xs text-foreground-subtlest">
          <BrainIcon className="size-3" /> 思考
        </div>
        <div className="mt-1 whitespace-pre-wrap break-words text-ui-2xs italic leading-relaxed text-foreground-subtle">{e.text}</div>
      </div>
    );
  }
  if (e.type === 'tool_start' || e.type === 'tool_done') {
    return (
      <details className="group rounded-lg border border-border/60 bg-card px-2.5 py-1.5" open={e.type === 'tool_done' && !!e.result && e.result.startsWith('错误')}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-ui-2xs text-foreground">
          <WrenchIcon className="size-3 shrink-0 text-foreground-subtlest" />
          <span className="rounded bg-neutral-500/15 px-1 font-mono">{e.tool}</span>
          <ChevronRightIcon className="ml-auto size-3 shrink-0 text-foreground-subtlest transition-transform group-open:rotate-90" />
        </summary>
        {e.input && (
          <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded bg-input/60 px-1.5 py-1 font-mono text-ui-2xs text-foreground-subtle">{e.input}</div>
        )}
        {e.type === 'tool_done' && e.result && (
          <div className={cn('mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded px-1.5 py-1 font-mono text-ui-2xs',
            e.result.startsWith('错误') || e.result.startsWith('Error') ? 'bg-destructive/10 text-destructive' : 'bg-input/60 text-foreground-subtle')}>
            {e.result}
          </div>
        )}
      </details>
    );
  }
  if (e.type === 'error') {
    return (
      <div className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5">
        <AlertTriangleIcon className="mt-0.5 size-3 shrink-0 text-destructive" />
        <div className="break-all text-ui-2xs leading-relaxed text-destructive">{e.text}</div>
      </div>
    );
  }
  // text：节点的文本产出
  return (
    <div className="whitespace-pre-wrap break-words px-0.5 text-ui-xs leading-relaxed text-foreground">{e.text}</div>
  );
}
