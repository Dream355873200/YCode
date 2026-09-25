// SubAgentTracePane — 插件子代理（Agent_* 工具）的只读工作过程时间线
// （右栏面板 tab，复刻 ZCode 的子代理查看形态）。数据源：引擎
// GET /subagents/{session}/{toolUse}/trace（JSONL 轨迹，运行中轮询跟随）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { engine } from '../protocol';
import { useApp } from '../app/appState';
import { TraceRow, type TraceEntry } from './NodeTracePane';

export function subAgentTraceTabId(sessionID: string, toolUseID: string): string {
  return `subtrace:${sessionID}:${toolUseID}`;
}
export function parseSubAgentTraceTabId(id: string): { sessionID: string; toolUseID: string } | null {
  if (!id.startsWith('subtrace:')) return null;
  const rest = id.slice(9);
  const i = rest.indexOf(':');
  if (i <= 0) return null;
  return { sessionID: rest.slice(0, i), toolUseID: rest.slice(i + 1) };
}

export function SubAgentTracePane({ sessionID, toolUseID }: { sessionID: string; toolUseID: string }) {
  const [trace, setTrace] = useState<TraceEntry[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await engine.get(`/subagents/${encodeURIComponent(sessionID)}/${encodeURIComponent(toolUseID)}/trace`);
      const t = (r.body as { trace?: TraceEntry[] })?.trace;
      setTrace(Array.isArray(t) ? t : []);
    } catch {
      /* 引擎不可达：保留现有内容 */
    }
  }, [sessionID, toolUseID]);

  useEffect(() => {
    setTrace(null);
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (trace && trace.length > 0) bottomRef.current?.scrollIntoView();
  }, [trace?.length]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/50 px-3 py-1.5 text-ui-2xs text-foreground-subtlest">
        子代理运行过程（只读{trace && trace.length > 0 ? ' · 已记录 ' + trace.length + ' 条' : ''}）
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {trace === null ? (
          <div className="py-6 text-center text-ui-xs text-foreground-subtlest">加载中…</div>
        ) : trace.length === 0 ? (
          <div className="py-6 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
            暂无轨迹<br />引擎需已启用子代理轨迹落盘并重启后运行过子代理
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
