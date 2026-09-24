// Sidebar — 会话侧栏（ZCode 导航结构）：新建/搜索导航行 + 项目分组列表 +
// 底部引擎状态卡；支持收起为窄轨（rail），Header 的开合钮控制。
// 开合动画：容器常驻挂载做宽度过渡，全量内容与 rail 双层交叉渐隐
// （隐藏层 visibility 延迟到过渡结束才生效，不挡焦点/点击）。
import { useState } from 'react';
import { ArrowLeftIcon, FolderTreeIcon, PlusIcon, Settings2Icon, SearchIcon } from 'lucide-react';
import { useApp, sessionIdOf } from './appState';
import { useConversation } from '../conversation/store';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';
import FileTree from '../pane/FileTree';

function EngineDot({ status }: { status: string }) {
  const cls = status === 'running'
    ? 'bg-success'
    : status === 'starting'
      ? 'bg-warning animate-pulse'
      : 'bg-destructive';
  return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cls)} />;
}

export function Sidebar() {
  const { projects, project, openProject, engineStatus, setCreateDialogOpen, setSettingsOpen, sidebarOpen, setSidebarOpen, fileTreeOpen, setFileTreeOpen } = useApp();
  const sessions = useConversation((s) => s.sessions);
  const [filter, setFilter] = useState('');

  const shown = projects.filter((p) =>
    !filter.trim()
    || p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  // 收起态快捷会话项：直接遍历项目列表（全量来自引擎，冷会话也显示），
  // 每项渲染成圆角方框（项目名首字母 + 运行中角标），点击只切会话不展开侧栏
  const railItems = projects.map((p) => {
    const sid = sessionIdOf(p);
    return { p, running: !!(sid && sessions[sid]?.busy) };
  });

  return (
    <aside className={cn(
      'relative shrink-0 overflow-hidden border-r border-border bg-sidebar transition-[width] duration-200 ease-out',
      sidebarOpen ? 'w-66' : 'w-12',
    )}>
      {/* 全量内容层（项目列表）：固定 w-66 防回流，随开合/文件树模式交叉渐隐 */}
      <div aria-hidden={!sidebarOpen || fileTreeOpen} className={cn(
        'absolute inset-y-0 left-0 flex w-66 flex-col transition-[opacity,visibility] duration-200',
        sidebarOpen && !fileTreeOpen ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0',
      )}>
      {/* 顶部 logo 行（ZCode 式：点 logo 收起侧栏；高度对齐 Header h-12） */}
      <div className="flex h-12 shrink-0 items-center px-4">
        <button type="button" aria-label="收起侧栏" title="收起侧栏"
          className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-ui-sm font-bold text-primary-foreground transition-colors hover:bg-primary/80"
          onClick={() => setSidebarOpen(false)}>
          Y
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
          const sid = sessionIdOf(p);
          const running = !!(sid && sessions[sid]?.busy);
          return (
            <div key={p.dir} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') openProject(p); }}
              onClick={() => openProject(p)}
              className={cn(
                'group mb-0.5 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                active ? 'bg-selected' : 'hover:bg-hover',
              )}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: p.color || 'var(--color-brand)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui-sm font-medium text-foreground">{p.name}</span>
                {p.idea && <span className="block truncate text-ui-xs text-foreground-subtlest">{p.idea}</span>}
              </span>
              {/* 文件树入口：卡片内右侧（悬停显示；当前项目且树开着时常显） */}
              <button type="button" title={`打开 ${p.name} 的文件树`} aria-label={`打开 ${p.name} 的文件树`}
                className={cn(
                  'shrink-0 rounded p-1 transition-opacity',
                  active && fileTreeOpen ? 'text-brand opacity-100' : 'text-foreground-subtle opacity-0 hover:text-foreground group-hover:opacity-100',
                )}
                onClick={(e) => { e.stopPropagation(); openProject(p); setFileTreeOpen(true); }}>
                <FolderTreeIcon className="size-3.5" />
              </button>
              {running && <span className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-brand" />}
            </div>
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
      </div>
      {/* 文件树层：会话侧栏动画切换成工作目录文件树；顶部「返回任务列表」卡片 */}
      <div aria-hidden={!sidebarOpen || !fileTreeOpen} className={cn(
        'absolute inset-y-0 left-0 flex w-66 flex-col transition-[opacity,visibility] duration-200',
        sidebarOpen && fileTreeOpen ? 'visible opacity-100' : 'invisible pointer-events-none opacity-0',
      )}>
        <div className="flex h-12 shrink-0 items-center px-4">
          <button type="button" aria-label="返回任务列表"
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-hover"
            onClick={() => setFileTreeOpen(false)}>
            <ArrowLeftIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground">
              {project ? `返回 ${project.name}` : '返回任务列表'}
            </span>
          </button>
        </div>
        {project
          ? <FileTree />
          : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-ui-xs text-foreground-subtlest">
              先选择一个项目，再查看它的文件
            </div>
          )}
        {/* 底部：引擎状态卡（与项目层一致） */}
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
      </div>
      {/* 窄轨层：与全量内容交叉渐隐 */}
      <div aria-hidden={sidebarOpen} className={cn(
        'absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-1 py-2 transition-[opacity,visibility] duration-200',
        sidebarOpen ? 'invisible pointer-events-none opacity-0' : 'visible opacity-100',
      )}>
        <Button variant="ghost" size="icon-md" aria-label="新建项目（Ctrl+N）"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => setCreateDialogOpen(true)}>
          <PlusIcon />
        </Button>
        {/* 会话快捷项：圆角方框，点击只切会话（侧栏保持收起） */}
        {railItems.length > 0 && (
          <div className="mt-1 flex min-h-0 flex-col items-center gap-1 overflow-y-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {railItems.map(({ p, running }) => (
              <button key={p.dir} type="button" title={p.name} aria-label={`切换到 ${p.name}`}
                onClick={() => openProject(p)}
                className={cn(
                  'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-ui-2xs font-medium transition-colors',
                  project?.dir === p.dir
                    ? 'border-brand bg-selected text-foreground'
                    : 'border-border bg-card text-foreground hover:bg-hover',
                )}>
                {p.name.trim().slice(0, 1).toUpperCase() || '·'}
                {running && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-brand" />}
              </button>
            ))}
          </div>
        )}
        <div className="mt-auto pb-1">
          <EngineDot status={engineStatus.status} />
        </div>
      </div>
    </aside>
  );
}
