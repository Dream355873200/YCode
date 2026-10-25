// Sidebar — 工作区侧栏：新对话 / 搜索 + 项目分组（组内对话与团队）+ 底部
// 引擎状态与设置。对话行带状态（运行中 / 等你处理 / 未读），悬停出「…」
// 菜单（重命名 / 归档 / 删除）；项目行悬停出「在此项目新建对话」与项目菜单。
// 收起为窄轨（rail）；项目行内的文件树入口把侧栏切换为文件树视图。
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  ArchiveIcon, ArchiveRestoreIcon, ArrowLeftIcon, ChevronRightIcon, CopyIcon, EllipsisIcon, FolderOpenIcon,
  FolderPlusIcon, FolderTreeIcon, GoalIcon, Loader2Icon, MessageCircleQuestionIcon, PencilIcon, PlusIcon,
  SearchIcon, Settings2Icon, ShieldAlertIcon, SquarePenIcon, Trash2Icon, UserRoundPlusIcon, UsersIcon,
  XIcon,
} from 'lucide-react';
import { useApp } from './appState';
import { isUnread, sameDir, threadsOf, useWorkspace, type Project, type TeamSummary, type Thread } from './workspace';
import { normalizeDir } from './dirs';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '../components/ui/context-menu';
import { InlineRename } from '../components/ui/inline-rename';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '../components/lib/utils';
import { relTime } from '../lib/time';
import FileTree from '../pane/FileTree';

const COLLAPSE_KEY = 'ycode.collapsedProjects';
const PAGE = 6;

function EngineDot({ status }: { status: string }) {
  const cls = status === 'running'
    ? 'bg-success'
    : status === 'starting'
      ? 'bg-warning animate-pulse'
      : 'bg-destructive';
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cls)} />;
}

/** 对话状态槽：运行中 / 未读（等你处理用右侧胶囊表达）。 */
function ThreadStatus({ t, unread }: { t: Thread; unread: boolean }) {
  if (t.state === 'running') return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />;
  if (t.goal?.status === 'active') return <GoalIcon className="size-3.5 shrink-0 text-brand" />;
  if (unread) return <span className="mx-[4px] size-1.5 shrink-0 rounded-full bg-brand" />;
  return <span className="size-3.5 shrink-0" />;
}

/** 等你处理：提问 / 审批的胶囊（替换右侧时间）。 */
function PendingPill({ kind }: { kind: 'ask' | 'approval' }) {
  const Icon = kind === 'ask' ? MessageCircleQuestionIcon : ShieldAlertIcon;
  return (
    <span className="flex h-5 shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 text-ui-xs font-medium text-warning">
      <Icon className="size-3" />{kind === 'ask' ? '等你回答' : '等你批准'}
    </span>
  );
}

function ThreadRow({ t, active, unread }: { t: Thread; active: boolean; unread: boolean }) {
  const select = useWorkspace((s) => s.select);
  const updateThread = useWorkspace((s) => s.updateThread);
  const deleteThread = useWorkspace((s) => s.deleteThread);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const open = (): void => select({ kind: 'thread', id: t.id, dir: t.dir });
  // 「…」菜单与右键菜单共用一份动作
  const actions: Array<{ key: string; icon: ReactNode; label: string; run(): void; tone?: 'destructive'; sep?: boolean }> = [
    { key: 'rename', icon: <PencilIcon />, label: '重命名', run: () => setEditing(true) },
    {
      key: 'archive', icon: t.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />, label: t.archived ? '取消归档' : '归档',
      run: () => void updateThread(t.id, { archived: !t.archived }),
    },
    { key: 'reveal', icon: <FolderOpenIcon />, label: '打开项目文件夹', run: () => void window.amc.projects.reveal(t.dir), sep: true },
    { key: 'copy', icon: <CopyIcon />, label: '复制对话 ID', run: () => void navigator.clipboard.writeText(t.id) },
    { key: 'delete', icon: <Trash2Icon />, label: '删除', run: () => setConfirm(true), tone: 'destructive', sep: true },
  ];
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div role="button" tabIndex={0}
            onClick={open}
            onDoubleClick={() => setEditing(true)}
            onKeyDown={(e) => { if (e.key === 'Enter') open(); if (e.key === 'F2') setEditing(true); }}
            className={cn(
              'group/thread flex h-7.5 w-full cursor-pointer items-center gap-2 rounded-lg pl-7 pr-1.5 text-left transition-colors',
              active ? 'bg-selected' : 'hover:bg-hover',
              t.archived && 'opacity-60',
            )}>
            <ThreadStatus t={t} unread={unread} />
            {editing ? (
              <InlineRename value={t.title} onDone={(next) => {
                setEditing(false);
                if (next) void updateThread(t.id, { title: next });
              }} />
            ) : (
              <span className={cn('min-w-0 flex-1 truncate text-ui-base', active || unread ? 'text-foreground' : 'text-foreground-subtle')}
                title={t.title}>
                {t.title}
              </span>
            )}
            {!editing && (
              <>
                {t.pending
                  ? <span className={cn(menuOpen ? 'hidden' : 'group-hover/thread:hidden')}><PendingPill kind={t.pending} /></span>
                  : (
                    <span className={cn('shrink-0 text-ui-xs tabular-nums text-foreground-subtlest', menuOpen ? 'hidden' : 'group-hover/thread:hidden')}>
                      {t.state === 'running' ? '' : relTime(t.updatedAt)}
                    </span>
                  )}
                <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="对话操作" onClick={(e) => e.stopPropagation()}
                      className={cn('shrink-0 rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground',
                        menuOpen ? 'flex' : 'hidden group-hover/thread:flex')}>
                      <EllipsisIcon className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    {actions.map((a) => (
                      <Fragment key={a.key}>
                        {a.sep && <DropdownMenuSeparator />}
                        <DropdownMenuItem tone={a.tone} onSelect={a.run}>{a.icon}{a.label}</DropdownMenuItem>
                      </Fragment>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {actions.map((a) => (
            <Fragment key={a.key}>
              {a.sep && <ContextMenuSeparator />}
              <ContextMenuItem tone={a.tone} onSelect={a.run}>{a.icon}{a.label}</ContextMenuItem>
            </Fragment>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm}
        title={`删除对话「${t.title}」？`}
        description="对话历史、任务清单与子代理轨迹会一并删除，无法恢复。"
        confirmLabel="删除"
        onConfirm={async () => {
          if (!(await deleteThread(t.id))) throw new Error('删除失败：引擎不可达或对话仍在运行');
        }} />
    </>
  );
}

function TeamRow({ team, active }: { team: TeamSummary; active: boolean }) {
  const select = useWorkspace((s) => s.select);
  return (
    <div role="button" tabIndex={0}
      onClick={() => select({ kind: 'team', dir: team.dir, name: team.name })}
      onKeyDown={(e) => { if (e.key === 'Enter') select({ kind: 'team', dir: team.dir, name: team.name }); }}
      className={cn(
        'group/thread flex h-7.5 w-full cursor-pointer items-center gap-2 rounded-lg pl-7 pr-1.5 text-left transition-colors',
        active ? 'bg-selected' : 'hover:bg-hover',
      )}
      title={team.goal}>
      {team.running > 0
        ? <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />
        : <UsersIcon className="size-3.5 shrink-0 text-foreground-subtle" />}
      <span className={cn('min-w-0 flex-1 truncate text-ui-base', active ? 'text-foreground' : 'text-foreground-subtle')}>
        {team.name}
      </span>
      <span className="shrink-0 text-ui-xs tabular-nums text-foreground-subtlest">
        {team.running > 0 ? `${team.running}/${team.members}` : `${team.members} 人`}
      </span>
    </div>
  );
}

function ProjectGroup({ p, expanded, onToggle }: { p: Project; expanded: boolean; onToggle(): void }) {
  const { project, selection, newThread, setFileTreeOpen, fileTreeOpen, setTeamDialogDir, refreshProjects } = useApp();
  const threads = useWorkspace((s) => s.threads);
  const teams = useWorkspace((s) => s.teams[normalizeDir(p.dir)]);
  const seen = useWorkspace((s) => s.seen);
  const openProject = useWorkspace((s) => s.openProject);
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const all = useMemo(() => threadsOf(threads, p.dir), [threads, p.dir]);
  const live = all.filter((t) => !t.archived);
  const archived = all.filter((t) => t.archived);
  const shown = showAll ? live : live.slice(0, PAGE);
  const activeId = selection?.kind === 'thread' ? selection.id : null;
  const isActive = sameDir(project?.dir, p.dir);
  const running = all.filter((t) => t.state === 'running').length + (teams ?? []).reduce((n, t) => n + (t.running > 0 ? 1 : 0), 0);
  const attention = all.some((t) => !!t.pending);

  return (
    <div className="mb-1">
      <div role="button" tabIndex={0}
        onClick={() => { if (!expanded) onToggle(); openProject(p.dir); }}
        onKeyDown={(e) => { if (e.key === 'Enter') openProject(p.dir); }}
        className={cn(
          'group/project flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-lg px-1.5 text-left transition-colors hover:bg-hover',
          isActive && selection?.kind === 'draft' && 'bg-selected',
        )}>
        <button type="button" aria-label={expanded ? '收起' : '展开'}
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-foreground-subtlest hover:text-foreground">
          <ChevronRightIcon className={cn('size-3.5 transition-transform duration-150', expanded && 'rotate-90')} />
        </button>
        {renaming ? (
          <InlineRename value={p.name} onDone={(next) => {
            setRenaming(false);
            if (next) void window.amc.projects.rename(p.dir, next).then(() => refreshProjects());
          }} />
        ) : (
          <span className="min-w-0 flex-1 truncate text-ui-base font-medium text-foreground" title={p.dir}>{p.name}</span>
        )}
        {!expanded && running > 0 && <Loader2Icon className="size-3 shrink-0 animate-spin text-brand" />}
        {!expanded && attention && <span className="size-1.5 shrink-0 rounded-full bg-warning" />}
        {/* 悬停操作：新对话 / 文件树 / 项目菜单 */}
        <span className={cn('shrink-0 items-center gap-0.5', menuOpen ? 'flex' : 'hidden group-hover/project:flex')}>
          <button type="button" title="在此项目新建对话" aria-label="在此项目新建对话"
            className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); newThread(p.dir); }}>
            <SquarePenIcon className="size-3.5" />
          </button>
          <button type="button" title="文件" aria-label={`打开 ${p.name} 的文件树`}
            className={cn('rounded p-0.5 hover:bg-hover', isActive && fileTreeOpen ? 'text-brand' : 'text-foreground-subtle hover:text-foreground')}
            onClick={(e) => { e.stopPropagation(); openProject(p.dir); setFileTreeOpen(true); }}>
            <FolderTreeIcon className="size-3.5" />
          </button>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="项目操作" onClick={(e) => e.stopPropagation()}
                className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground">
                <EllipsisIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => newThread(p.dir)}><SquarePenIcon />新对话</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTeamDialogDir(p.dir)}><UserRoundPlusIcon />新建团队</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void window.amc.projects.reveal(p.dir)}><FolderOpenIcon />在文件管理器中打开</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRenaming(true)}><PencilIcon />重命名项目</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="destructive" onSelect={() => setConfirmRemove(true)}><XIcon />从列表移除</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>

      {expanded && (
        <div className="mt-0.5 grid gap-px">
          {shown.map((t) => (
            <ThreadRow key={t.id} t={t} active={t.id === activeId} unread={isUnread(t, seen, activeId)} />
          ))}
          {live.length > PAGE && (
            <button type="button" onClick={() => setShowAll(!showAll)}
              className="h-6.5 rounded-lg pl-12.5 text-left text-ui-sm text-foreground-subtlest hover:bg-hover hover:text-foreground-subtle">
              {showAll ? '收起' : `显示全部 ${live.length} 个对话`}
            </button>
          )}
          {(teams ?? []).map((team) => (
            <TeamRow key={team.name} team={team}
              active={selection?.kind === 'team' && selection.name === team.name && sameDir(selection.dir, p.dir)} />
          ))}
          {archived.length > 0 && (
            <>
              <button type="button" onClick={() => setShowArchived(!showArchived)}
                className="flex h-6.5 items-center gap-1.5 rounded-lg pl-7 text-left text-ui-sm text-foreground-subtlest hover:bg-hover hover:text-foreground-subtle">
                <ArchiveIcon className="size-3" />
                {showArchived ? '隐藏已归档' : `已归档 ${archived.length}`}
              </button>
              {showArchived && archived.map((t) => (
                <ThreadRow key={t.id} t={t} active={t.id === activeId} unread={false} />
              ))}
            </>
          )}
        </div>
      )}

      <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove}
        title={`从列表移除「${p.name}」？`}
        description="只是不在 YCode 里显示，项目文件夹与对话历史都保留；之后可重新添加。"
        confirmLabel="移除"
        onConfirm={async () => { await window.amc.projects.remove(p.dir); await refreshProjects(); }} />
    </div>
  );
}

function SidebarFooter() {
  const { engineStatus, openSettings } = useApp();
  return (
    <div className="m-2 mt-0 flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2">
      <EngineDot status={engineStatus.status} />
      <span className="min-w-0 flex-1 truncate text-ui-base text-foreground-subtle"
        title={engineStatus.status === 'running' ? '引擎运行中' : `引擎：${engineStatus.status}`}>
        {engineStatus.model || engineStatus.status}
      </span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="设置"
        className="text-foreground-subtle hover:bg-hover hover:text-foreground"
        onClick={() => openSettings()}>
        <Settings2Icon />
      </Button>
    </div>
  );
}

export function Sidebar() {
  const {
    projects, project, newThread, setCreateDialogOpen, setPaletteOpen,
    sidebarOpen, setSidebarOpen, fileTreeOpen, setFileTreeOpen, engineStatus,
  } = useApp();
  const threads = useWorkspace((s) => s.threads);
  const openProject = useWorkspace((s) => s.openProject);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; }
  });
  const toggle = (dir: string): void => {
    setCollapsed((c) => {
      const next = { ...c, [normalizeDir(dir)]: !c[normalizeDir(dir)] };
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* 忽略 */ }
      return next;
    });
  };

  return (
    <aside className={cn(
      'relative shrink-0 overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 ease-out',
      sidebarOpen ? 'w-68' : 'w-12',
    )}>
      {/* 工作区层（项目 → 对话 / 团队） */}
      <div aria-hidden={!sidebarOpen || fileTreeOpen} className={cn(
        'absolute inset-y-0 left-0 flex w-68 flex-col transition-[opacity,visibility] duration-200',
        sidebarOpen && !fileTreeOpen ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0',
      )}>
        <div className="drag flex h-12 shrink-0 items-center px-4">
          <button type="button" aria-label="收起侧栏" title="收起侧栏"
            className="no-drag flex h-6 w-6 items-center justify-center rounded-md bg-primary text-ui-base font-bold text-primary-foreground transition-colors hover:bg-primary/80"
            onClick={() => setSidebarOpen(false)}>
            Y
          </button>
        </div>
        <nav className="grid gap-px px-2">
          <button type="button" onClick={() => newThread()} disabled={!projects.length}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-ui-base text-foreground hover:bg-hover disabled:opacity-50"
            title="新对话（Ctrl+N）">
            <SquarePenIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate text-left">新对话</span>
            <span className="shrink-0 text-ui-xs text-foreground-subtlest">Ctrl+N</span>
          </button>
          <button type="button" onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-ui-base text-foreground-subtle hover:bg-hover hover:text-foreground"
            title="搜索对话与命令（Ctrl+K）">
            <SearchIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate text-left">搜索</span>
            <span className="shrink-0 text-ui-xs text-foreground-subtlest">Ctrl+K</span>
          </button>
        </nav>

        <div className="mt-3 flex h-6 items-center gap-2 pl-4 pr-2 text-ui-xs font-medium tracking-wider text-foreground-subtlest">
          <span className="flex-1">项目</span>
          <button type="button" title="添加项目" aria-label="添加项目"
            className="rounded p-1 text-foreground-subtle hover:bg-hover hover:text-foreground"
            onClick={() => setCreateDialogOpen(true)}>
            <FolderPlusIcon className="size-3.5" />
          </button>
        </div>
        {/* overflow-x-hidden：单轴 auto 会把另一轴的 visible 抬成 auto，
            悬停显现按钮/行重排的瞬时超宽会顶出横向拖动条 */}
        <nav className="mt-0.5 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
          {projects.map((p) => (
            <ProjectGroup key={p.dir} p={p}
              expanded={!collapsed[normalizeDir(p.dir)]}
              onToggle={() => toggle(p.dir)} />
          ))}
          {projects.length === 0 && (
            <button type="button" onClick={() => setCreateDialogOpen(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-ui-base text-foreground-subtle hover:border-border-hover hover:text-foreground">
              <PlusIcon className="size-4" />添加第一个项目
            </button>
          )}
        </nav>
        <SidebarFooter />
      </div>

      {/* 文件树层：侧栏切换成当前项目的文件树；顶部返回卡片 */}
      <div aria-hidden={!sidebarOpen || !fileTreeOpen} className={cn(
        'absolute inset-y-0 left-0 flex w-68 flex-col transition-[opacity,visibility] duration-200',
        sidebarOpen && fileTreeOpen ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0',
      )}>
        <div className="flex h-12 shrink-0 items-center px-3">
          <button type="button" aria-label="返回对话列表"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:bg-hover"
            onClick={() => setFileTreeOpen(false)}>
            <ArrowLeftIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate text-ui-base text-foreground">
              {project ? project.name : '返回对话列表'}
            </span>
          </button>
        </div>
        {project
          ? <FileTree />
          : <div className="flex flex-1 items-center justify-center px-6 text-center text-ui-sm text-foreground-subtlest">先选择一个项目</div>}
        <SidebarFooter />
      </div>

      {/* 窄轨层 */}
      <div aria-hidden={sidebarOpen} className={cn(
        'absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-1 py-2 transition-[opacity,visibility] duration-200',
        sidebarOpen ? 'invisible pointer-events-none opacity-0' : 'visible opacity-100',
      )}>
        <Button variant="ghost" size="icon-md" aria-label="新对话（Ctrl+N）" title="新对话（Ctrl+N）"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => newThread()}>
          <SquarePenIcon />
        </Button>
        <Button variant="ghost" size="icon-md" aria-label="搜索（Ctrl+K）" title="搜索（Ctrl+K）"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => setPaletteOpen(true)}>
          <SearchIcon />
        </Button>
        <div className="mt-1 flex min-h-0 flex-col items-center gap-1 overflow-y-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {projects.map((p) => {
            const running = threads.some((t) => sameDir(t.dir, p.dir) && t.state === 'running');
            return (
              <button key={p.dir} type="button" title={p.name} aria-label={`切换到 ${p.name}`}
                onClick={() => openProject(p.dir)}
                className={cn(
                  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-ui-xs font-medium transition-colors',
                  sameDir(project?.dir, p.dir)
                    ? 'border-brand bg-selected text-foreground'
                    : 'border-border bg-card text-foreground hover:bg-hover',
                )}>
                {p.name.trim().slice(0, 1).toUpperCase() || 'P'}
                {running && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-brand" />}
              </button>
            );
          })}
        </div>
        <div className="mt-auto pb-1">
          <EngineDot status={engineStatus.status} />
        </div>
      </div>
    </aside>
  );
}
