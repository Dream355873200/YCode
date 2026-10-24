// workspace — 工作区状态层：项目 → 对话 / 团队，以及当前选中项。
//
// 真源分工：项目注册表在桌面壳（projects.json）；对话与团队在引擎
//（GET /threads、/teams）。新对话是「草稿」：只在界面上存在，发出第一条
// 消息时才在引擎创建（不留空壳）。选中项与已读位置存 localStorage，
// 重启后回到上次的对话。
import { create } from 'zustand';
import { engine, type Envelope } from '../protocol';
import { normalizeDir } from './dirs';
import { useConversation } from '../conversation/store';
import { autoReloadAfterTurn } from '../pane/flutterRun';
import type { ThreadGoal } from '../conversation/status/statusPanelModel';

export interface Project {
  name: string;
  dir: string;
  /** 新对话默认使用的智能体（最近一次在该项目里选用的）。 */
  mode?: string;
  idea?: string;
  kind?: string;
  color?: string;
  exists?: boolean;
  head?: string | null;
  commits?: number;
  dirty?: boolean;
}

export type Permission = 'plan' | 'default' | 'accept_edits' | 'bypass';

export interface Thread {
  id: string;
  dir: string;
  mode: string;
  title: string;
  /** auto = 首条消息截取；ai = 模型生成；user = 手动改名。 */
  titleSource?: string;
  createdAt: number;
  updatedAt: number;
  state: 'idle' | 'running' | 'interrupted';
  turns: number;
  /** 等你处理：ask = 提问，approval = 审批。 */
  pending?: '' | 'ask' | 'approval';
  permission?: Permission | '';
  archived?: boolean;
  /** 对话目标（引擎逐轮验收，未达成自动续跑）。 */
  goal?: ThreadGoal | null;
}

export interface TeamSummary {
  name: string;
  dir: string;
  goal: string;
  members: number;
  running: number;
  createdAt: number;
  updatedAt: number;
}

export type Selection =
  | { kind: 'thread'; id: string; dir: string }
  | { kind: 'draft'; dir: string }
  | { kind: 'team'; dir: string; name: string };

/** 草稿对话的设置（按项目记忆）。 */
export interface DraftSettings {
  mode?: string;
  permission?: Permission;
}

export interface ThreadPatch {
  title?: string;
  mode?: string;
  permission?: Permission | '';
  archived?: boolean;
}

interface WorkspaceState {
  projects: Project[];
  threads: Thread[];
  /** normalizeDir(项目目录) → 团队列表。 */
  teams: Record<string, TeamSummary[]>;
  selection: Selection | null;
  drafts: Record<string, DraftSettings>;
  /** 对话 id → 已读到的 updatedAt（未读圆点）。 */
  seen: Record<string, number>;
  /** 首次拉到对话列表后为 true（之前不做自动选择）。 */
  threadsLoaded: boolean;

  refreshProjects(): Promise<void>;
  refreshThreads(): Promise<void>;
  refreshTeams(dir?: string): Promise<void>;
  select(sel: Selection | null): void;
  /** 打开项目：选中其最近的对话；没有对话时进入草稿。 */
  openProject(dir: string): void;
  /** 新对话（草稿）。dir 省略 = 当前项目。 */
  newThread(dir?: string): void;
  setDraft(dir: string, patch: DraftSettings): void;
  /** 草稿发出第一条消息：引擎创建对话 → 发送（goal = 以这条消息为目标）→ 选中。返回对话 id。 */
  startThread(dir: string, text: string, opts: { mode: string; permission: Permission; goal?: boolean }): Promise<string>;
  updateThread(id: string, patch: ThreadPatch): Promise<void>;
  deleteThread(id: string): Promise<boolean>;
  markSeen(id: string): void;
  /** 本地标记运行状态（SSE 帧即时反馈，列表轮询随后对账）。 */
  setThreadState(id: string, state: Thread['state']): void;
  /** 设定目标并以目标为输入开工（替换已有目标）。 */
  startGoal(id: string, objective: string): Promise<boolean>;
  pauseGoal(id: string, reason?: string): Promise<void>;
  /** 继续已暂停的目标：引擎给出续跑提示，照常发送。 */
  resumeGoal(id: string): Promise<void>;
  clearGoal(id: string): Promise<void>;
}

const SEL_KEY = 'ycode.selection';
const SEEN_KEY = 'ycode.seen';

export const sameDir = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && normalizeDir(a) === normalizeDir(b);

const dirKey = (dir: string): string => normalizeDir(dir);

const loadJSON = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const saveJSON = (key: string, v: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 配额满：本次会话仍生效 */ }
};

type Resp = { status?: number; body?: unknown };
const errorOf = (r: Resp, fallback: string): string => {
  const b = r.body as { error?: string } | string | undefined;
  if (typeof b === 'string' && b.trim()) return b.trim();
  if (b && typeof b === 'object' && b.error) return b.error;
  return fallback;
};

/** 项目内可见的对话（未归档在前、按最近更新）。 */
export function threadsOf(threads: Thread[], dir: string): Thread[] {
  return threads.filter((t) => sameDir(t.dir, dir));
}

/** 项目的草稿设置。 */
export function draftOf(drafts: Record<string, DraftSettings>, dir: string): DraftSettings | undefined {
  return drafts[dirKey(dir)];
}

/** 对话是否有未读产出（不在看、已结束、更新晚于已读位置）。 */
export function isUnread(t: Thread, seen: Record<string, number>, activeId: string | null): boolean {
  return t.id !== activeId && t.state !== 'running' && t.updatedAt > (seen[t.id] ?? 0);
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  projects: [],
  threads: [],
  teams: {},
  selection: loadJSON<Selection | null>(SEL_KEY, null),
  drafts: {},
  seen: loadJSON<Record<string, number>>(SEEN_KEY, {}),
  threadsLoaded: false,

  async refreshProjects() {
    try {
      const list = await window.amc.projects.list() as Project[];
      if (Array.isArray(list)) set({ projects: list });
    } catch { /* IPC 不可用 */ }
  },

  async refreshThreads() {
    try {
      const r = await engine.get('/threads') as Resp & { unreachable?: boolean };
      if (r.unreachable) return;
      const list = (r.body as { threads?: Thread[] } | undefined)?.threads;
      if (!Array.isArray(list)) return;
      const first = !get().threadsLoaded;
      set((s) => {
        let seen = s.seen;
        // 首次启动没有已读记录：现有对话全部视为已读（不让历史一片红点）
        if (first && Object.keys(seen).length === 0) {
          seen = Object.fromEntries(list.map((t) => [t.id, t.updatedAt]));
          saveJSON(SEEN_KEY, seen);
        }
        return { threads: list, threadsLoaded: true, seen };
      });
    } catch { /* 引擎暂不可达：保留上次的列表 */ }
  },

  async refreshTeams(dir) {
    const dirs = dir ? [dir] : get().projects.map((p) => p.dir);
    const results = await Promise.all(dirs.map(async (d) => {
      try {
        const r = await engine.get(`/teams?dir=${encodeURIComponent(d)}`) as Resp & { unreachable?: boolean };
        const teams = (r.body as { teams?: TeamSummary[] } | undefined)?.teams;
        return [dirKey(d), Array.isArray(teams) ? teams : null] as const;
      } catch {
        return [dirKey(d), null] as const;
      }
    }));
    set((s) => {
      const next = { ...s.teams };
      for (const [k, v] of results) if (v) next[k] = v;
      return { teams: next };
    });
  },

  select(sel) {
    set({ selection: sel });
    saveJSON(SEL_KEY, sel);
    if (sel?.kind === 'thread') get().markSeen(sel.id);
  },

  openProject(dir) {
    const latest = threadsOf(get().threads, dir).find((t) => !t.archived);
    get().select(latest ? { kind: 'thread', id: latest.id, dir: latest.dir } : { kind: 'draft', dir });
  },

  newThread(dir) {
    const s = get();
    const target = dir ?? s.selection?.dir ?? s.projects[0]?.dir;
    if (target) get().select({ kind: 'draft', dir: target });
  },

  setDraft(dir, patch) {
    set((s) => ({ drafts: { ...s.drafts, [dirKey(dir)]: { ...s.drafts[dirKey(dir)], ...patch } } }));
  },

  async startThread(dir, text, { mode, permission, goal }) {
    const r = await engine.post('/threads', { dir, mode, permission, message: text }) as Resp;
    const t = r.body as Thread | undefined;
    if (!t?.id) throw new Error(errorOf(r, '创建对话失败'));
    set((s) => ({
      threads: [{ ...t, state: 'running' }, ...s.threads.filter((x) => x.id !== t.id)],
      seen: { ...s.seen, [t.id]: t.updatedAt },
    }));
    if (goal) {
      const g = await engine.post(`/threads/${encodeURIComponent(t.id)}/goal`, { objective: text }) as Resp;
      const gb = (g.body as { goal?: ThreadGoal } | undefined)?.goal;
      if (gb) setGoal(t.id, gb);
    }
    // 先发送（乐观气泡入账、直播流开始）再切换选中：时间线挂载时本地已有行，
    // 不会用尚不存在的引擎历史覆盖
    void useConversation.getState().send(t.id, text);
    get().select({ kind: 'thread', id: t.id, dir: t.dir });
    // 记住本项目最近选用的智能体：下一个新对话默认沿用
    const p = get().projects.find((x) => sameDir(x.dir, dir));
    if (p && p.mode !== mode) {
      void window.amc.projects.setMode(p.dir, mode).then((res) => {
        if (res.ok) set((s) => ({ projects: s.projects.map((x) => (x.dir === p.dir ? { ...x, mode } : x)) }));
      });
    }
    return t.id;
  },

  async updateThread(id, patch) {
    const prev = get().threads.find((t) => t.id === id);
    if (prev) set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, ...patch, titleSource: patch.title ? 'user' : t.titleSource } : t)) }));
    try {
      const r = await engine.post(`/threads/${encodeURIComponent(id)}`, patch) as Resp;
      const t = r.body as Thread | undefined;
      if (t?.id) set((s) => ({ threads: s.threads.map((x) => (x.id === id ? { ...x, ...t } : x)) }));
      else if (prev) set((s) => ({ threads: s.threads.map((x) => (x.id === id ? prev : x)) }));
    } catch {
      if (prev) set((s) => ({ threads: s.threads.map((x) => (x.id === id ? prev : x)) }));
    }
  },

  async deleteThread(id) {
    try {
      const r = await engine.del(`/threads/${encodeURIComponent(id)}`) as Resp;
      if ((r.status ?? 200) >= 400) return false;
    } catch {
      return false;
    }
    const s = get();
    const gone = s.threads.find((t) => t.id === id);
    set({ threads: s.threads.filter((t) => t.id !== id) });
    if (s.selection?.kind === 'thread' && s.selection.id === id && gone) get().openProject(gone.dir);
    return true;
  },

  markSeen(id) {
    const t = get().threads.find((x) => x.id === id);
    const at = Math.max(t?.updatedAt ?? 0, Date.now());
    set((s) => {
      const seen = { ...s.seen, [id]: at };
      saveJSON(SEEN_KEY, seen);
      return { seen };
    });
  },

  setThreadState(id, state) {
    set((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, state, updatedAt: Date.now() } : t)) }));
  },

  async startGoal(id, objective) {
    const text = objective.trim();
    if (!text) return false;
    const r = await engine.post(`/threads/${encodeURIComponent(id)}/goal`, { objective: text }) as Resp;
    const goal = (r.body as { goal?: ThreadGoal } | undefined)?.goal;
    if (!goal) return false;
    setGoal(id, goal);
    void useConversation.getState().send(id, text);
    return true;
  },

  async pauseGoal(id, reason) {
    const r = await engine.post(`/threads/${encodeURIComponent(id)}/goal/pause`, reason ? { reason } : {}) as Resp;
    const goal = (r.body as { goal?: ThreadGoal } | undefined)?.goal;
    if (goal) setGoal(id, goal);
  },

  async resumeGoal(id) {
    const r = await engine.post(`/threads/${encodeURIComponent(id)}/goal/resume`, {}) as Resp;
    const body = r.body as { goal?: ThreadGoal; prompt?: string } | undefined;
    if (!body?.goal) return;
    setGoal(id, body.goal);
    if (body.prompt) void useConversation.getState().send(id, body.prompt);
  },

  async clearGoal(id) {
    await engine.del(`/threads/${encodeURIComponent(id)}/goal`);
    setGoal(id, null);
  },
}));

function setGoal(id: string, goal: ThreadGoal | null): void {
  useWorkspace.setState((s) => ({ threads: s.threads.map((t) => (t.id === id ? { ...t, goal } : t)) }));
}

// ---------- 目标续跑驱动 ----------
// 续跑由本窗口驱动：自己直播的那次运行收尾时验收，未达成就照常发送续跑提示
//（续跑轮与普通轮一样实时可见）。用户停止 / 运行出错则暂停目标——不在
// 用户叫停之后自作主张继续。

const verifying = new Set<string>();
const GOAL_STATUS_KEY = 'goal-verify';

async function verifyGoal(sid: string): Promise<void> {
  if (verifying.has(sid)) return;
  // 排队消息还没消费完：等队列跑空再验收（用户插队的话以用户为准）
  if ((useConversation.getState().sessions[sid]?.queue.length ?? 0) > 0) return;
  verifying.add(sid);
  const conv = useConversation.getState();
  conv.progress(sid, GOAL_STATUS_KEY, '正在验收目标…');
  try {
    const r = await engine.post(`/threads/${encodeURIComponent(sid)}/goal/verify`, {}) as Resp;
    const body = r.body as {
      goal?: ThreadGoal | null; continue?: boolean; prompt?: string;
      verdict?: { passed: boolean; reason: string; next_action?: string };
    } | undefined;
    conv.progress(sid, GOAL_STATUS_KEY, '');
    if (!body || body.goal === undefined) return;
    setGoal(sid, body.goal);
    const g = body.goal;
    const reason = body.verdict?.reason ? `：${body.verdict.reason}` : '';
    if (g?.status === 'verified') {
      conv.note(sid, `目标已达成${reason}`, 'info');
    } else if (body.continue && body.prompt) {
      conv.note(sid, `第 ${(g?.iteration ?? 2) - 1} 轮验收未通过${reason}`, 'info');
      void conv.send(sid, body.prompt);
    } else if (g?.status === 'paused') {
      conv.note(sid, `目标已暂停${g.pausedReason ? `：${g.pausedReason}` : ''}`, 'stopped');
    }
  } catch {
    conv.progress(sid, GOAL_STATUS_KEY, '');
  } finally {
    verifying.delete(sid);
  }
}

/** 运行收尾（本窗口直播的流）：改过 Dart 就热重载手机上的应用；推进或暂停该对话的目标。 */
function onRunEnd(sid: string, type: string): void {
  const t = useWorkspace.getState().threads.find((x) => x.id === sid);
  if (t && type === 'done') void reloadDeviceApp(sid, t.dir);
  if (t?.goal?.status !== 'active') return;
  if (type === 'done') void verifyGoal(sid);
  else void useWorkspace.getState().pauseGoal(sid, type === 'interrupted' ? '运行被中断' : '运行出错');
}

async function reloadDeviceApp(sid: string, dir: string): Promise<void> {
  const conv = useConversation.getState();
  const r = await autoReloadAfterTurn(dir, conv.sessions[sid]?.rows ?? []);
  if (r) conv.note(sid, r.ok ? '已热重载到手机' : `热重载失败：${r.error}`, r.ok ? 'info' : 'error');
}

// ---------- 同步：轮询 + SSE 即时反馈 ----------

let syncStarted = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let teamTick = 0;

/** 是否需要快轮询：有对话在跑 / 等你处理 / 刚结束等模型起标题。 */
function needsFastPoll(threads: Thread[]): boolean {
  const now = Date.now();
  return threads.some((t) => t.state === 'running' || !!t.pending
    || (t.titleSource === 'auto' && t.turns > 0 && now - t.updatedAt < 90_000));
}

async function pollOnce(): Promise<void> {
  const ws = useWorkspace.getState();
  await ws.refreshThreads();
  if (teamTick++ % 4 === 0) await ws.refreshTeams();
}

function schedule(): void {
  if (pollTimer) clearTimeout(pollTimer);
  const fast = needsFastPoll(useWorkspace.getState().threads);
  pollTimer = setTimeout(() => { void pollOnce().finally(schedule); }, fast ? 2500 : 10_000);
}

/** 尽快对账一次（SSE 收尾后标题 / 更新时间会变）。 */
export function syncSoon(delay = 1200): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => { void pollOnce().finally(schedule); }, delay);
}

/** 启动工作区同步（AppProvider 挂载时调用一次）。 */
export function startWorkspaceSync(): void {
  if (syncStarted) return;
  syncStarted = true;
  const ws = useWorkspace.getState();
  void ws.refreshProjects().then(() => ws.refreshTeams());
  void ws.refreshThreads();
  schedule();
  engine.onSseEvent((evt: Envelope) => {
    const sid = evt.session_id;
    if (!sid) return;
    const st = useWorkspace.getState();
    if (!st.threads.some((t) => t.id === sid)) return;
    if (evt.type === 'run_start' || evt.type === 'queue_run') st.setThreadState(sid, 'running');
    else if (evt.type === 'done' || evt.type === 'error' || evt.type === 'interrupted') {
      st.setThreadState(sid, 'idle');
      if (st.selection?.kind === 'thread' && st.selection.id === sid) st.markSeen(sid);
      onRunEnd(sid, evt.type);
      syncSoon();
    }
  });
}
