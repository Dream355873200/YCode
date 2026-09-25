// PipelinePanel — 右栏 Pipeline DAG 状态图：create_pipeline 运行时的
// 节点拓扑（依赖分层）+ 实时状态 + 历史回看（GoAgent 落盘快照，跨重启）。
// 点节点 → 打开右栏「节点时间线」tab（NodeTracePane，只读工作过程，
// 复刻 ZCode 的子代理查看形态）。实时数据来自 SSE 帧，历史来自 /pipelines。
import { useEffect, useMemo, useRef, useState } from 'react';
import { HistoryIcon, XIcon } from 'lucide-react';
import { useApp } from '../app/appState';
import { engine } from '../protocol';
import {
  usePipeline, layerOf, usePipelineHistory, loadPipelineHistory,
  snapshotToView, type DagNode, type RunSnapshot,
} from './pipelineStore';
import { nodeTraceTabId } from './NodeTracePane';
import { cn } from '../components/lib/utils';

const NODE_W = 148, NODE_H = 56, GAP_X = 18, GAP_Y = 44;

const STATUS_STYLE: Record<DagNode['status'], string> = {
  pending: 'border-border bg-card text-foreground-subtle',
  running: 'border-brand/70 bg-brand/10 text-foreground shadow-[0_0_0_1px_rgba(var(--brand-rgb,59,130,246),0.25)]',
  done: 'border-success/60 bg-success/10 text-foreground',
  error: 'border-destructive/60 bg-destructive/10 text-foreground',
};

function StatusDot({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-block size-2 shrink-0 rounded-full',
      status === 'running' && 'animate-pulse bg-brand',
      status === 'done' && 'bg-success',
      status === 'error' && 'bg-destructive',
      status === 'pending' && 'bg-neutral-500/40',
    )} />
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
      <div className="p-6 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
        暂无流水线运行<br />Agent 用 create_pipeline 编排 DAG 时<br />节点拓扑与实时状态会出现在这里
      </div>
    );
  }

  // 整体缩放（单一 transform，内容按布局原尺绘制——不做逐卡缩放）
  const scale = Math.min(1, (wrapW - 16) / layout!.contentW);
  const running = viewNodes.filter((n) => n.status === 'running').length;
  const done = viewNodes.filter((n) => n.status === 'done').length;

  const openNode = (name: string): void => {
    const id = nodeTraceTabId(runId, name);
    openPaneTab({ id, kind: 'pipelineNode', label: name });
    setPaneActive(id);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 摘要条 + 历史选择 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5 text-ui-2xs text-foreground-subtlest">
        {viewSnap ? (
          <>
            <HistoryIcon className="size-3 shrink-0" />
            <span className="truncate">回看 {new Date(viewSnap.started_at).toLocaleString('zh-CN', { hour12: false })}</span>
            <button type="button" aria-label="退出回看"
              className="ml-auto shrink-0 rounded p-0.5 hover:bg-hover hover:text-foreground"
              onClick={() => setViewSnap(null)}>
              <XIcon className="size-3" />
            </button>
          </>
        ) : (
          <>
            <span>{running > 0 ? `${running} 个节点运行中` : viewFinished ? '已完成' : '待运行'}</span>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-500/20">
              <span className="block h-full rounded-full bg-brand transition-all"
                style={{ width: `${(done / viewNodes.length) * 100}%` }} />
            </span>
            <span>{done}/{viewNodes.length}</span>
          </>
        )}
        {!viewSnap && history.length > 0 && (
          <select
            aria-label="历史运行"
            className="max-w-28 shrink-0 rounded border border-border bg-input px-1 py-0.5 text-ui-2xs text-foreground-subtle outline-none"
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
                {new Date(h.started_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} · {h.nodes.length}节点
              </option>
            ))}
          </select>
        )}
      </div>
      {!viewSnap && goal && <div className="shrink-0 px-3 pt-1.5 text-ui-2xs text-foreground-subtlest">{goal}</div>}
      {/* 画布：relative 容器 + 单一 scale 变换（缺 relative 时绝对定位的
          节点卡会以滚动容器为原点，叠进摘要条——右栏布局异常的根因） */}
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto p-2">
        <div className="relative" style={{ width: layout!.contentW * scale, height: layout!.height * scale }}>
          <div className="absolute left-0 top-0 origin-top-left" style={{ width: layout!.contentW, height: layout!.height, transform: `scale(${scale})` }}>
            <svg className="absolute left-0 top-0" width={layout!.contentW} height={layout!.height}>
              {viewNodes.map((n) => {
                const to = layout!.pos.get(n.name)!;
                return n.dependsOn.map((dep) => {
                  const from = layout!.pos.get(dep);
                  if (!from) return null;
                  const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
                  const x2 = to.x + NODE_W / 2, y2 = to.y;
                  const active = n.status === 'running';
                  return (
                    <g key={`${dep}-${n.name}`}>
                      <path d={`M ${x1} ${y1} C ${x1} ${y1 + GAP_Y / 2}, ${x2} ${y2 - GAP_Y / 2}, ${x2} ${y2}`}
                        fill="none" strokeWidth={active ? 2 : 1.5}
                        className={active ? 'stroke-brand' : 'stroke-neutral-500/40'}
                        strokeDasharray={n.status === 'pending' ? '4 3' : undefined} />
                      <circle cx={x2} cy={y2} r={2.5}
                        className={active ? 'fill-brand' : 'fill-neutral-500/60'} />
                    </g>
                  );
                });
              })}
            </svg>
            {viewNodes.map((n) => {
              const p = layout!.pos.get(n.name)!;
              return (
                <button key={n.name} type="button"
                  className={cn('absolute flex flex-col gap-0.5 rounded-lg border px-2 py-1.5 text-left transition-colors hover:brightness-110',
                    STATUS_STYLE[n.status])}
                  style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                  onClick={() => openNode(n.name)}
                  title="点击查看节点的运行过程（只读时间线）">
                  <div className="flex items-center gap-1.5 text-ui-xs font-medium">
                    <StatusDot status={n.status} />
                    <span className="truncate">{n.name}</span>
                  </div>
                  <div className="truncate text-ui-2xs text-foreground-subtlest">{n.activity || n.injects.join(' → ') || ' '}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {viewStarted !== null && (
        <div className="shrink-0 border-t border-border/50 px-3 py-1 text-ui-2xs text-foreground-subtlest">
          开始于 {new Date(viewStarted).toLocaleTimeString('zh-CN', { hour12: false })}
          {viewFinished && ` · 完成 ${new Date(viewFinished).toLocaleTimeString('zh-CN', { hour12: false })}`}
          <span className="ml-1">· 点节点看运行过程</span>
        </div>
      )}
    </div>
  );
}
