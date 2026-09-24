// RowView — row → 组件分发。展示层唯一职责：把权威 row 画出来。
// 工具卡片复用 legacy 渲染器注册表（toolRender.jsx，P0 平移资产）；
// 交互卡（审批/确认/提问）直接挂 store 回传。
import { useEffect, useRef, useState } from 'react';
import { Brain } from 'lucide-react';
import type { Row, ToolRow } from './projection/rows';
import { useConversation } from './store';
import { resolveRenderer, actObj, actVerbPlain, toolStats } from '../../lib/toolRender';
import { renderMD } from '../../lib/markdown';
import { Button } from '../components/ui/button';

// ---------- 正文 / 思考 ----------

function Markdown({ text }: { text: string }) {
  // renderMD 产出受控 HTML（legacy 同路径：先转义再高亮，无注入面）
  return <div className="v2-md" dangerouslySetInnerHTML={{ __html: renderMD(text) }} />;
}

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
      {open && (
        <div ref={boxRef}
          className={`scroll-fine mt-1 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-3 text-ui-sm text-foreground-subtle ${live ? 'h-28' : 'max-h-72'}`}>
          {row.text}
        </div>
      )}
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
          <span className={`inline-block w-3 text-foreground-subtlest transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        )}
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
      {expandable && open && (
        <div className="border-t border-border px-3 py-2">
          {R.Detail
            ? <R.Detail act={{ verb: row.name, input, obj, st: row.state === 'running' ? '…' : row.state === 'err' ? 'err' : 'ok', detail: row.result || '', toolUseId: row.toolUseId, expand: true }} />
            : <pre className="scroll-fine max-h-72 overflow-auto whitespace-pre-wrap text-ui-xs text-foreground-subtle">{row.result}</pre>}
        </div>
      )}
    </div>
  );
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
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
      {open && (
        <pre className="scroll-fine max-h-60 overflow-auto border-t border-border px-3 py-2 text-ui-xs text-foreground-subtle">
          {row.result}
        </pre>
      )}
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
        <span className={`inline-block w-3 text-foreground-subtlest transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        <span className="text-foreground-subtle">探索</span>
        <span className="min-w-0 truncate text-foreground-subtlest">
          读取了 {reads.length} 个文件{errCount ? ` · ${errCount} 个失败` : ''}
        </span>
        <span className={`ml-auto shrink-0 text-ui-xs ${stCls}`}>{stIcon}</span>
      </button>
      {open && reads.map((r) => <ReadItem key={r.id} row={r} />)}
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
      return <ToolCard row={row} />;
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
