// TitleBar — 融合式顶栏（无边框窗口）：工作区 Header，右端内联窗控。
// 左段：项目 / 对话标题（点击改名）；右段：变更徽标（+/−，点开右栏变更面板）
// + 侧栏 / 右栏开合 + 窗控。整条可拖拽，交互元素 no-drag。
import { useState } from 'react';
import { ChevronRightIcon, FileDiffIcon, Loader2Icon, PanelLeftIcon, PanelRightIcon, UsersIcon } from 'lucide-react';
import { useApp } from './appState';
import { useWorkspace } from './workspace';
import { WindowControls } from './WindowControls';
import { Button } from '../components/ui/button';
import { InlineRename } from '../components/ui/inline-rename';
import { cn } from '../components/lib/utils';
import { useGitChanges } from '../pane/gitChanges';

function ChangesBadge() {
  const { project, openPaneTab } = useApp();
  const changes = useGitChanges(project?.dir);
  if (!changes?.ok || changes.files.length === 0) return null;
  return (
    <button type="button" title={`${changes.files.length} 个文件有改动，点击审查`}
      className="flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-ui-sm tabular-nums transition-colors hover:border-border-hover hover:bg-hover"
      onClick={() => openPaneTab({ id: 'git', kind: 'git', label: '变更' })}>
      <FileDiffIcon className="size-3.5 text-foreground-subtle" />
      <span className="text-success">+{changes.added}</span>
      <span className="text-destructive">-{changes.deleted}</span>
    </button>
  );
}

export function TitleBar() {
  const { project, thread, selection, sidebarOpen, setSidebarOpen, sidePaneOpen, setSidePaneOpen } = useApp();
  const updateThread = useWorkspace((s) => s.updateThread);
  const [renaming, setRenaming] = useState(false);
  const title = selection?.kind === 'thread' ? thread?.title ?? ''
    : selection?.kind === 'team' ? selection.name
      : selection?.kind === 'draft' ? '新对话' : '';
  return (
    <header className="drag flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-background pr-1.5">
      <div className="flex min-w-0 items-center gap-1.5 px-4">
        {!sidebarOpen && (
          <button type="button" aria-label="展开侧栏" title="展开侧栏"
            className="no-drag mr-1 flex h-6 w-6 shrink-0 animate-in fade-in items-center justify-center rounded-md bg-primary text-ui-base font-bold text-primary-foreground transition-colors hover:bg-primary/80"
            onClick={() => setSidebarOpen(true)}>
            Y
          </button>
        )}
        {project ? (
          <>
            <span className="max-w-48 shrink-0 truncate text-ui-base text-foreground-subtle" title={project.dir}>{project.name}</span>
            <ChevronRightIcon className="size-3.5 shrink-0 text-foreground-subtlest" />
            {selection?.kind === 'team' && <UsersIcon className="size-3.5 shrink-0 text-foreground-subtle" />}
            {renaming && thread ? (
              <InlineRename value={thread.title} className="max-w-96" onDone={(next) => {
                setRenaming(false);
                if (next) void updateThread(thread.id, { title: next });
              }} />
            ) : (
              <button type="button" disabled={!thread}
                title={thread ? '点击重命名' : undefined}
                className={cn('no-drag min-w-0 truncate rounded-md px-1 py-0.5 text-ui-base font-medium text-foreground',
                  thread && 'hover:bg-hover')}
                onClick={() => setRenaming(true)}>
                {title}
              </button>
            )}
            {thread?.state === 'running' && <Loader2Icon className="size-3.5 shrink-0 animate-spin text-brand" />}
          </>
        ) : (
          <span className="text-ui-base font-medium text-foreground-subtle">YCode</span>
        )}
      </div>
      <div className="no-drag flex shrink-0 items-center gap-1">
        <ChangesBadge />
        <Button type="button" variant="ghost" size="icon-md" aria-label="收起 / 展开侧栏"
          className={sidebarOpen ? 'text-foreground-subtle hover:bg-hover hover:text-foreground' : 'text-foreground hover:bg-hover'}
          onClick={() => setSidebarOpen(!sidebarOpen)}>
          <PanelLeftIcon />
        </Button>
        <Button type="button" variant="ghost" size="icon-md" aria-label="收起 / 展开右栏"
          className={sidePaneOpen ? 'text-foreground-subtle hover:bg-hover hover:text-foreground' : 'text-foreground hover:bg-hover'}
          onClick={() => setSidePaneOpen(!sidePaneOpen)}>
          <PanelRightIcon />
        </Button>
        <WindowControls />
      </div>
    </header>
  );
}
