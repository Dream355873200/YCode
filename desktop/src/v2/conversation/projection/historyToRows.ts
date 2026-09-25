// historyToRows.ts — 引擎历史消息 → row 流（重开项目回放）。
// 纯函数：与流式 applyFrame 产出同一 row 模型（流式/回放同路径）。
// assistant 消息内 content 块顺序即真实执行序（thinking → text → tool_use）。
import type { Row } from './rows';
import { stripReminderTags, nextRowId } from './rows';
import { ThinkTagSplitter } from './thinkTags';
import { stripThinkMarks } from './thinkTags';

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
  /** 元消息（恢复提示等运行机制注入）：模型上下文保留，展示层跳过。 */
  is_meta?: boolean;
}

/** 历史 → rows。tool_result 按 tool_use_id 配对回填到 tool 行。 */
export function historyToRows(messages: readonly HistoryMessage[]): Row[] {
  const rows: Row[] = [];
  const toolById = new Map<string, Extract<Row, { kind: 'tool' }>>();
  // 元消息防御：老引擎序列化不带 is_meta 时端点已过滤；新引擎双保险。
  const visible = messages.filter((m) => !m.is_meta);

  // assistant 正文喂 ThinkTagSplitter：<think>/<thinking> 段分流成 reasoning
  // row（与直播路径同语义——思考内容不残留在正式文本里，直播/回放一致）。
  const pushAssistantText = (text: string): void => {
    const sp = new ThinkTagSplitter();
    for (const piece of [...sp.feed(text), ...sp.flush()]) {
      if (piece.think) {
        rows.push({ kind: 'reasoning', id: nextRowId(), text: piece.think });
      } else if ((piece.text || '').trim()) {
        rows.push({ kind: 'assistant_text', id: nextRowId(), text: piece.text! });
      }
    }
  };


  for (const msg of visible || []) {
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
          pushAssistantText(text);
        }
      } else if (b.type === 'thinking' && (b.thinking || '').trim()) {
        rows.push({ kind: 'reasoning', id: nextRowId(), text: stripThinkMarks(b.thinking!) });
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
