// PipelinePanel — 右栏 Pipeline DAG 状态图：create_pipeline 运行时的
// 节点拓扑（依赖分层）+ 实时状态 + 历史回看（GoAgent 落盘快照，跨重启）。
// 点节点 → 打开右栏「节点时间线」tab（NodeTracePane，只读工作过程，
// 复刻 ZCode 的子代理查看形态）。实时数据来自 SSE 帧，历史来自 /pipelines。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckIcon, ChevronDownIcon, CircleAlertIcon, HistoryIcon, Loader2Icon,
  WorkflowIcon, XIcon,
} from 'lucide-react';
import { useApp } from '../app/appState';
import { engine } from '../protocol';
import {
  usePipeline, layerOf, usePipelineHistory, loadPipelineHistory,
  snapshotToView, type DagNode, type RunSnapshot,
} from './pipelineStore';
import { nodeTraceTabId } from './NodeTracePane';
import { cn } from '../components/lib/utils';

const NODE_W = 168, NODE_H = 72, GAP_X = 20, GAP_Y = 48;

function StatusIcon({ status }: { status: DagNode['status'] }) {
  if (status === 'running') {
    return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />;
  }
  if (status === 'done') {
    return <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-success/15"><CheckIcon className="size-2.5 text-success" /></span>;
  }
  if (status === 'error') {
    return <CircleAlertIcon className="size-3.5 shrink-0 text-destructive" />;
  }
  return <span className="size-2 shrink-0 rounded-full border-[1.5px] border-neutral-500/50" />;
}

/** 节点卡：状态侧条 + 名称 + 活动两行。布局原尺绘制（画布整体 scale）。 */
function NodeCard({ n, x, y, onOpen }: { n: DagNode; x: number; y: number; onOpen: () => void }) {
  return (
    <button type="button"
      className={cn(
        'group absolute overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:z-10 hover:border-brand/50 hover:shadow-md',
        n.status === 'running' && 'border-brand/40',
        n.status === 'done' && 'border-success/30',
        n.status === 'error' && 'border-destructive/40',
      )}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
      onClick={onOpen}
      title="查看节点的运行过程">
      {/* 状态侧条 */}
      <span className={cn(
        'absolute inset-y-0 left-0 w-[3px]',
        n.status === 'running' && 'animate-pulse bg-brand',
        n.status === 'done' && 'bg-success/70',
        n.status === 'error' && 'bg-destructive/70',
        n.status === 'pending' && 'bg-neutral-500/25',
      )} />
      <div className="flex h-full flex-col gap-0.5 py-1.5 pl-3 pr-2">
        <div className="flex items-center gap-1.5">
          <StatusIcon status={n.status} />
          <span className="min-w-0 truncate text-ui-xs font-medium text-foreground">{n.name}</span>
          <ChevronDownIcon className="ml-auto size-3 shrink-0 rotate-[-90deg] text-foreground-subtlest opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        <div className="line-clamp-2 text-ui-2xs leading-snug text-foreground-subtlest">
          {n.activity || n.injects.join(' → ') || '等待运行 · 点击查看详情'}
        </div>
      </div>
    </button>
  );
}

export function PipelinePanel() {
  const { project, openPaneTab, setPaneActive } = useApp();
  const dir = project?.dir ?? '';
  const { nodes, goal, startedAt, finishedAt } = usePipeline();
  const history = usePipelineHistory();
  const [viewSnap, setViewSnap] = useState<RunSnapshot | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(320);

  useEffect(() => {
    if (dir) void loadPipelineHistory(dir);
  }, [dir]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((es) => {
      const w = es[0]?.contentRect.width;
      if (w) setWrapW(w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  // 新的实时流水线开始：自动退出历史回看
  useEffect(() => {
    if (startedAt !== null && viewSnap) setViewSnap(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt]);

  // 实时 / 历史两个视图统一成一套渲染数据
  const snapView = useMemo(() => (viewSnap ? snapshotToView(viewSnap) : null), [viewSnap]);
  const viewNodes = snapView ? snapView.nodes : nodes;
  const viewStarted = viewSnap ? viewSnap.started_at : startedAt;
  const viewFinished = viewSnap ? (viewSnap.finished_at ?? null) : finishedAt;
  // 节点时间线归属：实时 = live（引擎解析最新运行），历史 = 快照 id
  const runId = viewSnap?.id ?? 'live';

  const layout = useMemo(() => {
    if (viewNodes.length === 0) return null;
    const layers = new Map<number, DagNode[]>();
    for (const n of viewNodes) {
      const l = layerOf(viewNodes, n.name);
      if (!layers.has(l)) layers.set(l, []);
      layers.get(l)!.push(n);
    }
    const sorted = [...layers.keys()].sort((a, b) => a - b);
    const pos = new Map<string, { x: number; y: number }>();
    let y = 0;
    for (const l of sorted) {
      const row = layers.get(l)!;
      row.forEach((n, i) => {
        pos.set(n.name, { x: i * (NODE_W + GAP_X), y });
      });
      y += NODE_H + GAP_Y;
    }
    const rows = sorted.map((l) => layers.get(l)!.length);
    return { pos, height: y - GAP_Y, contentW: Math.max(...rows.map((c) => c * NODE_W + (c - 1) * GAP_X)) };
  }, [viewNodes]);

  if (viewNodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2.5 p-6 text-center">
        <div className="flex size-11 items-center justify-center rounded-2xl border border-border bg-surface">
          <WorkflowIcon className="size-5 text-foreground-subtlest" />
        </div>
        <div className="text-ui-sm font-medium text-foreground">还没有流水线运行</div>
        <div className="text-ui-xs leading-relaxed text-foreground-subtlest">
          Agent 用 create_pipeline 编排 DAG 时<br />节点拓扑与实时状态会出现在这里
        </div>
      </div>
    );
  }

  // 整体缩放（单一 transform）；过小不缩——横滚优于不可读
  const scale = Math.max(0.75, Math.min(1, (wrapW - 16) / layout!.contentW));
  const running = viewNodes.filter((n) => n.status === 'running').length;
  const done = viewNodes.filter((n) => n.status === 'done').length;
  const hasError = viewNodes.some((n) => n.status === 'error');

  const openNode = (name: string): void => {
    const id = nodeTraceTabId(runId, name);
    openPaneTab({ id, kind: 'pipelineNode', label: name });
    setPaneActive(id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头部：状态一行 + 进度（与 TasksPanel 的进度语言一致） */}
      <div className="shrink-0 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <WorkflowIcon className="size-3.5 shrink-0 text-foreground-subtlest" />
          <span className="truncate text-ui-xs font-medium text-foreground">
            {viewSnap ? '历史运行' : running > 0 ? '流水线运行中' : hasError ? '有节点失败' : '流水线'}
          </span>
          <span className="ml-auto shrink-0 text-ui-2xs text-foreground-subtlest">{done}/{viewNodes.length}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-500/20">
            <span className={cn('block h-full rounded-full transition-all', hasError && done < viewNodes.length ? 'bg-destructive' : 'bg-brand')}
              style={{ width: `${(done / viewNodes.length) * 100}%` }} />
          </span>
          {!viewSnap && history.length > 0 && (
            <select
              aria-label="历史运行"
              className="shrink-0 rounded-md border border-border bg-input px-1 py-0.5 text-ui-2xs text-foreground-subtle outline-none"
              defaultValue=""
              onChange={(e) => {
                const snap = history.find((h) => h.id === e.target.value);
                if (snap && dir) {
                  engine.get(`/pipelines/${snap.id}?dir=${encodeURIComponent(dir)}`).then((r) => {
                    const body = r.body as unknown as RunSnapshot | undefined;
                    if (body?.nodes) setViewSnap(body);
                  }).catch(() => {});
                }
                e.target.value = '';
              }}>
              <option value="">历史…</option>
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  {new Date(h.started_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                </option>
              ))}
            </select>
          )}
          {viewSnap && (
            <button type="button"
              className="flex shrink-0 items-center gap-0.5 rounded-md border border-border px-1 py-0.5 text-ui-2xs text-foreground-subtle hover:bg-hover hover:text-foreground"
              onClick={() => setViewSnap(null)}>
              <XIcon className="size-2.5" /> 退出回看
            </button>
          )}
        </div>
        {(viewSnap ? true : !!goal) && (
          <div className="mt-1 line-clamp-1 text-ui-2xs text-foreground-subtlest">
            {viewSnap
              ? `${new Date(viewStarted!).toLocaleString('zh-CN', { hour12: false })}${viewFinished ? ` · ${new Date(viewFinished).toLocaleTimeString('zh-CN', { hour12: false })} 完成` : ''} · 点节点查看运行过程`
              : goal}
          </div>
        )}
      </div>
      {/* 画布：relative 容器 + 单一 scale 变换（缺 relative 时绝对定位的
          节点卡会以滚动容器为原点，叠进摘要条——右栏布局异常的根因） */}
      <div ref={wrapRef} className="scroll-fine min-h-0 flex-1 overflow-auto p-3">
        <div className="relative" style={{ width: layout!.contentW * scale, height: layout!.height * scale }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: layout!.contentW, height: layout!.height, transform: `scale(${scale})` }}>
            <svg className="absolute left-0 top-0" width={layout!.contentW} height={layout!.height}>
              <defs>
                <marker id="pipe-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
                  <path d="M 0 0 L 6 3 L 0 6 z" className="fill-neutral-500/60" />
                </marker>
              </defs>
              {viewNodes.map((n) => {
                const to = layout!.pos.get(n.name)!;
                return n.dependsOn.map((dep) => {
                  const from = layout!.pos.get(dep);
                  if (!from) return null;
                  const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
                  const x2 = to.x + NODE_W / 2, y2 = to.y - 3;
                  const active = n.status === 'running';
                  return (
                    <g key={`${dep}-${n.name}`}>
                      <path d={`M ${x1} ${y1} C ${x1} ${y1 + GAP_Y / 2}, ${x2} ${y2 - GAP_Y / 2}, ${x2} ${y2}`}
                        fill="none" strokeWidth={active ? 2 : 1.5}
                        markerEnd="url(#pipe-arrow)"
                        className={active ? 'stroke-brand' : 'stroke-neutral-500/40'}
                        strokeDasharray={n.status === 'pending' ? '4 3' : undefined} />
                    </g>
                  );
                });
              })}
            </svg>
            {viewNodes.map((n) => {
              const p = layout!.pos.get(n.name)!;
              return <NodeCard key={n.name} n={n} x={p.x} y={p.y} onOpen={() => openNode(n.name)} />;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
