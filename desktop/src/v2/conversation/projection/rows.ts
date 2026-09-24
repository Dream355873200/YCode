// rows.ts — 对话的权威数据模型：不可变 row 流 + 纯函数归约。
// 流式增量与历史回放走同一条 applyFrame 路径（对齐 ZCode 的「权威投影」：
// UI 不保存第二份真相，只渲染 rows 的投影）。展示层文案（状态徽标/摘要）
// 由 toolcards 渲染器从 row 派生，这里只存权威事实。
import type { Envelope } from '../../protocol';
import { stripThinkMarks } from './thinkTags';

let seq = 0;
export const nextRowId = (): string => `r${++seq}`;

/** 测试注入固定 id 前缀用（避免跨用例串号）。 */
export const resetRowIds = (): void => { seq = 0; };

export type ToolRow = Extract<Row, { kind: 'tool' }>;

export type Tone = 'info' | 'error' | 'stopped';

export type Row =
  /** 用户消息（每条消息 = 独立一轮的输入；排队态显示在队列面板）。 */
  | { kind: 'user'; id: string; text: string; steered?: boolean }
  /** 助手正文（流式追加；同一轮内相邻文本合并为一行）。 */
  | { kind: 'assistant_text'; id: string; text: string }
  /** 思考块（折叠渲染）。 */
  | { kind: 'reasoning'; id: string; text: string }
  /** 工具调用（tool_use_id 配对 tool_start/tool_done）。 */
  | {
    kind: 'tool'; id: string; toolUseId: string; name: string;
    input?: unknown; state: 'running' | 'ok' | 'err'; result?: string;
  }
  /** 权限审批请求。 */
  | {
    kind: 'permission'; id: string; requestId: string; toolName: string;
    toolInput: unknown; permission?: string; resolved?: 'approved' | 'denied';
  }
  /** 确认卡（结构化 ask_user 载荷；index/total 为批量队列）。 */
  | {
    kind: 'confirm'; id: string; requestId: string; question: string;
    mode?: string; choices?: string[]; detail?: string;
    index?: number; total?: number;
    history?: Array<{ question: string; answer: string }>;
    resolved?: boolean; answer?: string;
  }
  /** 普通提问（无结构化载荷的 ask_user）。 */
  | { kind: 'ask'; id: string; requestId: string; question: string; resolved?: boolean; answer?: string }
  /** 状态行（status_key 原地替换；text 空 = 移除）。 */
  | { kind: 'status'; id: string; key: string; text: string }
  /** 系统通知：压缩边界 / 引擎错误 / 已停止。 */
  | { kind: 'notice'; id: string; text: string; tone: Tone };

/** 剥 system-reminder 包装（展示层不显示标记，只显示提醒正文）。 */
export const stripReminderTags = (t: string): string =>
  String(t || '').replace(/<\/?system-reminder[^>]*>/g, '').trim();

/** 旧文本前缀协议兼容层：[confirm]{json}\n问题 → 结构化载荷。 */
export function parseConfirmPrefix(question: string): { payload: Record<string, unknown>; question: string } | null {
  const m = question.match(/^\[confirm\](\{.*?\})\n([\s\S]*)$/);
  if (!m) return null;
  try {
    return { payload: JSON.parse(m[1]!) as Record<string, unknown>, question: m[2]! };
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 构造确认卡 row（结构化 payload 优先，旧前缀协议兜底）。 */
function confirmOrAsk(frame: Envelope): Row {
  const q = frame.question || '';
  let payload = isObj(frame.payload) ? frame.payload : null;
  let text = q;
  if (!payload) {
    const legacy = parseConfirmPrefix(q);
    if (legacy) { payload = legacy.payload; text = legacy.question; }
  }
  if (payload && payload.kind !== 'ask') {
    return {
      kind: 'confirm', id: nextRowId(), requestId: frame.request_id || '',
      question: text,
      mode: typeof payload.mode === 'string' ? payload.mode : undefined,
      choices: Array.isArray(payload.choices) ? (payload.choices as string[]) : undefined,
      detail: typeof payload.detail === 'string' ? payload.detail : undefined,
      index: typeof payload.index === 'number' ? payload.index : undefined,
      total: typeof payload.total === 'number' ? payload.total : undefined,
    };
  }
  return { kind: 'ask', id: nextRowId(), requestId: frame.request_id || '', question: text };
}

/**
 * 归约一帧 → 新 row 流。纯函数：同序列帧必得同结果（流式/回放同路径）。
 * run_start / turn_complete / usage / metadata / subagent_progress 不产生
 * row（分别由 run 生命周期与独立 store 消费）。
 */
export function applyFrame(rows: readonly Row[], frame: Envelope): Row[] {
  const out = [...rows];
  const last = out[out.length - 1];

  switch (frame.type) {
    case 'text_delta': {
      const text = frame.text || '';
      if (!text) break;
      if (last && last.kind === 'assistant_text') {
        out[out.length - 1] = { ...last, text: last.text + text };
      } else {
        out.push({ kind: 'assistant_text', id: nextRowId(), text });
      }
      break;
    }
    case 'thinking': {
      // stripThinkMarks：推理通道可能自带 <thinking> 标记文本（供应商行为），
      // 投影层统一去标记——否则思考框里会露出裸标签
      const text = stripThinkMarks(frame.thinking || '');
      if (!text) break;
      if (last && last.kind === 'reasoning') {
        out[out.length - 1] = { ...last, text: stripThinkMarks(last.text + text) };
      } else {
        out.push({ kind: 'reasoning', id: nextRowId(), text });
      }
      break;
    }
    case 'tool_start': {
      out.push({
        kind: 'tool', id: nextRowId(),
        toolUseId: frame.tool_use_id || `t${out.length}`,
        name: frame.tool_name || 'unknown',
        input: frame.tool_input,
        state: 'running',
      });
      break;
    }
    case 'tool_done': {
      const t = out.findLast((r): r is ToolRow => r.kind === 'tool' && r.toolUseId === frame.tool_use_id);
      if (t) {
        const result = frame.tool_result || '';
        out[out.indexOf(t)] = { ...t, state: /退出码非零|失败|错误/.test(result) ? 'err' : 'ok', result };
      }
      break;
    }
    case 'permission_request': {
      out.push({
        kind: 'permission', id: nextRowId(), requestId: frame.request_id || '',
        toolName: frame.tool_name || '', toolInput: frame.tool_input,
        permission: frame.permission,
      });
      break;
    }
    case 'ask_user': {
      out.push(confirmOrAsk(frame));
      break;
    }
    case 'steer': {
      // guide 车道注入回执：引擎内部通知（编辑器写回/环境提醒），
      // 渲染为提示行而非用户气泡——用户输入走 queue 车道。
      const text = stripReminderTags(frame.text || '');
      if (text) out.push({ kind: 'notice', id: nextRowId(), text, tone: 'info' });
      break;
    }
    case 'queue_run': {
      // queue 车道消费：排队消息作为新一轮输入开跑。降级的 guide 提醒
      // （带 reminder 标记）同样走这里——渲染回提示行，与用户输入区分。
      const raw = frame.text || '';
      const text = stripReminderTags(raw);
      if (!text) break;
      if (raw.includes('<system-reminder')) {
        out.push({ kind: 'notice', id: nextRowId(), text, tone: 'info' });
      } else {
        out.push({ kind: 'user', id: nextRowId(), text });
      }
      break;
    }
    case 'progress': {
      if (!frame.status_key) break; // 无 key 的进度不进权威流
      const i = out.findIndex((r) => r.kind === 'status' && r.key === frame.status_key);
      if (!frame.text) {
        if (i >= 0) out.splice(i, 1);
      } else if (i >= 0) {
        out[i] = { ...out[i], kind: 'status', id: (out[i] as Extract<Row, { kind: 'status' }>).id, key: frame.status_key, text: frame.text };
      } else {
        out.push({ kind: 'status', id: nextRowId(), key: frame.status_key, text: frame.text });
      }
      break;
    }
    case 'compaction': {
      out.push({ kind: 'notice', id: nextRowId(), text: frame.text || '已压缩上下文', tone: 'info' });
      break;
    }
    case 'error': {
      // error 字段恒为字符串；对象/空值兜底序列化，避免 "⚠ [object Object]"
      const raw = frame.error as unknown;
      const msg = typeof raw === 'string' && raw ? raw : raw != null ? JSON.stringify(raw) : '引擎错误';
      out.push({ kind: 'notice', id: nextRowId(), text: `⚠ ${msg}`, tone: 'error' });
      break;
    }
    case 'interrupted': {
      out.push({ kind: 'notice', id: nextRowId(), text: `⏹ ${frame.text || '已停止'}`, tone: 'stopped' });
      break;
    }
    default:
      break;
  }
  return out;
}

/** 本地推送的用户消息（send 即时显示；引擎不回显用户输入帧）。 */
export function pushUser(rows: readonly Row[], text: string): Row[] {
  const t = text.trim();
  if (!t) return [...rows];
  return [...rows, { kind: 'user', id: nextRowId(), text: t }];
}

// ---------- 交互回传（store 层调用，回写 row 状态） ----------

/** 审批结果回写。 */
export function resolvePermission(rows: readonly Row[], requestId: string, allow: boolean): Row[] {
  return rows.map((r) =>
    r.kind === 'permission' && r.requestId === requestId && !r.resolved
      ? { ...r, resolved: allow ? 'approved' as const : 'denied' as const }
      : r);
}

/** 提问/确认卡回写。多问批次由引擎逐张下发（每张独立成行），答完即收口。 */
export function resolveAsk(rows: readonly Row[], id: string, answer: string): Row[] {
  return rows.map((r) =>
    (r.kind === 'confirm' || r.kind === 'ask') && r.id === id
      ? { ...r, resolved: true, answer }
      : r);
}
