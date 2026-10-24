// ReviewPanel — 右栏「变更」：工作区相对 HEAD 的逐文件改动审查。
// 文件行（文件名 · 目录 · +/−）点开就地展开统一 diff（一次一个文件，语法高亮）；
// 行内操作：在查看器打开、撤销该文件改动（二次确认）。底部：提交（可让模型起草
// 说明）与「让智能体审查」（把审查请求填进当前对话的输入框）。
import { useEffect, useState } from 'react';
import {
  ChevronRightIcon, ExternalLinkIcon, FileTextIcon, GitBranchIcon, GitCommitHorizontalIcon, Loader2Icon,
  RefreshCwIcon, ScanSearchIcon, Undo2Icon,
} from 'lucide-react';
import { useApp } from '../app/appState';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { cn } from '../components/lib/utils';
import { highlightCode } from '../../lib/markdown';
import { langOf } from '../../lib/codediff';
import type { GitFileStat } from '../protocol';
import { BranchSwitcher } from './git/BranchSwitcher';
import { CommitDialog } from './git/CommitDialog';
import { parseUnifiedDiff, splitPath, type ParsedDiff } from './git/diff';
import { refreshGit, useGitChanges } from './gitChanges';

const MAX_LINES = 1500;

function DiffBody({ dir, file }: { dir: string; file: GitFileStat }) {
  const [diff, setDiff] = useState<ParsedDiff | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setDiff(null);
    void window.amc.git.diff(dir, file.path, file.untracked).then((r) => {
      if (!alive) return;
      if (r.ok) setDiff(parseUnifiedDiff(r.diff ?? ''));
      else setError(r.error || '读取 diff 失败');
    });
    return () => { alive = false; };
  }, [dir, file.path, file.untracked, file.added, file.deleted]);
  if (error) return <div className="px-3 py-2 text-ui-xs text-destructive">{error}</div>;
  if (!diff) return <div className="flex items-center gap-2 px-3 py-2 text-ui-xs text-foreground-subtlest"><Loader2Icon className="size-3.5 animate-spin" />读取中…</div>;
  if (diff.binary) return <div className="px-3 py-2 text-ui-xs text-foreground-subtlest">二进制文件，不显示内容差异</div>;
  if (!diff.lines.length) return <div className="px-3 py-2 text-ui-xs text-foreground-subtlest">没有文本差异（可能只改了权限或换行符）</div>;
  const lang = langOf(file.path);
  const lines = diff.lines.slice(0, MAX_LINES);
  return (
    <div className="overflow-x-auto bg-background/40 py-1 font-mono text-ui-xs leading-5">
      {lines.map((l, i) => (l.type === 'hunk'
        ? <div key={i} className="my-0.5 bg-info/8 px-3 text-ui-2xs leading-5 text-info">{l.text || '…'}</div>
        : (
          <div key={i} className={cn('cl', l.type === 'add' && 'cl-add', l.type === 'del' && 'cl-del')}>
            <span className="cl-no">{l.type === 'add' ? '' : l.oldNo}</span>
            <span className="cl-no">{l.type === 'del' ? '' : l.newNo}</span>
            <span className="cl-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
            <code dangerouslySetInnerHTML={{ __html: highlightCode(l.text || ' ', lang) }} />
          </div>
        )))}
      {diff.lines.length > MAX_LINES && (
        <div className="px-3 py-1 text-ui-2xs text-foreground-subtlest">还有 {diff.lines.length - MAX_LINES} 行未显示，在查看器里打开完整文件</div>
      )}
    </div>
  );
}

function FileRow({ dir, file, open, onToggle }: { dir: string; file: GitFileStat; open: boolean; onToggle(): void }) {
  const { openViewerFile } = useApp();
  const [confirm, setConfirm] = useState(false);
  const { name, dir: folder } = splitPath(file.path);
  const abs = `${dir.replace(/[\\/]+$/, '')}/${file.path}`;
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}
        className={cn('group sticky top-0 z-[1] flex h-8 cursor-pointer items-center gap-2 bg-panel px-3 text-ui-sm hover:bg-hover', open && 'bg-hover')}>
        <ChevronRightIcon className={cn('size-3.5 shrink-0 text-foreground-subtlest transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 shrink truncate text-foreground" title={file.path}>{name}</span>
        {folder && <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtlest">{folder}</span>}
        {!folder && <span className="flex-1" />}
        {file.untracked && <span className="shrink-0 rounded bg-success/12 px-1 text-ui-2xs text-success">新</span>}
        <span className="shrink-0 font-mono text-ui-xs tabular-nums group-hover:hidden">
          {file.binary ? <span className="text-foreground-subtlest">二进制</span> : (
            <><span className="text-success">+{file.added}</span> <span className="text-destructive">-{file.deleted}</span></>
          )}
        </span>
        <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <button type="button" aria-label="在查看器中打开" title="打开文件" onClick={(e) => { e.stopPropagation(); openViewerFile(abs); }}
            className="rounded p-1 text-foreground-subtle hover:bg-hover hover:text-foreground">
            <ExternalLinkIcon className="size-3.5" />
          </button>
          <button type="button" aria-label="撤销改动" title="撤销这个文件的改动" onClick={(e) => { e.stopPropagation(); setConfirm(true); }}
            className="rounded p-1 text-foreground-subtle hover:bg-destructive/10 hover:text-destructive">
            <Undo2Icon className="size-3.5" />
          </button>
        </span>
      </div>
      {open && <DiffBody dir={dir} file={file} />}
      <ConfirmDialog open={confirm} onOpenChange={setConfirm}
        title={file.untracked ? `删除新文件 ${name}？` : `撤销 ${name} 的改动？`}
        description={file.untracked ? '这个文件还没有被 Git 跟踪，删除后无法恢复。' : '文件会恢复到最近一次提交时的内容，未提交的改动将丢失。'}
        confirmLabel={file.untracked ? '删除' : '撤销'}
        onConfirm={async () => {
          const r = await window.amc.git.restore(dir, file.path, file.untracked);
          if (!r.ok) throw new Error(r.error || '撤销失败');
          refreshGit(dir);
        }} />
    </div>
  );
}

export function ReviewPanel() {
  const { project, sid, injectComposer } = useApp();
  const dir = project?.dir ?? '';
  const changes = useGitChanges(dir || null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const [initing, setIniting] = useState(false);

  if (!project) return <div className="p-6 text-center text-ui-xs text-foreground-subtlest">选择项目后查看改动</div>;
  if (!changes) return <div className="flex items-center justify-center gap-2 p-6 text-ui-xs text-foreground-subtlest"><Loader2Icon className="size-3.5 animate-spin" />读取改动…</div>;
  if (!changes.ok) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <GitBranchIcon className="size-8 text-foreground-subtlest" />
        <div className="text-ui-sm text-foreground-subtle">{changes.notRepo ? '这个项目还不是 Git 仓库' : 'Git 不可用'}</div>
        {changes.notRepo ? (
          <Button size="sm" variant="outline" disabled={initing}
            onClick={async () => { setIniting(true); await window.amc.git.init(dir); setIniting(false); refreshGit(dir); }}>
            {initing ? <Loader2Icon className="animate-spin" /> : <GitBranchIcon />}初始化仓库
          </Button>
        ) : <div className="text-ui-xs text-foreground-subtlest">{changes.error}</div>}
      </div>
    );
  }
  const files = changes.files;
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <BranchSwitcher dir={dir} side="bottom">
          <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui-sm text-foreground hover:bg-hover">
            <GitBranchIcon className="size-3.5 shrink-0 text-foreground-subtle" />
            <span className="max-w-40 truncate">{changes.branch || '分支'}</span>
          </button>
        </BranchSwitcher>
        {files.length > 0 && (
          <span className="font-mono text-ui-xs tabular-nums">
            <span className="text-success">+{changes.added}</span> <span className="text-destructive">-{changes.deleted}</span>
          </span>
        )}
        <button type="button" aria-label="刷新" title="刷新" onClick={() => refreshGit(dir)}
          className="ml-auto rounded p-1 text-foreground-subtle hover:bg-hover hover:text-foreground">
          <RefreshCwIcon className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <FileTextIcon className="size-8 text-foreground-subtlest" />
            <div className="text-ui-sm text-foreground-subtle">工作区很干净</div>
            <div className="text-ui-xs text-foreground-subtlest">智能体改动文件后，逐文件的差异会出现在这里</div>
          </div>
        ) : files.map((f) => (
          <FileRow key={f.path} dir={dir} file={f} open={openFile === f.path}
            onToggle={() => setOpenFile(openFile === f.path ? null : f.path)} />
        ))}
      </div>
      {files.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border/50 p-2">
          <Button size="sm" variant="outline" disabled={!sid} title={sid ? '把审查请求填进当前对话的输入框' : '先打开一段对话'}
            onClick={() => injectComposer('审查当前未提交的改动：逐个文件指出 bug、边界条件与可读性问题，按严重程度排序，并给出修改建议。')}>
            <ScanSearchIcon />让智能体审查
          </Button>
          <Button size="sm" className="ml-auto" onClick={() => setCommitOpen(true)}>
            <GitCommitHorizontalIcon />提交 {files.length} 个文件
          </Button>
        </div>
      )}
      <CommitDialog dir={dir} open={commitOpen} onOpenChange={setCommitOpen} />
    </div>
  );
}
