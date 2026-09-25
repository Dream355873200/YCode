// TraceConversation — 轨迹（pipeline 节点 / 子代理）的主对话式渲染。
// 轨迹条目 → 合成帧 → applyFrame（与主对话同一投影器）→ RowView 渲染：
// 思考卡、工具卡、Markdown 正文与主对话一模一样，只是没有输入框。
import { useMemo } from 'react';
import type { Envelope } from 'goagent-client';
import { applyFrame, type Row } from './projection/rows';
import { RowView, foldReads, ReadGroup, type ReadGroupUnit } from './RowView';

export interface TraceEntry {
  ts?: number;
  type: 'text' | 'thinking' | 'tool_start' | 'tool_done' | 'error';
  text?: string;
  tool?: string;
  input?: string;
  result?: string;
}

/** 轨迹条目 → 投影帧（tool_use_id 就地编造，start/done 配对）。 */
function traceToRows(trace: TraceEntry[]): Row[] {
  let rows: Row[] = [];
  let seq = 0;
  const openId = new Map<string, string>(); // tool 名 → 最近一次 start 的 useId
  for (const e of trace) {
    seq += 1;
    const tid = `trace-${seq}`;
    switch (e.type) {
      case 'thinking':
        if (e.text?.trim()) {
          rows = applyFrame(rows, { type: 'thinking', thinking: e.text } as unknown as Envelope);
        }
        break;
      case 'text':
        if (e.text) {
          rows = applyFrame(rows, { type: 'text_delta', text: e.text } as unknown as Envelope);
        }
        break;
      case 'tool_start':
        if (e.tool) {
          openId.set(e.tool, tid);
          rows = applyFrame(rows, {
            type: 'tool_start', tool_name: e.tool, tool_use_id: tid,
            tool_input: e.input || '',
          } as unknown as Envelope);
        }
        break;
      case 'tool_done': {
        const id = (e.tool && openId.get(e.tool)) || `trace-done-${seq}`;
        if (e.tool) openId.delete(e.tool);
        rows = applyFrame(rows, {
          type: 'tool_done', tool_use_id: id, tool_result: e.result || '',
        } as unknown as Envelope);
        break;
      }
      case 'error':
        rows = applyFrame(rows, { type: 'steer', text: e.text || '节点执行出错' } as unknown as Envelope);
        break;
    }
  }
  return rows;
}

/** 只读对话时间线：与主对话同一套行渲染（无输入框）。 */
export function TraceConversation({ trace, sid }: { trace: TraceEntry[]; sid?: string }) {
  const folded = useMemo(() => foldReads(traceToRows(trace)), [trace]);
  return (
    <div className="grid gap-0.5 px-1 py-1">
      {folded.map((r) =>
        (r as { kind: string }).kind === 'readgroup'
          ? <ReadGroup key={r.id} group={r as ReadGroupUnit} />
          : <RowView key={(r as Row).id} row={r as Row} sid={sid || ''} />,
      )}
    </div>
  );
}
