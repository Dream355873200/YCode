// historyToRows.ts — 引擎历史消息 → row 流（重开项目回放）。
// 纯函数：与流式 applyFrame 产出同一 row 模型（流式/回放同路径）。
// assistant 消息内 content 块顺序即真实执行序（thinking → text → tool_use）。
import type { Row } from './rows';
import { stripReminderTags, nextRowId } from './rows';

/** 引擎 GET /sessions/{id}/messages 的消息形状（content 块联合）。 */
export interface HistoryBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;       // tool_use 块
  name?: string;
  input?: unknown;
  tool_use_id?: string; // tool_result 块
}

export interface HistoryMessage {
  role: string;
  content: HistoryBlock[] | string;
}

/** 历史 → rows。tool_result 按 tool_use_id 配对回填到 tool 行。 */
export function historyToRows(messages: readonly HistoryMessage[]): Row[] {
  const rows: Row[] = [];
  const toolById = new Map<string, Extract<Row, { kind: 'tool' }>>();

  for (const msg of messages || []) {
    const blocks = typeof msg.content === 'string'
      ? [{ type: 'text', text: msg.content } as HistoryBlock]
      : msg.content || [];

    // tool_result 载体消息：回填对应 tool 行，不产生新 row
    const results = blocks.filter((b) => b.type === 'tool_result');
    if (results.length > 0) {
      for (const b of results) {
        const t = b.tool_use_id ? toolById.get(b.tool_use_id) : undefined;
        if (t) {
          t.state = /退出码非零|失败|错误/.test(b.text || '') ? 'err' : 'ok';
          t.result = b.text || '';
        }
      }
      continue;
    }

    for (const b of blocks) {
      if (b.type === 'text') {
        const text = stripReminderTags(b.text || '');
        if (msg.role === 'user' && text) {
          rows.push({ kind: 'user', id: nextRowId(), text });
        } else if (text) {
          rows.push({ kind: 'assistant_text', id: nextRowId(), text });
        }
      } else if (b.type === 'thinking' && (b.thinking || '').trim()) {
        rows.push({ kind: 'reasoning', id: nextRowId(), text: b.thinking! });
      } else if (b.type === 'tool_use') {
        const t: Extract<Row, { kind: 'tool' }> = {
          kind: 'tool', id: nextRowId(), toolUseId: b.id || `t${rows.length}`,
          name: b.name || 'unknown', input: b.input, state: 'running',
        };
        if (t.toolUseId) toolById.set(t.toolUseId, t);
        rows.push(t);
      }
    }
  }
  return rows;
}
