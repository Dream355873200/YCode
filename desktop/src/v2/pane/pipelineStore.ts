// pipelineStore — create_pipeline 的 DAG 运行状态捕获（模块级单份）。
//
// 数据源是主对话 SSE 流的两类帧：
//   - tool_start(tool_name=create_pipeline) → 从 tool_input.spec 解析 DAG
//     拓扑（节点/依赖/injects），节点状态归零——新流水线开始
//   - subagent_progress → agent_id = 节点名（dynpipeline 的事件透出），
//     agent_status: running/done → 更新节点状态与活动一句话，并按节点
//     累积运行过程（面板点节点查看；节点是内存循环，无持久会话）
//
// 团队分派（team_dispatch）也走 subagent_progress，但其 agent_id 是成员
// 会话 ID（team-*），不在节点表里会被忽略——两套编排互不干扰。
import { create } from 'zustand';
import { useEffect, useState } from 'react';
import type { Envelope } from 'goagent-client';
import { engine } from '../protocol';

export interface DagNode {
  name: string;
  instruction: string;
  dependsOn: string[];
  injects: string[];
  tools: string[];
  status: 'pending' | 'running' | 'done' | 'error';
  activity: string;
}

export interface NodeEvt {
  ts: number;
  text: string;
}

interface PipelineState {
  nodes: DagNode[];
  goal: string;
  startedAt: number | null;
  finishedAt: number | null;
  events: Record<string, NodeEvt[]>;
  reset: (nodes: DagNode[], goal: string) => void;
  update: (name: string, patch: Partial<DagNode>) => void;
  pushEvent: (name: string, text: string) => void;
  finish: () => void;
}

const EVT_MAX = 200;

const usePipelineStore = create<PipelineState>((set) => ({
  nodes: [],
  goal: '',
  startedAt: null,
  finishedAt: null,
  events: {},
  reset: (nodes, goal) => set({ nodes, goal, startedAt: Date.now(), finishedAt: null, events: {} }),
  update: (name, patch) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.name === name ? { ...n, ...patch } : n)) })),
  pushEvent: (name, text) =>
    set((s) => {
      const list = s.events[name] || [];
      // 连续重复的活动行（同一次思考的多次进度）只保留一条
      if (list.length > 0 && list[list.length - 1]?.text === text) return s;
      const next = [...list, { ts: Date.now(), text }];
      if (next.length > EVT_MAX) next.splice(0, next.length - EVT_MAX);
      return { events: { ...s.events, [name]: next } };
    }),
  finish: () => set({ finishedAt: Date.now() }),
}));

/** 解析 create_pipeline 的 tool_input（{spec: {...}} 或直接 spec，spec 可能是 JSON 字符串/裸数组）。 */
function parseSpec(raw: unknown): { goal: string; nodes: DagNode[] } | null {
  try {
    let specRaw: unknown = raw;
    if (specRaw && typeof specRaw === 'object') specRaw = (specRaw as { spec?: unknown }).spec ?? specRaw;
    if (typeof specRaw === 'string') specRaw = JSON.parse(specRaw);
    if (Array.isArray(specRaw)) specRaw = { nodes: specRaw }; // 模型常见笔误：裸数组
    const spec = specRaw as { nodes?: Array<Record<string, unknown>> } | null;
    if (!spec || !Array.isArray(spec.nodes) || spec.nodes.length === 0) return null;
    const nodes: DagNode[] = spec.nodes.map((n) => ({
      name: String(n.name || '?'),
      instruction: String(n.instruction || ''),
      dependsOn: Array.isArray(n.depends_on) ? n.depends_on.map(String) : [],
      injects: Array.isArray(n.injects) ? n.injects.map(String) : [],
      tools: Array.isArray(n.tools) ? n.tools.map(String) : [],
      status: 'pending',
      activity: '',
    }));
    return { goal: String((specRaw as { goal?: string }).goal || ''), nodes };
  } catch {
    return null;
  }
}

let inited = false;

/** 初始化 SSE 帧捕获（模块级一次；面板打开与否都持续更新——切走再回来不丢状态）。 */
export function initPipelineCapture(): void {
  if (inited) return;
  inited = true;
  engine.onSseEvent((frame: Envelope) => {
    const st = usePipelineStore.getState();
    if (frame.type === 'tool_start' && frame.tool_name === 'create_pipeline') {
      const parsed = parseSpec(frame.tool_input);
      if (parsed) st.reset(parsed.nodes, parsed.goal);
      return;
    }
    if (frame.type === 'subagent_progress' && st.nodes.length > 0) {
      const id = frame.agent_id || '';
      const node = st.nodes.find((n) => n.name === id);
      if (!node) return;
      const status = frame.agent_status === 'done' ? 'done' : frame.agent_status === 'error' ? 'error' : 'running';
      st.update(id, { status, activity: frame.agent_activity || '' });
      if (frame.agent_activity) st.pushEvent(id, frame.agent_activity);
      if (st.nodes.every((n) => n.status === 'done' || n.status === 'error')) st.finish();
    }
  });
}

// 模块加载即开始捕获（SidePane 静态 import 本模块）：pipeline 在任意会话
// 跑起来时面板可能从未打开过——懒初始化会漏掉全部帧，右栏一片空白。
initPipelineCapture();

export function usePipeline(): PipelineState {
  return usePipelineStore();
}

// ---- 历史运行（GoAgent 落盘快照，引擎 /pipelines 端点） ----

export interface RunSnapshotNode {
  name: string; instruction?: string; tools?: string[];
  depends_on?: string[]; injects?: string[];
  status: string; outputs?: string[];
}
export interface RunSnapshot {
  id: string; started_at: number; finished_at?: number; nodes: RunSnapshotNode[];
}
export interface RunSummary {
  id: string; started_at: number; finished_at?: number;
  nodes: string[]; statuses: string[];
}

/** 快照 → 面板 DAG 视图（与实时捕获共用渲染；产出映射为节点事件行）。 */
export function snapshotToView(snap: RunSnapshot): { nodes: DagNode[]; events: Record<string, NodeEvt[]> } {
  const nodes: DagNode[] = snap.nodes.map((n) => ({
    name: n.name,
    instruction: n.instruction || '',
    dependsOn: n.depends_on || [],
    injects: n.injects || [],
    tools: n.tools || [],
    status: n.status === 'running' ? 'done' : (n.status as DagNode['status']),
    activity: '',
  }));
  const events: Record<string, NodeEvt[]> = {};
  for (const n of snap.nodes) {
    events[n.name] = (n.outputs || []).map((text, i) => ({ ts: (snap.finished_at || snap.started_at) + i, text }));
  }
  return { nodes, events };
}

const historySubs = new Set<(v: RunSummary[]) => void>();
let history: RunSummary[] = [];

function setHistory(v: RunSummary[]): void {
  history = v;
  for (const f of historySubs) f(history);
}

/** 拉取历史运行列表（面板打开时调用；快照存在项目 .yume/pipelines/）。 */
export async function loadPipelineHistory(dir: string): Promise<void> {
  try {
    const r = await engine.get(`/pipelines?dir=${encodeURIComponent(dir)}`);
    const runs = (r.body as { runs?: RunSummary[] })?.runs;
    if (runs) setHistory(runs);
  } catch { /* 引擎不可达：保留现有列表 */ }
}

export function usePipelineHistory(): RunSummary[] {
  const [v, setV] = useState(history);
  useEffect(() => {
    historySubs.add(setV);
    return () => { historySubs.delete(setV); };
  }, []);
  return v;
}

/** 节点在 DAG 中的层号（最长路径深度）——分层布局用。 */
export function layerOf(nodes: DagNode[], name: string, seen = new Set<string>()): number {
  const n = nodes.find((x) => x.name === name);
  if (!n || n.dependsOn.length === 0 || seen.has(name)) return 0;
  seen.add(name);
  return 1 + Math.max(...n.dependsOn.map((d) => layerOf(nodes, d, seen)));
}
