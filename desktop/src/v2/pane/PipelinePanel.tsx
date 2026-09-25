// PipelinePanel — 右栏 Pipeline DAG 状态图：create_pipeline 运行时的
// 节点拓扑（依赖分层）+ 实时状态（pending/running/done/error）。
// 拓扑来自 tool_start 帧，状态来自 subagent_progress 帧（pipelineStore）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePipeline, layerOf, type DagNode } from './pipelineStore';
import { cn } from '../components/lib/utils';

const NODE_W = 148, NODE_H = 56, GAP_X = 18, GAP_Y = 44;

const STATUS_STYLE: Record<DagNode['status'], string> = {
  pending: 'border-border bg-card text-foreground-subtle',
  running: 'border-brand/70 bg-brand/10 text-foreground shadow-[0_0_0_1px_rgba(var(--brand-rgb,59,130,246),0.25)]',
  done: 'border-success/60 bg-success/10 text-foreground',
  error: 'border-destructive/60 bg-destructive/10 text-foreground',
};

function StatusDot({ status }: { status: DagNode['status'] }) {
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
  const { nodes, goal, startedAt, finishedAt } = usePipeline();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(320);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((es) => {
      const w = es[0]?.contentRect.width;
      if (w) setWrapW(w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (nodes.length === 0) return null;
    // 分层：layer = 最长依赖深度；同层从左到右排
    const layers = new Map<number, DagNode[]>();
    for (const n of nodes) {
      const l = layerOf(nodes, n.name);
      if (!layers.has(l)) layers.set(l, []);
      layers.get(l)!.push(n);
    }
    const sorted = [...layers.keys()].sort((a, b) => a - b);
    const pos = new Map<string, { x: number; y: number }>();
    let y = 0;
    for (const l of sorted) {
      const row = layers.get(l)!;
      const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
      row.forEach((n, i) => {
        pos.set(n.name, { x: i * (NODE_W + GAP_X), y });
      });
      y += NODE_H + GAP_Y;
    }
    return { pos, height: y - GAP_Y, contentW: Math.max(...sorted.map((l) => layers.get(l)!.length * NODE_W + (layers.get(l)!.length - 1) * GAP_X)) };
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="p-6 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
        暂无流水线运行<br />Agent 用 create_pipeline 编排 DAG 时<br />节点拓扑与实时状态会出现在这里
      </div>
    );
  }

  const scale = Math.min(1, (wrapW - 16) / layout!.contentW);
  const running = nodes.filter((n) => n.status === 'running').length;
  const done = nodes.filter((n) => n.status === 'done').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 摘要条 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-1.5 text-ui-2xs text-foreground-subtlest">
        <span>{running > 0 ? `${running} 个节点运行中` : finishedAt ? '已完成' : '待运行'}</span>
        <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-500/20">
          <span className="block h-full rounded-full bg-brand transition-all"
            style={{ width: `${(done / nodes.length) * 100}%` }} />
        </span>
        <span>{done}/{nodes.length}</span>
      </div>
      {goal && <div className="shrink-0 px-3 pt-1.5 text-ui-2xs text-foreground-subtlest">{goal}</div>}
      {/* 画布 */}
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-auto p-2">
        <div style={{ width: layout!.contentW * scale, height: layout!.height * scale }}>
          <svg className="absolute" width={layout!.contentW} height={layout!.height}
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            {nodes.map((n) => {
              const to = layout!.pos.get(n.name)!;
              for (const dep of n.dependsOn) {
                const from = layout!.pos.get(dep);
                if (!from) continue;
                const x1 = from.x + NODE_W / 2, y1 = from.y + NODE_H;
                const x2 = to.x + NODE_W / 2, y2 = to.y;
                const target = nodes.find((x) => x.name === n.name)!;
                const active = target.status === 'running';
                return (
                  <g key={`${dep}-${n.name}`}>
                    <path d={`M ${x1} ${y1} C ${x1} ${y1 + GAP_Y / 2}, ${x2} ${y2 - GAP_Y / 2}, ${x2} ${y2}`}
                      fill="none" strokeWidth={active ? 2 : 1.5}
                      className={active ? 'stroke-brand' : 'stroke-neutral-500/40'}
                      strokeDasharray={target.status === 'pending' ? '4 3' : undefined} />
                    <circle cx={x2} cy={y2} r={2.5}
                      className={active ? 'fill-brand' : 'fill-neutral-500/60'} />
                  </g>
                );
              }
              return null;
            })}
          </svg>
          {nodes.map((n) => {
            const p = layout!.pos.get(n.name)!;
            return (
              <div key={n.name}
                className={cn('absolute flex flex-col gap-0.5 rounded-lg border px-2 py-1.5', STATUS_STYLE[n.status])}
                style={{ left: p.x * scale, top: p.y * scale, width: NODE_W * scale, height: NODE_H * scale }}>
                <div className="flex items-center gap-1.5 text-ui-xs font-medium" style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: NODE_W - 16 }}>
                  <StatusDot status={n.status} />
                  <span className="truncate">{n.name}</span>
                </div>
                {n.activity && scale > 0.6 && (
                  <div className="truncate text-ui-2xs text-foreground-subtlest" style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: NODE_W - 16 }}>
                    {n.activity}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {startedAt && (
        <div className="shrink-0 border-t border-border/50 px-3 py-1 text-ui-2xs text-foreground-subtlest">
          开始于 {new Date(startedAt).toLocaleTimeString('zh-CN', { hour12: false })}
          {finishedAt && ` · 完成 ${new Date(finishedAt).toLocaleTimeString('zh-CN', { hour12: false })}`}
        </div>
      )}
    </div>
  );
}
