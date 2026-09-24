// conversationStore — v2 对话主轴状态（Zustand）。
// rows 是唯一真源（rows.ts 权威投影；引擎历史 = 另一个等价真源，restore 时
// 经 historyToRows 归一，不做 localStorage 第二份缓存）。store 只做五件事：
//   ① 路由：全局 SSE 帧 → 按 session_id 分发到对应会话
//   ② 流式预处理：<think>/<thinking> 标签拆分（text_delta → thinking/text）
//   ③ 生命周期：busy / 流断轮询恢复（resume poll）
//   ④ 交互回传：approve / askuser / interrupt
//   ⑤ 消息队列：busy 时发送入队（引擎 run 结束自动逐条续跑），
//      支持撤回编辑 / 立即发送（停当前轮 + 该条立成新轮）
import { create } from 'zustand';
import {
  applyFrame, resolvePermission, resolveAsk, pushUser, pendingBackgroundAgents, markAgentTasksLost, type Row,
} from './projection/rows';
import { ThinkTagSplitter } from './projection/thinkTags';
import { historyToRows } from './projection/historyToRows';
import { engine, type Envelope } from '../protocol';

/** 引擎侧排队消息（GET /queue 的条目视图）。 */
export interface QueueItem {
  id: string;
  text: string;
}

export interface SessionState {
  rows: Row[];
  busy: boolean;
  /** 本轮开始时间戳（工作计时用）；null = 空闲。 */
  runStartedAt: number | null;
  /** SSE 断流但引擎任务仍在跑（轮询跟踪中）。 */
  resuming: boolean;
  usage: unknown | null;
  /** busy 时发送的消息排队（queue 车道；queue_run 消费时弹出）。 */
  queue: QueueItem[];
}

interface ConversationStore {
  sessions: Record<string, SessionState>;
  restore(sid: string): Promise<void>;
  send(sid: string, text: string): Promise<void>;
  interrupt(sid: string): Promise<void>;
  approve(sid: string, requestId: string, allow: boolean): Promise<void>;
  answer(sid: string, id: string, requestId: string, answer: string): Promise<void>;
  /** busy 时发送 = 入队（run 结束后自动逐条续跑）。 */
  enqueue(sid: string, text: string): Promise<void>;
  /** 删除排队项；返回原文（撤回编辑 / 立即发送都要先取回内容）。 */
  removeQueued(sid: string, itemId: string): Promise<string | null>;
  /** 撤回排队项到输入框编辑。 */
  editQueued(sid: string, itemId: string): Promise<void>;
  /** 立即发送：停掉当前轮，该条排队消息立刻独立成轮。 */
  sendNow(sid: string, itemId: string): Promise<void>;
  /** Composer 消费草稿回填（editQueued 的落地）。 */
  consumeDraftRestore(sid: string): string | null;
}

const emptySession = (): SessionState => ({ rows: [], busy: false, runStartedAt: null, resuming: false, usage: null, queue: [] });

/** 会话级非响应式机器（splitter 状态 / 恢复轮询 timer）。 */
const splitters = new Map<string, ThinkTagSplitter>();
const resumeTimers = new Map<string, ReturnType<typeof setInterval>>();
/** 后台子 agent 等待轮询（主 agent 空闲 + 有后台子 agent 在跑时启用）。 */
const waitTimers = new Map<string, ReturnType<typeof setInterval>>();
const lastActiveSid = { current: '' };

/** 草稿回填请求（editQueued → Composer 消费；nonce 保证同文可重复触发）。 */
let draftRestore: { sid: string; text: string; nonce: number } | null = null;
let draftNonce = 0;

/** 确保 session 存在并返回当前状态（不可变更新由 set 完成）。 */
const patch = (
  set: (fn: (s: ConversationStore) => Partial<ConversationStore>) => void,
  sid: string,
  fn: (s: SessionState) => SessionState,
): void => {
  set((st) => ({
    sessions: { ...st.sessions, [sid]: fn(st.sessions[sid] || emptySession()) },
  }));
};

// ---- SSE 帧预处理：<think> 标签拆分 ----

/** text_delta 过 ThinkTagSplitter → 0..n 个等价帧（thinking / text_delta）。 */
function splitThinkFrames(sid: string, evt: Envelope): Envelope[] {
  let sp = splitters.get(sid);
  if (!sp) { sp = new ThinkTagSplitter(); splitters.set(sid, sp); }
  const out: Envelope[] = [];
  for (const piece of sp.feed(evt.text || '')) {
    if ('think' in piece && piece.think) out.push({ ...evt, type: 'thinking', thinking: piece.think });
    else if (piece.text) out.push({ ...evt, text: piece.text });
  }
  return out;
}

/** 拉取引擎侧队列并对账（restore / 轮询兜底；常规变更走乐观更新）。 */
async function refreshQueue(
  sid: string,
  patchFn: typeof patch,
  set: Parameters<typeof patch>[0],
): Promise<void> {
  try {
    const r = await engine.get(`/queue?session_id=${encodeURIComponent(sid)}`);
    const items = (r.body as { items?: QueueItem[] } | undefined)?.items;
    if (Array.isArray(items)) {
      patchFn(set, sid, (s) => ({ ...s, queue: items }));
    }
  } catch { /* 引擎暂不可达，下个周期再试 */ }
}

/** 未决提问对账（restore / 流断轮询共用）：提问卡不在引擎历史里——
 * run 阻塞在提问上时，request_id 与问题文本只在引擎内存中。重载后向
 * 引擎查询：有未决 = run 还活着，把提问卡还原（可答）；无未决 = run
 * 已结束 / 引擎重启过，历史即真相。幂等：同 request_id 不重复入流。 */
async function reconcilePendingAsk(
  sid: string,
  patchFn: typeof patch,
  set: Parameters<typeof patch>[0],
): Promise<void> {
  try {
    const r = await engine.get(`/pending-ask?session_id=${encodeURIComponent(sid)}`);
    const body = r.body as { pending?: boolean; request_id?: string; question?: string; payload?: Record<string, unknown> } | undefined;
    if (!body?.pending || !body.request_id) return;
    patchFn(set, sid, (s) => {
      if (s.rows.some((row) => (row.kind === 'ask' || row.kind === 'confirm') && row.requestId === body.request_id)) {
        return s;
      }
      return {
        ...s,
        rows: applyFrame(s.rows, {
          type: 'ask_user', session_id: sid, request_id: body.request_id,
          question: body.question || '', payload: body.payload,
        } as unknown as Envelope),
      };
    });
  } catch { /* 引擎暂不可达，下个周期再试 */ }
}

/** 轮询直到引擎侧会话空闲（sendNow 的停轮等待；有界防悬挂）。 */
async function waitIdle(sid: string, tries = 20): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const r = await engine.get('/sessions');
      const running = ((r.body as Array<{ id: string; state: string }> | undefined) || [])
        .some((x) => x.id === sid && x.state === 'running');
      if (!running) return true;
    } catch { /* 引擎不可达：继续等 */ }
  }
  return false;
}

export const useConversation = create<ConversationStore>((set, get) => {
  /** 收尾时冲出残留的未闭合思考段（<think> 未闭合 = flush 按闭合处理）。 */
  const flushThinkFrames = (sid: string): Envelope[] => {
    const sp = splitters.get(sid);
    if (!sp) return [];
    const out: Envelope[] = [];
    for (const p of sp.flush()) {
      if ('think' in p && p.think && p.think.trim()) {
        out.push({ seq: 0, v: 1, type: 'thinking', thinking: p.think, session_id: sid });
      }
    }
    return out;
  };

  /** SSE 帧统一入口（ensureBus 注册一次；缺 session_id 时落到最近活跃会话）。 */
  const handleFrame = (evt: Envelope): void => {
    const sid = evt.session_id || lastActiveSid.current;
    if (!sid) return;
    lastActiveSid.current = sid;

    const terminal = evt.type === 'done' || evt.type === 'error' || evt.type === 'interrupted';
    if (terminal) stopResume(sid); // 在 set 外先停轮询（set 更新器内不做副作用）

    // queue_run：队列消费开新轮——弹出队头（drain 严格 FIFO），busy 维持
    if (evt.type === 'queue_run') {
      splitters.set(sid, new ThinkTagSplitter()); // 新 run：标签状态复位
      patch(set, sid, (s) => ({ ...s, queue: s.queue.slice(1), busy: true, runStartedAt: Date.now() }));
    }

    // text_delta 先过 think 标签拆分；终态帧前冲出残留思考段
    const frames: Envelope[] = evt.type === 'text_delta'
      ? splitThinkFrames(sid, evt)
      : terminal
        ? [...flushThinkFrames(sid), evt]
        : [evt];

    for (const f of frames) {
      patch(set, sid, (s) => ({
        ...s,
        rows: applyFrame(s.rows, f),
        usage: f.type === 'usage' && f.usage ? f.usage : s.usage,
        busy: terminal ? false : s.busy,
        runStartedAt: f.type === 'run_start' || f.type === 'queue_run' ? Date.now() : terminal ? null : s.runStartedAt,
      }));
    }
    syncWait(sid);
  };

  // ---- 后台子 agent 等待 + 空闲唤醒 ----
  // 主 agent 启动后台子 agent 后本轮即结束；子 agent 终态通知进引擎队列，
  // 会话空闲时没人消费。这里在「空闲 + 仍有后台子 agent」期间轮询队列，
  // 队头是引擎通知就发起唤醒轮（resume_queue），主 agent 读到结论接着干。

  const syncWait = (sid: string): void => {
    const s = get().sessions[sid];
    const need = !!s && !s.busy && pendingBackgroundAgents(s.rows).length > 0;
    const t = waitTimers.get(sid);
    if (need && !t) waitTimers.set(sid, setInterval(() => void checkWake(sid), 3000));
    else if (!need && t) { clearInterval(t); waitTimers.delete(sid); }
  };

  const checkWake = async (sid: string): Promise<void> => {
    if (get().sessions[sid]?.busy) return;
    try {
      const r = await engine.get(`/queue?session_id=${encodeURIComponent(sid)}`);
      const items = (r.body as { items?: QueueItem[] } | undefined)?.items;
      if (!Array.isArray(items)) return;
      patch(set, sid, (s) => ({ ...s, queue: items }));
      // 只在队头是引擎通知时唤醒：队头若是用户中断后留下的消息，不替用户自动发
      if (items[0]?.text.includes('<system-reminder')) {
        if (!get().sessions[sid]?.busy) void wake(sid);
        return;
      }
      // 引擎侧已查无此任务（引擎重启）→ 收口卡片，停止等待
      const ids = pendingBackgroundAgents(get().sessions[sid]?.rows ?? []).filter(Boolean);
      if (ids.length === 0) return;
      const bg = await engine.get('/bgtasks');
      if (!Array.isArray(bg.body)) return;
      const known = new Set((bg.body as Array<{ id: string }>).map((x) => x.id));
      const lost = ids.filter((id) => !known.has(id));
      if (lost.length) {
        patch(set, sid, (s) => ({ ...s, rows: markAgentTasksLost(s.rows, lost) }));
        syncWait(sid);
      }
    } catch { /* 引擎暂不可达，下个周期再试 */ }
  };

  const wake = async (sid: string): Promise<void> => {
    patch(set, sid, (s) => ({ ...s, busy: true, runStartedAt: Date.now() }));
    syncWait(sid);
    splitters.set(sid, new ThinkTagSplitter());
    try {
      await engine.chat({ message: '', sessionId: sid, resumeQueue: true });
    } catch { /* 流断：onSseError 路径负责收尾 */ }
  };

  /** 流断恢复轮询：引擎侧任务还在跑（应用重启 / SSE 断开）就持续对账。 */
  const startResume = (sid: string): void => {
    if (resumeTimers.has(sid)) return;
    patch(set, sid, (s) => ({ ...s, resuming: true, busy: true, runStartedAt: s.runStartedAt ?? Date.now() }));
    const timer = setInterval(async () => {
      try {
        const [r, msgs] = await Promise.all([
          engine.get('/sessions'),
          engine.get(`/sessions/${sid}/messages`),
        ]);
        const running = ((r.body as Array<{ id: string; state: string }> | undefined) || [])
          .some((x) => x.id === sid && x.state === 'running');
        // 引擎历史是唯一真源：轮询期间整体重放。resuming 时没有直播流
        // 可撕裂，busy 不挡重放——否则回答恢复出的提问卡后，run 续跑的
        // 产出永远不可见（busy 只在 SSE 直播时防撕裂）
        const st = get().sessions[sid];
        if ((!st?.busy || st?.resuming) && Array.isArray(msgs.body)) {
          const rows = historyToRows(msgs.body as never);
          patch(set, sid, (s) => ({ ...s, rows }));
        }
        // 队列对账（引擎侧 bg 任务也会入队，轮询兜底可见）
        void refreshQueue(sid, patch, set);
        // 未决提问对账：轮询恢复路径没有直播流，帧丢失的 ask_user 在这里补。
        // 仅 run 仍在跑时查——run 恰好收尾的竞态下不复活死卡
        if (running) void reconcilePendingAsk(sid, patch, set);
        if (!running) { stopResume(sid); handleFrame({ type: 'done', session_id: sid } as Envelope); }
      } catch { /* 引擎暂不可达，下个周期再试 */ }
    }, 3000);
    resumeTimers.set(sid, timer);
  };

  const stopResume = (sid: string): void => {
    const t = resumeTimers.get(sid);
    if (t) { clearInterval(t); resumeTimers.delete(sid); }
    patch(set, sid, (s) => (s.resuming ? { ...s, resuming: false } : s));
  };

  // 全局 SSE 总线（模块级注册一次；多组件订阅 store 不重复挂监听）
  let busReady = false;
  const ensureBus = (): void => {
    if (busReady) return;
    busReady = true;
    engine.onSseEvent(handleFrame);
    engine.onSseBegin(handleFrame);
    engine.onSseError((payload) => {
      // preload 回调签名是单参：payload = { session_id, error: string }（engine.js streamChat catch 发出）
      const sid = payload?.session_id || lastActiveSid.current;
      if (!sid) return;
      // 流断 ≠ 任务死：转轮询跟踪；busy 交给轮询结束时的 done 帧收尾
      const msg = typeof payload?.error === 'string' && payload.error ? payload.error : '连接中断';
      engine.get('/sessions').then((r) => {
        const running = ((r.body as Array<{ id: string; state: string }> | undefined) || [])
          .some((x) => x.id === sid && x.state === 'running');
        if (running) startResume(sid);
        else handleFrame({ type: 'error', error: msg, session_id: sid } as Envelope);
      }).catch(() => handleFrame({ type: 'error', error: msg, session_id: sid } as Envelope));
    });
    engine.onSseDone((meta) => {
      const sid = meta?.session_id || lastActiveSid.current;
      if (sid) handleFrame({ type: 'done', session_id: sid } as Envelope);
    });
  };

  return {
    sessions: {},

    async restore(sid) {
      ensureBus();
      lastActiveSid.current = sid;
      // 本地已有该会话的行（切走又切回）：不整体重放——引擎历史只含已
      // 持久化消息，不含待答提问/确认卡与流式中途状态，重放会把它们抹掉
      // （「切回来提问框消失/当前轮气泡不见了」的根因）。SSE 帧按
      // session_id 持续入账，本地行始终是最新的活投影；只有本地没有该
      // 会话的行（冷启动/重启后）才从引擎历史全量回放。
      const hasLocalRows = (get().sessions[sid]?.rows.length ?? 0) > 0;
      if (!hasLocalRows) {
        try {
          const res = await engine.get(`/sessions/${sid}/messages`);
          if (Array.isArray(res.body)) {
            const rows = historyToRows(res.body as never);
            patch(set, sid, (s) => ({ ...s, rows }));
          }
        } catch { /* 引擎不可达（启动窗口期）：空会话起步 */ }
      }
      // 会话仍在引擎侧跑（应用重启过的场景）→ 轮询跟踪
      try {
        const r = await engine.get('/sessions');
        const running = ((r.body as Array<{ id: string; state: string }> | undefined) || [])
          .some((x) => x.id === sid && x.state === 'running');
        if (running) startResume(sid); else { stopResume(sid); void checkWake(sid); }
      } catch { /* 状态不可得 → 只回放历史 */ }
      // 排队消息对账
      void refreshQueue(sid, patch, set);
      // 未决提问对账：引擎历史不含待答提问，重载后向运行时查询——
      // 有未决（run 仍阻塞）恢复可答的提问卡；无未决（run 已结束 /
      // 引擎随上次应用退出而终止）按历史渲染，不复活死掉的提问
      void reconcilePendingAsk(sid, patch, set);
    },

    async send(sid, text) {
      const message = text.trim();
      if (!message) return;
      ensureBus();
      lastActiveSid.current = sid;
      const s = get().sessions[sid] || emptySession();
      // busy 时发送 = 入队（每条消息独立成轮），不走 /chat 的插话通道
      if (s.busy) return get().enqueue(sid, message);
      patch(set, sid, (cur) => ({
        ...cur,
        rows: pushUser(cur.rows, message),
        busy: true,
        runStartedAt: Date.now(),
      }));
      splitters.set(sid, new ThinkTagSplitter()); // 新 run：标签状态复位
      try {
        await engine.chat({ message, sessionId: sid });
        // chat resolve = 本地 SSE 正常走完（onSseDone 已补 done 帧）
      } catch (e) {
        // 流断 ≠ 任务死：查引擎侧状态决定轮询恢复或就地报错
        try {
          const r = await engine.get('/sessions');
          const running = ((r.body as Array<{ id: string; state: string }> | undefined) || [])
            .some((x) => x.id === sid && x.state === 'running');
          if (running) { startResume(sid); return; }
        } catch { /* 查询失败按报错处理 */ }
        patch(set, sid, (cur) => ({
          ...cur,
          rows: applyFrame(cur.rows, { type: 'error', error: String(e) } as Envelope),
          busy: false,
          runStartedAt: null,
        }));
      }
    },

    async interrupt(sid) {
      try {
        await engine.post('/interrupt', { session_id: sid, reason: '用户请求终止' });
      } catch { /* 引擎可能刚好结束 */ }
      stopResume(sid);
    },

    async enqueue(sid, text) {
      const message = text.trim();
      if (!message) return;
      ensureBus();
      lastActiveSid.current = sid;
      try {
        const r = await engine.post('/queue', { message, session_id: sid });
        const id = (r.body as { id?: string } | undefined)?.id;
        if (id) {
          patch(set, sid, (s) => ({ ...s, queue: [...s.queue, { id, text: message }] }));
        } else {
          void refreshQueue(sid, patch, set); // 响应异常 → 拉取对账
        }
      } catch {
        patch(set, sid, (s) => ({
          ...s,
          rows: applyFrame(s.rows, { type: 'error', error: '入队失败：引擎不可达' } as Envelope),
        }));
      }
    },

    async removeQueued(sid, itemId) {
      try {
        const r = await engine.post('/queue/remove', { session_id: sid, item_id: itemId });
        const text = (r.body as { text?: string } | undefined)?.text;
        patch(set, sid, (s) => ({ ...s, queue: s.queue.filter((q) => q.id !== itemId) }));
        return text ?? null;
      } catch {
        return null; // 已被消费或引擎不可达：队列对账留给下轮轮询
      }
    },

    async editQueued(sid, itemId) {
      const text = await get().removeQueued(sid, itemId);
      if (!text) return;
      draftRestore = { sid, text, nonce: ++draftNonce };
      // 触发订阅者（Composer 监听 sessions 变化即可；这里 patch 空更新唤起渲染）
      patch(set, sid, (s) => ({ ...s }));
    },

    async sendNow(sid, itemId) {
      const text = await get().removeQueued(sid, itemId);
      if (!text) return;
      const busy = get().sessions[sid]?.busy ?? false;
      if (busy) {
        await get().interrupt(sid);
        const idle = await waitIdle(sid);
        if (!idle) return; // 停不下来：放弃本次抢跑（消息已从队列移除，可在时间线手动重发）
      }
      await get().send(sid, text);
    },

    consumeDraftRestore(sid) {
      if (!draftRestore || draftRestore.sid !== sid) return null;
      const { text, nonce } = draftRestore;
      draftRestore = null;
      void nonce;
      return text;
    },

    async approve(sid, requestId, allow) {
      await engine.post('/approve', { request_id: requestId, session_id: sid, allow, always_allow: false });
      patch(set, sid, (s) => ({ ...s, rows: resolvePermission(s.rows, requestId, allow) }));
    },

    async answer(sid, id, requestId, answer) {
      try {
        await engine.post('/askuser', { request_id: requestId, answer });
      } catch (e) {
        console.error('[ask] 回传失败:', e);
      }
      patch(set, sid, (s) => ({ ...s, rows: resolveAsk(s.rows, id, answer) }));
    },
  };
});

// ---- 便捷订阅 hooks ----

const EMPTY_SESSION = emptySession(); // 稳定引用：缺省 selector 不产生新对象

export const useSession = (sid: string): SessionState =>
  useConversation((st) => st.sessions[sid] ?? EMPTY_SESSION);

export const useBusy = (sid: string): boolean => useConversation((st) => st.sessions[sid]?.busy ?? false);
