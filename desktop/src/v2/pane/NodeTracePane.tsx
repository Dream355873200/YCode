// NodeTracePane — pipeline 节点的只读运行过程（右栏面板 tab）。
// 复刻 ZCode 的子代理查看形态：点节点 → 打开面板 tab → 与主对话同一套
// 行渲染（思考卡/工具卡/Markdown 正文），只是没有输入框。
// 数据源：引擎 GET /pipelines/{runId|live}/nodes/{node}/trace（JSONL 轨迹，
// 运行中轮询跟随）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { engine } from '../protocol';
import { useApp } from '../app/appState';
import { nodeTraceTabId, parseNodeTraceTabId } from '../lib/traceTabs';
import { TraceConversation, type TraceEntry } from '../conversation/TraceConversation';

export { nodeTraceTabId, parseNodeTraceTabId };
export type { TraceEntry };

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
    setTrace(await fetchTrace(dir, runId, node));
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {trace === null ? (
          <div className="py-6 text-center text-ui-xs text-foreground-subtlest">加载中…</div>
        ) : trace.length === 0 ? (
          <div className="py-6 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
            暂无轨迹<br />节点开始运行后，思考 / 工具调用 / 产出会实时出现在这里
          </div>
        ) : (
          <>
            <TraceConversation trace={trace} />
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  );
}
