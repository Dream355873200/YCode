// teamApi — 团队（Teams v3）的类型与引擎端点封装：主区群聊、右栏成员时间线、
// 建团 / 编辑对话框共用。团队存储在项目目录（<项目>/.yume/teams/<name>/）。
import { engine } from '../protocol';

export interface TeamMemberInfo {
  name: string;
  role: string;
  /** 能力基底智能体（成员 = 智能体 + 身份）。 */
  agent?: string;
  toolsets: string[];
  isLeader: boolean;
  sessionId: string;
  status: 'idle' | 'running' | string;
  activity: string;
}

export interface TeamDetail {
  name: string;
  dir: string;
  goal: string;
  /** 队长的审批策略（权限）。 */
  leaderMode: string;
  leaderAgent?: string;
  members: TeamMemberInfo[];
}

export interface TeamChatMsg {
  ts: string;
  from: string;
  to?: string;
  type: 'chat' | 'dispatch' | 'result' | 'steer' | 'system' | 'permission' | 'question' | string;
  text: string;
  request_id?: string;
}

/** 成员表单（建团 / 编辑）。agent 为空 = 只用工具集白名单。 */
export interface MemberDraft {
  name: string;
  role: string;
  agent: string;
  toolsets: string[];
}

export interface TeamDraft {
  name: string;
  goal: string;
  leaderRole: string;
  leaderPermission: string;
  leaderAgent: string;
  members: MemberDraft[];
}

const q = (dir: string): string => `dir=${encodeURIComponent(dir)}`;

async function body<T>(p: Promise<{ status?: number; body?: unknown }>): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const r = await p;
    if ((r.status ?? 200) >= 400) {
      const b = r.body as { error?: string } | string | undefined;
      return { ok: false, error: typeof b === 'string' ? b.trim() : b?.error || `HTTP ${r.status}` };
    }
    return { ok: true, data: r.body as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const teamApi = {
  detail: (dir: string, name: string) => body<TeamDetail>(engine.get(`/teams/${name}?${q(dir)}`)),
  chat: (dir: string, name: string, after = 0) =>
    body<{ messages: TeamChatMsg[]; total: number }>(engine.get(`/teams/${name}/chat?${q(dir)}&after=${after}`)),
  say: (dir: string, name: string, text: string, at: string) =>
    body<{ ok: boolean; routed: string }>(engine.post(`/teams/${name}/chat?${q(dir)}`, { text, at })),
  live: (dir: string, name: string, member: string) =>
    body<{ status: string; activity: string; events: Array<{ ts: string; type: string; text: string }> }>(
      engine.get(`/teams/${name}/members/${member}/live?${q(dir)}`)),
  create: (dir: string, d: TeamDraft) => body<TeamDetail>(engine.post('/teams', {
    dir, name: d.name.trim(), goal: d.goal.trim(), leaderMode: d.leaderPermission,
    leader: { role: d.leaderRole, agent: d.leaderAgent, toolsets: [] },
    members: d.members.map((m) => ({ name: m.name.trim(), role: m.role.trim(), mode: m.agent, toolsets: m.toolsets })),
  })),
  update: (dir: string, name: string, d: Omit<TeamDraft, 'name'>) => body<TeamDetail>(engine.post(`/teams/${name}/update?${q(dir)}`, {
    goal: d.goal, leaderMode: d.leaderPermission,
    leader: { role: d.leaderRole, agent: d.leaderAgent, toolsets: [] },
    members: d.members.map((m) => ({ name: m.name, role: m.role, mode: m.agent, toolsets: m.toolsets })),
  })),
  remove: (dir: string, name: string) => body<{ ok: boolean }>(engine.del(`/teams/${name}?${q(dir)}`)),
  stop: (sessionId: string) => engine.post('/interrupt', { session_id: sessionId, reason: '用户在团队里停止' }),
  approve: (requestId: string, allow: boolean) =>
    engine.post('/approve', { request_id: requestId, allow, ...(allow ? {} : { reason: '用户拒绝' }) }),
};

/** 团队详情 → 可编辑草稿（编辑对话框起点）。 */
export function draftFromTeam(t: TeamDetail): Omit<TeamDraft, 'name'> {
  const leader = t.members.find((m) => m.isLeader);
  return {
    goal: t.goal,
    leaderRole: leader?.role ?? '',
    leaderPermission: t.leaderMode || 'accept_edits',
    leaderAgent: t.leaderAgent ?? '',
    members: t.members.filter((m) => !m.isLeader).map((m) => ({
      name: m.name, role: m.role, agent: m.agent ?? '', toolsets: m.toolsets.filter((x) => x !== 'team'),
    })),
  };
}

/** 成员会话 tab id（右栏成员时间线）。 */
export const memberTabId = (team: string, member: string): string => `tmember:${team}:${member}`;
export function parseMemberTabId(id: string): { team: string; member: string } | null {
  if (!id.startsWith('tmember:')) return null;
  const rest = id.slice(8);
  const i = rest.indexOf(':');
  return i > 0 ? { team: rest.slice(0, i), member: rest.slice(i + 1) } : null;
}
