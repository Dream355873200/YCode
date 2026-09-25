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

/** 子 agent 进度：状态 + 活动流水（每次工具启动 / 阶段性结论一行）。 */
export type AgentProgress = {
  status: 'running' | 'done' | 'failed';
  activities: string[];
  toolUses: number;
  tokens: number;
  error?: string;
};

/** 活动流水上限（更早的只计数，不保留正文）。 */
const AGENT_ACTIVITY_CAP = 200;

function mergeAgentProgress(prev: AgentProgress | undefined, frame: Envelope): AgentProgress {
  const status = frame.agent_status === 'done' ? 'done' : frame.agent_status === 'failed' ? 'failed' : 'running';
  const act = frame.agent_activity || '';
  const base: AgentProgress = prev ?? { status, activities: [], toolUses: 0, tokens: 0 };
  let activities = base.activities;
  // 终态帧的 activity 是错误信息，不进流水
  if (act && status === 'running' && activities[activities.length - 1] !== act) {
    activities = [...activities, act].slice(-AGENT_ACTIVITY_CAP);
  }
  return {
    status,
    activities,
    toolUses: Math.max(base.toolUses, frame.agent_tool_uses || 0),
    tokens: Math.max(base.tokens, frame.agent_tokens || 0),
    error: status === 'failed' ? act || base.error : base.error,
  };
}

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
    /** 子 agent 运行过程（subagent_progress 帧按 tool_use_id 归并）。 */
    agent?: AgentProgress;
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
 * 后台子 agent 收口：发起它的 run 结束后进度帧不再下发，终态只经
 * 「后台任务…（task_id=X）」提醒回注——据此把对应卡片（结果里带同一
 * task_id）置为终态。
 */
function settleBackgroundAgent(rows: Row[], text: string): void {
  const m = text.match(/后台任务「[^」]*」已(完成|终止|失败)（task_id=([\w-]+)）/);
  if (!m) return;
  settleAgentTask(rows, m[2]!, m[1] === '完成' ? 'done' : 'failed', m[1] === '完成' ? undefined : `已${m[1]}`);
}

/** 把结果里带 task_id 的运行中子 agent 卡置为终态（原地修改 out 数组）。 */
function settleAgentTask(rows: Row[], taskId: string, status: 'done' | 'failed', error?: string): void {
  const i = rows.findIndex((r) => r.kind === 'tool' && r.agent?.status === 'running'
    && (r.result || '').includes(`task_id=${taskId}`));
  const t = rows[i] as ToolRow | undefined;
  if (t?.agent) rows[i] = { ...t, agent: { ...t.agent, status, error } };
}

/**
 * 仍在跑的后台子 agent：发起调用已返回（工具行收口），但子 agent 进度
 * 未到终态。主 agent 空闲时据此显示「等待」并在终态通知到达后唤醒。
 * 返回各自的 task_id（从启动回执里解析；解析不到为空串）。
 */
export function pendingBackgroundAgents(rows: readonly Row[]): string[] {
  return rows.flatMap((r) => (r.kind === 'tool' && r.state !== 'running' && r.agent?.status === 'running'
    ? [(r.result || '').match(/task_id=([\w-]+)/)?.[1] ?? '']
    : []));
}

/** 引擎侧已查无此任务（引擎重启等）：卡片收口为失败，不再无限等待。 */
export function markAgentTasksLost(rows: readonly Row[], taskIds: string[]): Row[] {
  const out = [...rows];
  for (const id of taskIds) settleAgentTask(out, id, 'failed', '后台任务已丢失（引擎重启？）');
  return out;
}

/**
 * 归约一帧 → 新 row 流。纯函数：同序列帧必得同结果（流式/回放同路径）。
 * run_start / turn_complete / usage / metadata 不产生 row（由 run 生命周期
 * 与独立 store 消费）；subagent_progress 归并进所属工具 row。
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
        // 正文之后又来的思考增量（DeepSeek-V4 交错思考：正文发完还会继续
        // reasoning，且常复述刚写的内容）——并回本轮已有的思考卡，不在
        // 正文后新开卡片，否则思考和正文交错、碎片成排。
        const prev = out.findLast((r): r is Extract<Row, { kind: 'reasoning' }> => r.kind === 'reasoning');
        const ri = prev ? out.indexOf(prev) : -1;
        const afterUser = prev ? out.slice(ri + 1).some((r) => r.kind === 'user') : false;
        if (prev && !afterUser) {
          out[ri] = { ...prev, text: stripThinkMarks(prev.text + text) };
        } else {
          out.push({ kind: 'reasoning', id: nextRowId(), text });
        }
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
    case 'subagent_progress': {
      // 归并到发起调用的工具卡（后台子 agent 在 tool_done 之后仍会上报）
      const id = frame.agent_id || frame.tool_use_id;
      const t = id ? out.findLast((r): r is ToolRow => r.kind === 'tool' && r.toolUseId === id) : undefined;
      if (t) out[out.indexOf(t)] = { ...t, agent: mergeAgentProgress(t.agent, frame) };
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
      settleBackgroundAgent(out, text);
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
        settleBackgroundAgent(out, text);
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
