// RowView — row → 组件分发。展示层唯一职责：把权威 row 画出来。
// 工具卡片复用 legacy 渲染器注册表（toolRender.jsx，P0 平移资产）；
// 交互卡（审批/确认/提问）直接挂 store 回传。
import { memo, useEffect, useRef, useState } from 'react';
import { Bot, Brain } from 'lucide-react';
import type { Row, ToolRow } from './projection/rows';
import { useConversation } from './store';
import { resolveRenderer, actObj, actVerbPlain, toolStats } from '../../lib/toolRender';
import { renderMD } from '../../lib/markdown';
import { Button } from '../components/ui/button';
import { Collapse } from '../components/ui/collapse';

// ---------- 正文 / 思考 ----------

// renderMD 按原文缓存（lib/markdown）；memo 挡掉父级无关重渲染
const Markdown = memo(function Markdown({ text }: { text: string }) {
  // renderMD 产出受控 HTML（legacy 同路径：先转义再高亮，无注入面）
  return <div className="v2-md" dangerouslySetInnerHTML={{ __html: renderMD(text) }} />;
});

function Reasoning({ row, live }: { row: Extract<Row, { kind: 'reasoning' }>; live?: boolean }) {
  const [manualOpen, setManualOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // 直播中：内容追加即贴底（只滚思考框，不动对话滚动）
  useEffect(() => {
    if (live && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [row.text, live]);
  const open = live || manualOpen;
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ui-xs text-foreground-subtlest hover:bg-hover hover:text-foreground-subtle"
      >
        <Brain size={12}
          className={`shrink-0 ${live ? 'animate-pulse text-brand' : 'text-foreground-subtlest'}`} />
        {live ? '思考中…' : '思考'}
      </button>
      <Collapse open={open}>
        <div ref={boxRef}
          className={`scroll-fine mt-1 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-3 text-ui-sm text-foreground-subtle ${live ? 'h-28' : 'max-h-72'}`}>
          {row.text}
        </div>
      </Collapse>
    </div>
  );
}

// ---------- 工具卡（ToolLayout 骨架 + 注册表分发） ----------

function ToolCard({ row }: { row: Extract<Row, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const R = resolveRenderer(row.name);
  const input = typeof row.input === 'string' ? safeJson(row.input) : row.input;
  const obj = R.obj && input ? R.obj(input) : '';
  const label = actVerbPlain(row.name);
  const stIcon = row.state === 'running' ? '◌' : row.state === 'err' ? '✕' : '✓';
  const stCls = row.state === 'running' ? 'text-brand' : row.state === 'err' ? 'text-destructive' : 'text-success';
  const expandable = !!R.expandable && (open || !!row.result);
  // 编辑/写入的 ± 行数徽标（+3 −8，ZCode 式）
  const stats = toolStats(row.name, input);

  return (
    <div className="my-1 rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => R.expandable && setOpen(!open)}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui-sm ${R.expandable ? 'cursor-pointer hover:bg-hover' : 'cursor-default'}`}
      >
        {R.expandable && (
          <span className={`inline-block w-3 text-foreground-subtlest transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▸</span>
        )}
        {R.Icon && <R.Icon className="size-3.5 shrink-0 text-foreground-subtle" />}
        <span className="text-foreground-subtle">{label}</span>
        {obj && <span className="min-w-0 truncate text-foreground-subtlest">{obj}</span>}
        {stats && (
          <span className="ml-auto shrink-0 font-mono text-ui-xs">
            {stats.add > 0 && <span className="text-success">+{stats.add}</span>}
            {stats.add > 0 && stats.del > 0 && <span className="text-foreground-subtlest"> </span>}
            {stats.del > 0 && <span className="text-destructive">−{stats.del}</span>}
          </span>
        )}
        <span className={`${stats ? '' : 'ml-auto'} shrink-0 text-ui-xs ${stCls}`}>{stIcon}</span>
      </button>
      <Collapse open={expandable && open} className="border-t border-border px-3 py-2">
        {R.Detail
          ? <R.Detail act={{ verb: row.name, input, obj, st: row.state === 'running' ? '…' : row.state === 'err' ? 'err' : 'ok', detail: row.result || '', toolUseId: row.toolUseId, expand: true }} />
          : <pre className="scroll-fine max-h-72 overflow-auto whitespace-pre-wrap text-ui-xs text-foreground-subtle">{row.result}</pre>}
      </Collapse>
    </div>
  );
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

// ---------- 子 agent 卡（运行过程折叠 + 最新活动直播） ----------

/** 展开态默认显示的最近活动条数；更早的折叠为「更早 N 条」。 */
const AGENT_RECENT = 8;

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function AgentCard({ row }: { row: ToolRow }) {
  const [open, setOpen] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const input = (typeof row.input === 'string' ? safeJson(row.input) : row.input) as Record<string, unknown> | undefined;
  const task = typeof input?.task === 'string' ? input.task : '';
  const background = input?.run_in_background === true;
  const ag = row.agent;
  const name = row.name.replace(/^Agent_/, '');

  // 状态：子 agent 进度优先（后台任务在 tool_done 之后仍在跑）
  const status: 'running' | 'done' | 'failed' = ag?.status
    ?? (row.state === 'running' ? 'running' : row.state === 'err' ? 'failed' : 'done');
  const running = status === 'running';
  const acts = ag?.activities ?? [];
  const latest = acts[acts.length - 1];
  const older = Math.max(0, acts.length - AGENT_RECENT);
  const visible = showOld ? acts : acts.slice(older);

  // 展开且运行中：新活动追加即贴底（只滚卡内列表）
  useEffect(() => {
    if (open && running && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [acts.length, open, running]);

  const stText = running
    ? (background && row.state !== 'running' ? '后台运行中' : '运行中')
    : status === 'failed' ? '失败' : '完成';
  const stCls = running ? 'text-brand' : status === 'failed' ? 'text-destructive' : 'text-success';
  const meta = [
    ag && ag.toolUses > 0 ? `${ag.toolUses} 次工具` : '',
    ag && ag.tokens > 0 ? `${fmtTokens(ag.tokens)} tokens` : '',
  ].filter(Boolean).join(' · ');
  // 结果去掉统计附注（卡头已显示）
  const result = (row.result || '').replace(/\n*--- agent「[^」]*」: .*---\s*$/, '').trim();

  return (
    <div className="my-1 rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui-sm hover:bg-hover"
      >
        <span className={`inline-block w-3 text-foreground-subtlest transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▸</span>
        {running
          ? <span className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          : <Bot size={13} className="shrink-0 text-foreground-subtlest" />}
        <span className="shrink-0 text-foreground-subtle">子代理 {name}</span>
        {task && <span className="min-w-0 truncate text-foreground-subtlest">{task}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-ui-xs">
          {meta && <span className="text-foreground-subtlest">{meta}</span>}
          <span className={stCls}>{stText}</span>
        </span>
      </button>
      {/* 折叠态：运行中直播最新一条活动 */}
      {!open && running && latest && (
        <div className="flex items-center gap-1.5 border-t border-border px-3 py-1 text-ui-xs text-foreground-subtlest">
          <span className="text-brand">›</span>
          <span className="min-w-0 truncate">{latest}</span>
        </div>
      )}
      <Collapse open={open} className="border-t border-border">
        {acts.length > 0 && (
          <div ref={listRef} className="scroll-fine max-h-48 overflow-y-auto px-3 py-1.5">
            {older > 0 && (
              <button
                type="button"
                onClick={() => setShowOld(!showOld)}
                className="mb-0.5 text-ui-xs text-foreground-subtlest hover:text-foreground-subtle"
              >
                {showOld ? '收起更早的活动' : `更早 ${older} 条…`}
              </button>
            )}
            {visible.map((a, i) => {
              const isLast = i === visible.length - 1;
              return (
                <div key={i} className={`flex gap-1.5 py-px text-ui-xs ${isLast && running ? 'text-foreground-subtle' : 'text-foreground-subtlest'}`}>
                  <span className={isLast && running ? 'text-brand' : ''}>{isLast && running ? '›' : '·'}</span>
                  <span className="min-w-0 truncate">{a}</span>
                </div>
              );
            })}
          </div>
        )}
        {status === 'failed' && ag?.error && (
          <div className="border-t border-border px-3 py-1.5 text-ui-xs text-destructive">{ag.error}</div>
        )}
        {result && (
          <div className="scroll-fine max-h-72 overflow-y-auto border-t border-border px-3 py-2 text-ui-sm">
            <Markdown text={result} />
          </div>
        )}
      </Collapse>
    </div>
  );
}

// ---------- 探索组（连续读取折叠，ZCode 式） ----------

export type ReadGroupUnit = { kind: 'readgroup'; id: string; reads: ToolRow[] };

/** 连续 ≥2 个 Read 工具合并为一个可展开的「探索」组；单个保持原卡片。 */
export function foldReads(rows: readonly Row[]): Array<Row | ReadGroupUnit> {
  const out: Array<Row | ReadGroupUnit> = [];
  let buf: ToolRow[] = [];
  const flush = () => {
    if (buf.length >= 2 && buf[0]) out.push({ kind: 'readgroup', id: `grp-${buf[0].id}`, reads: buf });
    else if (buf.length === 1 && buf[0]) out.push(buf[0]);
    buf = [];
  };
  for (const r of rows) {
    if (r.kind === 'tool' && r.name === 'Read') buf.push(r);
    else { flush(); out.push(r); }
  }
  flush();
  return out;
}

function ReadItem({ row }: { row: ToolRow }) {
  const [open, setOpen] = useState(false);
  const input = typeof row.input === 'string' ? safeJson(row.input) : row.input;
  const path = input && typeof input === 'object'
    ? String((input as Record<string, unknown>).file_path || '')
    : '';
  const stIcon = row.state === 'running' ? '◌' : row.state === 'err' ? '✕' : '✓';
  const stCls = row.state === 'running' ? 'text-brand' : row.state === 'err' ? 'text-destructive' : 'text-success';
  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-ui-xs hover:bg-hover"
      >
        <span className="min-w-0 truncate text-foreground-subtle">
          {path.split(/[\\/]/).pop() || path || '（未知文件）'}
        </span>
        <span className={`ml-auto shrink-0 ${stCls}`}>{stIcon}</span>
      </button>
      <Collapse open={open}>
        <pre className="scroll-fine max-h-60 overflow-auto border-t border-border px-3 py-2 text-ui-xs text-foreground-subtle">
          {row.result}
        </pre>
      </Collapse>
    </div>
  );
}

/** 探索组：一次读取多个文件时折叠成一张卡（头部「探索 · N 个文件」，展开逐项）。 */
export function ReadGroup({ group }: { group: ReadGroupUnit }) {
  const [open, setOpen] = useState(false);
  const reads = group.reads;
  const errCount = reads.filter((r) => r.state === 'err').length;
  const running = reads.some((r) => r.state === 'running');
  const stIcon = running ? '◌' : errCount ? '✕' : '✓';
  const stCls = running ? 'text-brand' : errCount ? 'text-destructive' : 'text-success';
  return (
    <div className="my-1 rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui-sm hover:bg-hover"
      >
        <span className={`inline-block w-3 text-foreground-subtlest transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="text-foreground-subtle">探索</span>
        <span className="min-w-0 truncate text-foreground-subtlest">
          读取了 {reads.length} 个文件{errCount ? ` · ${errCount} 个失败` : ''}
        </span>
        <span className={`ml-auto shrink-0 text-ui-xs ${stCls}`}>{stIcon}</span>
      </button>
      <Collapse open={open}>{reads.map((r) => <ReadItem key={r.id} row={r} />)}</Collapse>
    </div>
  );
}

// ---------- 交互卡 ----------

function PermissionCard({ row, sid }: { row: Extract<Row, { kind: 'permission' }>; sid: string }) {
  const approve = useConversation((s) => s.approve);
  if (row.resolved) {
    return (
      <div className="my-2 rounded-lg border border-border bg-surface px-3 py-2 text-ui-sm text-foreground-subtlest">
        {row.toolName} · {row.resolved === 'approved' ? '已允许' : '已拒绝'}
      </div>
    );
  }
  const obj = actObj(row.toolName, row.toolInput);
  return (
    <div className="my-2 rounded-lg border border-border-hover bg-card px-3 py-2.5">
      <div className="text-ui-sm">
        <span className="font-medium text-foreground">允许执行 {row.toolName}</span>
        {obj && <span className="ml-2 text-foreground-subtlest">{obj}</span>}
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={() => approve(sid, row.requestId, true)}>允许</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => approve(sid, row.requestId, false)}>拒绝</Button>
      </div>
    </div>
  );
}

/**
 * 流内提问占位：待回答的问题本体渲染在底部 composer 槽位（阻塞式，
 * QuestionPanel.tsx），流内只留一行轻提示标记位置；答完收口为摘要行。
 */
function AskHint({ row }: { row: Extract<Row, { kind: 'confirm' | 'ask' }> }) {
  if (row.resolved) {
    return (
      <div className="my-2 rounded-lg border border-border bg-surface px-3 py-2 text-ui-sm text-foreground-subtlest">
        {row.question} → {row.answer}
      </div>
    );
  }
  return (
    <div className="my-2 flex items-center gap-1.5 px-1 text-ui-xs text-foreground-subtlest">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
      <span className="min-w-0 truncate">{row.question}</span>
      <span className="shrink-0">· 请在下方作答</span>
    </div>
  );
}

// ---------- 状态行 / 通知 ----------

function StatusLine({ row }: { row: Extract<Row, { kind: 'status' }> }) {
  return (
    <div className="my-1 flex items-center gap-2 px-1 text-ui-xs text-brand">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      {row.text}
    </div>
  );
}

function Notice({ row }: { row: Extract<Row, { kind: 'notice' }> }) {
  const cls = row.tone === 'error'
    ? 'text-destructive'
    : row.tone === 'stopped'
      ? 'text-foreground-subtle'
      : 'text-foreground-subtlest';
  return <div className={`my-1.5 px-1 text-ui-sm ${cls}`}>{row.text}</div>;
}

// ---------- 分发 ----------

export function RowView({ row, sid, liveThinking }: { row: Row; sid: string; liveThinking?: boolean }) {
  switch (row.kind) {
    case 'user':
      return (
        <div className="my-2 flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-card px-3.5 py-2 text-ui-base text-foreground whitespace-pre-wrap">
            {row.text}
          </div>
        </div>
      );
    case 'assistant_text':
      return <div className="my-1.5"><Markdown text={row.text} /></div>;
    case 'reasoning':
      return <Reasoning row={row} live={liveThinking} />;
    case 'tool':
      return row.name.startsWith('Agent_') ? <AgentCard row={row} /> : <ToolCard row={row} />;
    case 'permission':
      return <PermissionCard row={row} sid={sid} />;
    case 'confirm':
    case 'ask':
      return <AskHint row={row} />;
    case 'status':
      return <StatusLine row={row} />;
    case 'notice':
      return <Notice row={row} />;
    default:
      return null;
  }
}
