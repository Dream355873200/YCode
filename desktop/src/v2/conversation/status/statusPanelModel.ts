// statusPanelModel — 对话状态面板的纯数据模型：哪些区块出现、收起态胶囊显示什么。
// 渲染层只消费这里的产出，不自行判断。
//
// 区块（按渲染顺序）：目标（逐轮验收轨迹）· 进程（任务清单）· 协作（运行中的
// 子代理 + 本对话的流水线，同属「几个 agent 怎么配合」这根轴）· 终端（后台命令）·
// 计划（本对话退出规划模式时提交的计划）· 工作区（Git 改动 / 分支 / 提交，以及
// 智能体的插件此刻持有的环境资源：浏览器页面、真机、MCP 服务）。
import type { Row } from '../projection/rows';

/** 引擎任务（GET /tasks?session_id=）。 */
export interface TaskItem {
  id: string;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed' | string;
}

/** 后台任务（GET /bgtasks）。 */
export interface BgTask {
  id: string;
  type: 'local_bash' | 'local_agent' | string;
  status: 'running' | 'completed' | 'failed' | 'killed' | string;
  description?: string;
  command?: string;
  session_id?: string;
  start_time?: string;
  /** 输出落盘文件（点开查看）。 */
  output_file?: string;
}

/** 子代理（GET /agents?session_id=）。 */
export interface AgentInfo {
  id: string;
  name: string;
  status: 'running' | 'done' | 'failed' | 'cancelled' | string;
  activity?: string;
  started_at?: string;
}

/** 对话目标（引擎 threads 列表的 goal 字段）。 */
export interface ThreadGoal {
  objective: string;
  status: 'active' | 'paused' | 'verified' | string;
  iteration: number;
  maxIterations: number;
  elapsedMs: number;
  activeSince?: number;
  createdAt: number;
  pausedReason?: string;
  checks?: Array<{ iteration: number; passed: boolean; reason: string; nextAction?: string; at: number }>;
}

export interface GitSnapshot {
  ok: boolean;
  added: number;
  deleted: number;
  files: number;
  branch?: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
}

export interface PipelineSnapshot {
  sessionId: string | null;
  goal: string;
  nodes: Array<{ name: string; status: 'pending' | 'running' | 'done' | 'error'; dependsOn?: string[] }>;
  startedAt: number | null;
  finishedAt: number | null;
}

/** 智能体插件持有的环境资源（只列与当前智能体相关的）。 */
export interface EnvSnapshot {
  /** 内置浏览器页面数（智能体带浏览器操作插件时才统计）。 */
  browserPages?: number;
  /** 已连接的真机 / 模拟器（智能体带设备插件时才统计）。 */
  devices?: string[];
  /** 智能体插件声明的 MCP 服务状态。 */
  mcp?: Array<{ name: string; status: 'connecting' | 'connected' | 'error' | string; error?: string }>;
}

export interface PlanDoc {
  toolUseId: string;
  title: string;
  markdown: string;
}

export interface TodoModel {
  items: TaskItem[];
  completed: number;
  total: number;
}

export interface RunningItem {
  id: string;
  title: string;
  startedAt: number;
  /** 终端：输出文件（点开在右栏查看）。 */
  outputFile?: string;
}

export interface PipelineModel {
  title: string;
  settled: number;
  total: number;
  /** 节点按 DAG 层序排列（协作区块的节点条）。 */
  nodes: Array<{ name: string; status: 'pending' | 'running' | 'done' | 'error' }>;
  /** 正在跑的节点名（并行时多个）。 */
  running: string[];
  startedAt: number;
}

export interface StatusPanelModel {
  goal: ThreadGoal | null;
  todo: TodoModel | null;
  agents: RunningItem[];
  endedAgents: number;
  pipeline: PipelineModel | null;
  terminals: RunningItem[];
  plans: PlanDoc[];
  git: GitSnapshot | null;
  env: EnvSnapshot | null;
  hasContent: boolean;
}

export interface StatusInputs {
  sid: string;
  git?: GitSnapshot | null;
  goal?: ThreadGoal | null;
  rows?: readonly Row[];
  tasks?: readonly TaskItem[];
  bgtasks?: readonly BgTask[];
  agents?: readonly AgentInfo[];
  pipeline?: PipelineSnapshot | null;
  env?: EnvSnapshot | null;
}

const PLAN_PREFIX = /^[\s\S]*?计划内容[:：]\s*\n?/;

/** 计划标题：首个 Markdown 标题，没有就取首个非空行。 */
export function planTitle(markdown: string): string {
  const lines = markdown.split('\n').map((l) => l.trim()).filter(Boolean);
  const heading = lines.find((l) => /^#{1,6}\s/.test(l));
  const raw = (heading ?? lines[0] ?? '').replace(/^#{1,6}\s+/, '').replace(/[*_`]/g, '').trim();
  return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
}

/** 本对话已提交的计划（ExitPlanMode 的结果携带计划正文；新的在前）。 */
export function extractPlans(rows: readonly Row[]): PlanDoc[] {
  const out: PlanDoc[] = [];
  for (const r of rows) {
    if (r.kind !== 'tool' || r.name !== 'ExitPlanMode' || r.state === 'running' || !r.result) continue;
    if (!PLAN_PREFIX.test(r.result)) continue;
    const markdown = r.result.replace(PLAN_PREFIX, '').trim();
    if (markdown) out.push({ toolUseId: r.toolUseId, title: planTitle(markdown) || '计划', markdown });
  }
  return out.reverse();
}

/** 子代理标题：发起调用时的任务描述（工具入参），缺失时用子代理名。 */
function agentTitles(rows: readonly Row[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.kind !== 'tool' || !r.name.startsWith('Agent_')) continue;
    const input = (r.input && typeof r.input === 'object' ? r.input : {}) as Record<string, unknown>;
    const text = [input.description, input.task, input.prompt].find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    if (text) m.set(r.toolUseId, text.trim().split('\n')[0]!.slice(0, 80));
  }
  return m;
}

/** 节点的 DAG 层号（最长依赖深度）。 */
function layer(nodes: PipelineSnapshot['nodes'], name: string, seen = new Set<string>()): number {
  const n = nodes.find((x) => x.name === name);
  if (!n?.dependsOn?.length || seen.has(name)) return 0;
  seen.add(name);
  return 1 + Math.max(...n.dependsOn.map((d) => layer(nodes, d, seen)));
}

const ts = (iso?: string): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};

export function buildStatusPanelModel(input: StatusInputs): StatusPanelModel {
  const rows = input.rows ?? [];
  const goal = input.goal ?? null;
  const tasks = input.tasks ?? [];
  const todo = tasks.length
    ? { items: [...tasks], completed: tasks.filter((t) => t.status === 'completed').length, total: tasks.length }
    : null;
  const titles = agentTitles(rows);
  const agentsAll = input.agents ?? [];
  const agents = agentsAll
    .filter((a) => a.status === 'running')
    .map((a) => ({ id: a.id, title: titles.get(a.id) ?? `子代理 ${a.name}`, startedAt: ts(a.started_at) }));
  const endedAgents = agentsAll.filter((a) => a.status !== 'running').length;
  const p = input.pipeline;
  const pipeline = p && p.sessionId === input.sid && p.nodes.length > 0 && !p.finishedAt
    ? {
      title: p.goal.trim() || '流水线',
      settled: p.nodes.filter((n) => n.status === 'done' || n.status === 'error').length,
      total: p.nodes.length,
      nodes: [...p.nodes]
        .map((n, i) => ({ n, i, l: layer(p.nodes, n.name) }))
        .sort((a, b) => a.l - b.l || a.i - b.i)
        .map(({ n }) => ({ name: n.name, status: n.status })),
      running: p.nodes.filter((n) => n.status === 'running').map((n) => n.name),
      startedAt: p.startedAt ?? Date.now(),
    }
    : null;
  const terminals = (input.bgtasks ?? [])
    .filter((b) => b.session_id === input.sid && b.type === 'local_bash' && b.status === 'running')
    .map((b) => ({ id: b.id, title: b.description || b.command || b.id, startedAt: ts(b.start_time), outputFile: b.output_file }));
  const plans = extractPlans(rows);
  const git = input.git?.ok && input.git.added + input.git.deleted > 0 ? input.git : null;
  const e = input.env;
  const env = e && ((e.browserPages ?? 0) > 0 || (e.devices?.length ?? 0) > 0 || (e.mcp?.length ?? 0) > 0) ? e : null;
  return {
    goal, todo, agents, endedAgents, pipeline, terminals, plans, git, env,
    hasContent: !!(goal || todo || agents.length || pipeline || terminals.length || plans.length || git || env),
  };
}

// ---------- 进程区块的精简窗口（> 6 条时只露当前附近 3 条） ----------

const COMPACT_THRESHOLD = 6;
const FOCUS_SIZE = 3;

export interface TodoFocusWindow {
  compact: boolean;
  preceding: TaskItem[];
  focus: TaskItem[];
  following: TaskItem[];
}

export function todoFocusWindow(items: readonly TaskItem[]): TodoFocusWindow {
  if (items.length <= COMPACT_THRESHOLD) return { compact: false, preceding: [], focus: [...items], following: [] };
  const running = items.findIndex((t) => t.status === 'in_progress');
  const unfinished = items.findIndex((t) => t.status !== 'completed');
  const at = running >= 0 ? running : unfinished >= 0 ? unfinished : items.length - FOCUS_SIZE;
  const start = Math.max(0, Math.min(at, items.length - FOCUS_SIZE));
  const end = Math.min(items.length, start + FOCUS_SIZE);
  return { compact: true, preceding: items.slice(0, start), focus: items.slice(start, end), following: items.slice(end) };
}

/** 折叠桶的文案：按桶内真实状态说话，不用位置虚报。 */
export function foldLabel(group: 'preceding' | 'following', items: readonly TaskItem[]): string {
  if (group === 'preceding') {
    return items.every((t) => t.status === 'completed') ? `已完成 ${items.length} 项` : `前面 ${items.length} 项`;
  }
  return items.every((t) => t.status === 'pending') ? `待处理 ${items.length} 项` : `后面 ${items.length} 项`;
}

// ---------- 收起态胶囊 ----------

/** 胶囊主状态：只说一件事。 */
export type CapsuleMain =
  | { kind: 'pipeline'; title: string; phase: string }
  | { kind: 'todoCurrent'; text: string }
  | { kind: 'goal'; text: string; done: boolean }
  | { kind: 'git'; added: number; deleted: number }
  | { kind: 'todoDone'; text: string }
  | { kind: 'todoProgress'; completed: number; total: number }
  | { kind: 'plan'; title: string }
  | { kind: 'activity' };

export interface Capsule {
  main: CapsuleMain;
  /** 实时活动计数（主状态之外仍在跑的后台资源，胶囊尾部常驻，不被主状态挤掉）。 */
  agents: number;
  terminals: number;
}

/** 胶囊：主状态优先级为 在跑的流水线 → 当前任务 → 进行中的目标 → Git 改动 →
 *  已达成的目标 → 最近完成的任务 → 任务进度 → 计划；都没有而仍有后台活动时
 *  主状态退为「活动」。子代理 / 终端计数始终作为尾部计数出现。 */
export function capsuleOf(m: StatusPanelModel): Capsule | null {
  const counts = { agents: m.agents.length, terminals: m.terminals.length };
  const items = m.todo?.items ?? [];
  const current = items.find((t) => t.status === 'in_progress') ?? items.find((t) => t.status === 'pending');
  const done = [...items].reverse().find((t) => t.status === 'completed');
  let main: CapsuleMain | null = null;
  if (m.pipeline) {
    main = { kind: 'pipeline', title: m.pipeline.title, phase: m.pipeline.running.length ? m.pipeline.running.join(' / ') : `${m.pipeline.settled}/${m.pipeline.total}` };
  } else if (current) main = { kind: 'todoCurrent', text: current.subject };
  else if (m.goal && (m.goal.status === 'active' || m.goal.status === 'paused')) main = { kind: 'goal', text: m.goal.objective, done: false };
  else if (m.git) main = { kind: 'git', added: m.git.added, deleted: m.git.deleted };
  else if (m.goal?.status === 'verified') main = { kind: 'goal', text: m.goal.objective, done: true };
  else if (done) main = { kind: 'todoDone', text: done.subject };
  else if (m.todo) main = { kind: 'todoProgress', completed: m.todo.completed, total: m.todo.total };
  else if (m.plans[0]) main = { kind: 'plan', title: m.plans[0].title };
  else if (counts.agents || counts.terminals) main = { kind: 'activity' };
  return main ? { main, ...counts } : null;
}

/** 目标累计时长（进行中的一段实时累加）。 */
export function goalElapsedMs(g: ThreadGoal, now = Date.now()): number {
  return g.elapsedMs + (g.status === 'active' && g.activeSince ? Math.max(0, now - g.activeSince) : 0);
}

/** 时长：x小时 y分 / y分 z秒 / z秒。 */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}小时${m ? ` ${m}分` : ''}`;
  if (m > 0) return `${m}分${sec ? ` ${sec}秒` : ''}`;
  return `${sec}秒`;
}
