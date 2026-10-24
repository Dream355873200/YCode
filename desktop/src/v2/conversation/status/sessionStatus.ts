// sessionStatus — 对话的运行态数据（任务清单 / 后台命令 / 子代理）的共享轮询。
// 多个组件订阅同一对话时只有一个轮询器（引用计数）；对话在跑时 2.5s 一次，
// 空闲时 10s 一次；本对话的工具帧到达时立即补刷一次（去抖）。
import { useEffect } from 'react';
import { create } from 'zustand';
import { engine, type Envelope } from '../../protocol';
import { useConversation } from '../store';
import type { AgentInfo, BgTask, TaskItem } from './statusPanelModel';

export interface SessionStatusData {
  tasks: TaskItem[];
  bgtasks: BgTask[];
  agents: AgentInfo[];
  loaded: boolean;
}

const EMPTY: SessionStatusData = { tasks: [], bgtasks: [], agents: [], loaded: false };

interface StatusStore {
  byId: Record<string, SessionStatusData>;
}

const useStatusStore = create<StatusStore>(() => ({ byId: {} }));

const list = <T,>(body: unknown): T[] | null => (Array.isArray(body) ? body as T[] : null);

async function refresh(sid: string): Promise<void> {
  const [t, b, a] = await Promise.all([
    engine.get(`/tasks?session_id=${encodeURIComponent(sid)}`).catch(() => null),
    engine.get('/bgtasks').catch(() => null),
    engine.get(`/agents?session_id=${encodeURIComponent(sid)}`).catch(() => null),
  ]);
  useStatusStore.setState((s) => {
    const prev = s.byId[sid] ?? EMPTY;
    return {
      byId: {
        ...s.byId,
        [sid]: {
          tasks: list<TaskItem>(t?.body) ?? prev.tasks,
          bgtasks: list<BgTask>(b?.body) ?? prev.bgtasks,
          agents: list<AgentInfo>(a?.body) ?? prev.agents,
          loaded: true,
        },
      },
    };
  });
}

interface Poller { refs: number; timer: ReturnType<typeof setTimeout> | null; kick: ReturnType<typeof setTimeout> | null }
const pollers = new Map<string, Poller>();

function schedule(sid: string): void {
  const p = pollers.get(sid);
  if (!p) return;
  const busy = useConversation.getState().sessions[sid]?.busy ?? false;
  const st = useStatusStore.getState().byId[sid];
  const live = !!st && (st.agents.some((x) => x.status === 'running') || st.bgtasks.some((x) => x.session_id === sid && x.status === 'running'));
  p.timer = setTimeout(() => {
    void refresh(sid).finally(() => schedule(sid));
  }, busy || live ? 2500 : 10_000);
}

/** 工具帧到达：300ms 去抖后补刷一次。 */
function kick(sid: string): void {
  const p = pollers.get(sid);
  if (!p) return;
  if (p.kick) clearTimeout(p.kick);
  p.kick = setTimeout(() => { p.kick = null; void refresh(sid); }, 300);
}

let busReady = false;
function ensureBus(): void {
  if (busReady) return;
  busReady = true;
  engine.onSseEvent((evt: Envelope) => {
    const sid = evt.session_id;
    if (!sid || !pollers.has(sid)) return;
    if (evt.type === 'tool_done' || evt.type === 'subagent_progress' || evt.type === 'done' || evt.type === 'interrupted') kick(sid);
  });
}

/** 订阅对话运行态（挂载期间轮询）。 */
export function useSessionStatus(sid: string | null): SessionStatusData {
  const data = useStatusStore((s) => (sid ? s.byId[sid] : undefined));
  useEffect(() => {
    if (!sid) return;
    ensureBus();
    const p = pollers.get(sid);
    if (p) {
      p.refs++;
    } else {
      pollers.set(sid, { refs: 1, timer: null, kick: null });
      void refresh(sid).finally(() => schedule(sid));
    }
    return () => {
      const cur = pollers.get(sid);
      if (!cur) return;
      if (--cur.refs > 0) return;
      if (cur.timer) clearTimeout(cur.timer);
      if (cur.kick) clearTimeout(cur.kick);
      pollers.delete(sid);
    };
  }, [sid]);
  return data ?? EMPTY;
}

/** 立即刷新（停止后台命令 / 子代理后调用）。 */
export function refreshSessionStatus(sid: string): void {
  void refresh(sid);
}
