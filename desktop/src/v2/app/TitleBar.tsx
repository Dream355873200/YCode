// TitleBar — 融合式顶栏（无边框窗口）：不再是独立标题条，而是工作区 Header。
// 侧栏顶到窗口上沿与之同排，右端内联窗控（对齐 ZCode 布局：h-12、整条 drag、
// 窗控 no-drag）。左段：logo + 当前项目名 + 目录路径。
import { PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { useApp } from './appState';
import { WindowControls } from './WindowControls';
import { Button } from '../components/ui/button';

export function TitleBar() {
  const { project, sidebarOpen, setSidebarOpen, sidePaneOpen, setSidePaneOpen } = useApp();
  return (
    <header className="drag flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-background pr-1.5">
      {/* 左段：ZCode 式联动——侧栏收起时 logo 移入标题栏（点击展开）；展开时只留标题 */}
      <div className="flex min-w-0 items-center gap-2.5 px-4">
        {!sidebarOpen && (
          <button type="button" aria-label="展开侧栏" title="展开侧栏"
            className="no-drag flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-ui-sm font-bold text-primary-foreground transition-colors hover:bg-primary/80"
            onClick={() => setSidebarOpen(true)}>
            A
          </button>
        )}
        {project ? (
          <>
            <span className="truncate text-ui-sm font-medium text-foreground">{project.name}</span>
            <span className="hidden min-w-0 truncate text-ui-xs text-foreground-subtlest md:block">{project.dir}</span>
          </>
        ) : (
          <span className="text-ui-sm font-medium text-foreground-subtle">amobileCreater</span>
        )}
      </div>
      {/* 右端钮簇：整组 no-drag——头部是拖拽区，不豁免点击全被窗口拖拽吞掉 */}
      <div className="no-drag flex shrink-0 items-center gap-1">
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
