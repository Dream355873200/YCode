// pipelineStore — create_pipeline 的 DAG 运行状态捕获（模块级单份）。
//
// 数据源是主对话 SSE 流的两类帧：
//   - tool_start(tool_name=create_pipeline) → 从 tool_input.spec 解析 DAG
//     拓扑（节点/依赖/injects），节点状态归零——新流水线开始
//   - subagent_progress → agent_id = 节点名（dynpipeline 的事件透出），
//     agent_status: running/done → 更新节点状态与活动一句话
//
// 团队分派（team_dispatch）也走 subagent_progress，但其 agent_id 是成员
// 会话 ID（team-*），不在节点表里会被忽略——两套编排互不干扰。
import { create } from 'zustand';
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

interface PipelineState {
  nodes: DagNode[];
  goal: string;
  startedAt: number | null;
  finishedAt: number | null;
  reset: (nodes: DagNode[], goal: string) => void;
  update: (name: string, patch: Partial<DagNode>) => void;
  finish: () => void;
}

const usePipelineStore = create<PipelineState>((set) => ({
  nodes: [],
  goal: '',
  startedAt: null,
  finishedAt: null,
  reset: (nodes, goal) => set({ nodes, goal, startedAt: Date.now(), finishedAt: null }),
  update: (name, patch) =>
    set((s) => ({ nodes: s.nodes.map((n) => (n.name === name ? { ...n, ...patch } : n)) })),
  finish: () => set({ finishedAt: Date.now() }),
}));

/** 解析 create_pipeline 的 tool_input（{spec: {...}} 或直接 spec，spec 可能是 JSON 字符串）。 */
function parseSpec(raw: unknown): { goal: string; nodes: DagNode[] } | null {
  try {
    let specRaw: unknown = raw;
    if (specRaw && typeof specRaw === 'object') specRaw = (specRaw as { spec?: unknown }).spec ?? specRaw;
    if (typeof specRaw === 'string') specRaw = JSON.parse(specRaw);
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
      if (st.nodes.every((n) => n.status === 'done' || n.status === 'error')) st.finish();
    }
  });
}

export function usePipeline(): PipelineState {
  initPipelineCapture();
  return usePipelineStore();
}

/** 节点在 DAG 中的层号（最长路径深度）——分层布局用。 */
export function layerOf(nodes: DagNode[], name: string, seen = new Set<string>()): number {
  const n = nodes.find((x) => x.name === name);
  if (!n || n.dependsOn.length === 0 || seen.has(name)) return 0;
  seen.add(name);
  return 1 + Math.max(...n.dependsOn.map((d) => layerOf(nodes, d, seen)));
}
