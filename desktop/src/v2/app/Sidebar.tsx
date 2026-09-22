// Sidebar — 会话侧栏（ZCode 导航结构）：新建/搜索导航行 + 项目分组列表 +
// 底部引擎状态卡；支持收起为窄轨（rail），Header 的开合钮控制。
import { useState } from 'react';
import { PlusIcon, Settings2Icon, SearchIcon } from 'lucide-react';
import { useApp } from './appState';
import { useConversation } from '../conversation/store';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';

function EngineDot({ status }: { status: string }) {
  const cls = status === 'running'
    ? 'bg-success'
    : status === 'starting'
      ? 'bg-warning animate-pulse'
      : 'bg-destructive';
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cls)} />;
}

/** 收起态：窄图标轨（logo 移入标题栏左端——顶带随侧栏开合联动）。 */
function Rail() {
  const { setCreateDialogOpen, engineStatus } = useApp();
  return (
    <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-sidebar py-2">
      <Button variant="ghost" size="icon-md" aria-label="新建项目（Ctrl+N）"
        className="text-foreground-subtle hover:bg-hover hover:text-foreground"
        onClick={() => setCreateDialogOpen(true)}>
        <PlusIcon />
      </Button>
      <div className="mt-auto pb-1">
        <EngineDot status={engineStatus.status} />
      </div>
    </aside>
  );
}

export function Sidebar() {
  const { projects, project, openProject, engineStatus, setCreateDialogOpen, setSettingsOpen, sidebarOpen, setSidebarOpen } = useApp();
  const sessions = useConversation((s) => s.sessions);
  const [filter, setFilter] = useState('');

  if (!sidebarOpen) return <Rail />;

  const shown = projects.filter((p) =>
    !filter.trim()
    || p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <aside className="flex w-66 shrink-0 flex-col border-r border-border bg-sidebar">
      {/* 顶部 logo 行（ZCode 式：点 logo 收起侧栏；高度对齐 Header h-12） */}
      <div className="flex h-12 shrink-0 items-center px-4">
        <button type="button" aria-label="收起侧栏" title="收起侧栏"
          className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-ui-sm font-bold text-primary-foreground transition-colors hover:bg-primary/80"
          onClick={() => setSidebarOpen(false)}>
          A
        </button>
      </div>
      {/* 导航行：主操作 + 搜索（ZCode 式：icon + 文案 + 快捷键标注右对齐） */}
      <nav className="px-2">
        <button type="button" onClick={() => setCreateDialogOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-ui-sm text-foreground hover:bg-hover"
          title="新建项目（Ctrl+N）">
          <PlusIcon className="size-4 shrink-0 text-foreground-subtle" />
          <span className="min-w-0 flex-1 truncate text-left">新建项目</span>
          <span className="shrink-0 text-ui-2xs text-foreground-subtlest">Ctrl+N</span>
        </button>
        <div className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-ui-sm">
          <SearchIcon className="size-4 shrink-0 text-foreground-subtle" />
          <input id="project-search" value={filter} onChange={(e) => setFilter(e.target.value)}
            placeholder="搜索项目"
            className="min-w-0 flex-1 bg-transparent text-ui-sm text-foreground outline-none placeholder:text-foreground-subtlest" />
          <span className="shrink-0 text-ui-2xs text-foreground-subtlest">Ctrl+K</span>
        </div>
      </nav>

      {/* 项目分组 */}
      <div className="mt-3 flex items-center gap-2 px-5 text-ui-2xs font-medium uppercase tracking-wider text-foreground-subtlest">
        项目
        <span className="text-ui-2xs normal-case tracking-normal">{projects.length}</span>
      </div>
      <nav className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {shown.map((p) => {
          const active = project?.dir === p.dir;
          const sid = 'amc-' + p.dir.split(/[\\/]/).filter(Boolean).pop();
          const running = !!(sid && sessions[sid]?.busy);
          return (
            <button key={p.dir} type="button" onClick={() => openProject(p)}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                active ? 'bg-selected' : 'hover:bg-hover',
              )}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color || 'var(--color-brand)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-sm font-medium text-foreground">{p.name}</span>
                {p.idea && <span className="block truncate text-ui-xs text-foreground-subtlest">{p.idea}</span>}
              </span>
              {running && <span className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brand" />}
            </button>
          );
        })}
        {shown.length === 0 && (
          <div className="px-2.5 py-6 text-center text-ui-xs text-foreground-subtlest">
            {filter ? '没有匹配的项目' : '还没有项目——点上方「新建项目」'}
          </div>
        )}
      </nav>

      {/* 底部：引擎状态卡 + 设置 */}
      <div className="m-2 mt-0 flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2">
        <EngineDot status={engineStatus.status} />
        <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtle">
          {engineStatus.model || engineStatus.status}
        </span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="设置"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => setSettingsOpen(true)}>
          <Settings2Icon />
        </Button>
      </div>
    </aside>
  );
}
