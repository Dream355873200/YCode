// FileTree — 会话左缘的文件树面板（ZCode 式）：当前项目目录的树 + git 状态
// 标记 + 名称过滤；点击文件经 openViewerFile 在右栏多形态查看（代码/图片/
// Markdown）。数据来自主进程 projects:filetree（磁盘遍历 + git status 标记，
// 已跳过 .git/node_modules/build 等内容目录）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, FileArchiveIcon, FileCodeIcon, FileIcon, FileSpreadsheetIcon, FileTextIcon, FolderIcon, FolderOpenIcon, ImageIcon, PresentationIcon, RefreshCwIcon, XIcon } from 'lucide-react';
import { useApp } from '../app/appState';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';

interface Node { type: 'dir' | 'file'; name: string; path: string; children?: Node[]; st?: string | null }

// git 状态标记配色（M 改 / A 增 / D 删 / ? 未跟踪）
const ST_COLOR: Record<string, string> = {
  M: 'text-warning', A: 'text-success', D: 'text-destructive', '??': 'text-brand', R: 'text-brand',
};

function flatten(nodes: Node[], out: Node[] = []): Node[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n);
    if (n.children) flatten(n.children, out);
  }
  return out;
}

function matchFilter(n: Node, q: string): Node | null {
  if (!q) return n;
  const hit = n.path.toLowerCase().includes(q);
  if (n.type === 'file') return hit ? n : null;
  const kids = (n.children || []).map((c) => matchFilter(c, q)).filter(Boolean) as Node[];
  return (hit || kids.length) ? { ...n, children: kids } : null;
}

export default function FileTree({ onClose }: { onClose?: () => void }) {
  const { project, openViewerFile } = useApp();
  const [tree, setTree] = useState<Node[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!project?.dir) return;
    setLoading(true);
    try {
      const nodes = await window.amc.projects.filetree(project.dir) as Node[];
      setTree(nodes);
      // 默认展开第一层目录
      setExpanded(new Set(nodes.filter((n) => n.type === 'dir').map((n) => n.path)));
    } catch { setTree([]); }
    setLoading(false);
  }, [project?.dir]);

  useEffect(() => { load(); }, [load]);
  // 面板打开期间 20s 轻轮询（AI 在改文件时树保持新鲜）
  useEffect(() => {
    const t = setInterval(() => { load(); }, 20_000);
    return () => clearInterval(t);
  }, [load]);

  const q = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!tree) return null;
    if (!q) return tree;
    return tree.map((n) => matchFilter(n, q)).filter(Boolean) as Node[];
  }, [tree, q]);

// 扩展名 → 文件类型图标与颜色（VSCode/ZCode 式直观辨识）
const EXT_STYLE: Array<[RegExp, typeof FileCodeIcon, string]> = [
  [/\.(tsx|jsx)$/, FileCodeIcon, 'text-sky-400'],
  [/\.(ts|js|mjs|cjs)$/, FileCodeIcon, 'text-amber-400'],
  [/\.(json|ya?ml|toml)$/, FileCodeIcon, 'text-yellow-500'],
  [/\.(css|scss|less)$/, FileCodeIcon, 'text-blue-400'],
  [/\.(md|mdx)$/, FileTextIcon, 'text-slate-300'],
  [/\.(png|jpe?g|gif|webp|svg|ico)$/, ImageIcon, 'text-emerald-400'],
  [/\.(pdf)$/, FileTextIcon, 'text-red-400'],
  [/\.(docx?|odt)$/, FileTextIcon, 'text-blue-500'],
  [/\.(xlsx?|xlsm|csv|ods)$/, FileSpreadsheetIcon, 'text-green-500'],
  [/\.(pptx?|odp)$/, PresentationIcon, 'text-orange-400'],
  [/\.(zip|tar|gz|7z|rar)$/, FileArchiveIcon, 'text-amber-600'],
  [/\.(go|py|java|kt|rs|c|cpp|h|sh|bat|ps1|lua|dart)$/, FileCodeIcon, 'text-violet-400'],
];
function fileIconOf(name: string) {
  for (const [re, Icon, cls] of EXT_STYLE) if (re.test(name.toLowerCase())) return { Icon, cls };
  return { Icon: FileIcon, cls: 'text-foreground-subtlest' };
}

  const renderNode = (n: Node, depth: number) => {
    if (n.type === 'dir') {
      const open = expanded.has(n.path) || !!q;
      return (
        <div key={n.path}>
          <button type="button"
            className="flex w-full items-center gap-1 rounded-md py-1 pr-1.5 text-left hover:bg-hover"
            style={{ paddingLeft: depth * 12 + 4 }}
            onClick={() => setExpanded((s) => {
              const next = new Set(s);
              if (next.has(n.path)) next.delete(n.path); else next.add(n.path);
              return next;
            })}>
            {open ? <ChevronDownIcon className="size-3.5 shrink-0 text-foreground-subtle" />
              : <ChevronRightIcon className="size-3.5 shrink-0 text-foreground-subtle" />}
            {open ? <FolderOpenIcon className="size-3.5 shrink-0 text-brand" />
              : <FolderIcon className="size-3.5 shrink-0 text-brand" />}
            <span className="min-w-0 flex-1 truncate text-foreground">{n.name}</span>
          </button>
          {open && (
            <div className="ml-3 border-l border-border/40 pl-1">
              {(n.children || []).map((c) => renderNode(c, depth + 1))}
            </div>
          )}
        </div>
      );
    }
    const st = n.st ? ST_COLOR[n.st] ?? ST_COLOR[n.st.trim()] ?? 'text-warning' : null;
    const { Icon: FIcon, cls: fcls } = fileIconOf(n.name);
    return (
      <button key={n.path} type="button" title={n.path}
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left hover:bg-hover"
        style={{ paddingLeft: depth * 12 + 22 }}
        onClick={() => openViewerFile(project?.dir ? `${project.dir}/${n.path}`.replace(/\\/g, '/') : n.path)}>
        <FIcon className={cn('size-3.5 shrink-0', fcls)} />
        <span className={cn('min-w-0 flex-1 truncate group-hover:text-foreground',
          n.st ? 'font-medium ' + (st ?? '') : 'text-foreground-subtle')}>{n.name}</span>
        {n.st && <span className={cn('shrink-0 text-ui-2xs font-semibold', st)}>{n.st === '??' ? 'U' : n.st}</span>}
      </button>
    );
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-sidebar">
      {/* 头：标题 + 刷新 + 收起 */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <FolderIcon className="size-3.5 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate text-ui-xs font-medium text-foreground">{project?.name || '文件'}</span>
        <Button variant="ghost" size="icon-sm" aria-label="刷新"
          className={cn('shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground', loading && 'animate-spin')}
          onClick={() => load()}>
          <RefreshCwIcon />
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label="收起文件树"
            className="shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground"
            onClick={onClose}>
            <XIcon />
          </Button>
        )}
      </div>
      {/* 过滤 */}
      <div className="shrink-0 px-2 py-1.5">
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="按路径过滤…"
          className="h-6 w-full rounded-md border border-border/60 bg-input px-2 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest focus:border-ring" />
      </div>
      {/* 树 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {!project ? (
          <div className="px-2 py-6 text-center text-ui-xs text-foreground-subtlest">先选择一个项目</div>
        ) : !shown ? (
          <div className="px-2 py-6 text-center text-ui-xs text-foreground-subtlest">加载中…</div>
        ) : shown.length === 0 ? (
          <div className="px-2 py-6 text-center text-ui-xs text-foreground-subtlest">{q ? '没有匹配的文件' : '空目录'}</div>
        ) : shown.map((n) => renderNode(n, 0))}
      </div>
      <div className="shrink-0 border-t border-border/50 px-3 py-1.5 text-ui-2xs text-foreground-subtlest">
        点击文件在右栏查看 · M 改 A 增 D 删 U 新
      </div>
    </div>
  );
}
