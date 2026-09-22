// SidePane — 右侧面板（ZCode 式 tab 化功能面）：Git / 任务 / 计划。
// 标题栏右端（PanelRightIcon）与面板头部的关闭钮均可收起；appState.sidePaneOpen 控制。
// 各面板独立拉数（引擎端点 /tasks /plan + 主进程 git IPC），15s 兜底轮询。
import { useState } from 'react';
import { ClipboardListIcon, GitBranchIcon, ListChecksIcon, XIcon } from 'lucide-react';
import { useApp } from '../app/appState';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';
import { GitPanel } from './GitPanel';
import { TasksPanel } from './TasksPanel';
import { PlanPanel } from './PlanPanel';

type PaneTab = 'git' | 'tasks' | 'plan';

const TABS: Array<{ id: PaneTab; label: string; icon: typeof GitBranchIcon }> = [
  { id: 'git', label: 'Git', icon: GitBranchIcon },
  { id: 'tasks', label: '任务', icon: ListChecksIcon },
  { id: 'plan', label: '计划', icon: ClipboardListIcon },
];

export function SidePane() {
  const { setSidePaneOpen } = useApp();
  const [tab, setTab] = useState<PaneTab>('git');

  return (
    <aside className="flex w-84 shrink-0 flex-col border-l border-border bg-panel">
      {/* 面板头：tab 切换 + 收起钮 */}
      <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border/50 px-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button"
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-2 py-1 text-ui-xs transition-colors',
                tab === t.id
                  ? 'bg-selected font-medium text-foreground'
                  : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
              )}
              onClick={() => setTab(t.id)}>
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="收起右栏"
          className="ml-auto text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => setSidePaneOpen(false)}>
          <XIcon />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'git' && <GitPanel />}
        {tab === 'tasks' && <TasksPanel />}
        {tab === 'plan' && <PlanPanel />}
      </div>
    </aside>
  );
}
