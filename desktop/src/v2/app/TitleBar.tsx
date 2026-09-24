// TitleBar — 融合式顶栏（无边框窗口）：不再是独立标题条，而是工作区 Header。
// 侧栏顶到窗口上沿与之同排，右端内联窗控（对齐 ZCode 布局：h-12、整条 drag、
// 窗控 no-drag）。左段：logo + 当前项目名 + 模式切换 + 目录路径。
import { useCallback, useState } from 'react';
import { BoxesIcon, CheckIcon, ChevronDownIcon, PanelLeftIcon, PanelRightIcon } from 'lucide-react';
import { useApp } from './appState';
import { useCurrentMode, useModes } from './modeRegistry';
import { WindowControls } from './WindowControls';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';
import { useDismiss } from '../components/lib/useDismiss';

/** 项目模式切换：改会话绑定，引擎下一轮按新模式裁剪工具/提示词/技能（不重启）。 */
function ModeSwitcher() {
  const { projectMode, setProjectMode } = useApp();
  const modes = useModes();
  const current = useCurrentMode();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  if (!modes.length) return null;
  return (
    <div ref={ref} className="no-drag relative shrink-0">
      <button type="button" title="切换项目模式"
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
        onClick={() => setOpen(!open)}>
        <BoxesIcon className="size-3.5" />
        <span>{current?.name || projectMode}</span>
        <ChevronDownIcon className="size-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-border bg-popover p-1 shadow-lg">
          {modes.map((m) => (
            <button key={m.id} type="button"
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                m.id === projectMode ? 'bg-selected' : 'hover:bg-hover',
              )}
              onClick={() => { setOpen(false); setProjectMode(m.id).catch(() => {}); }}>
              <span className="min-w-0 flex-1">
                <span className="block text-ui-sm text-foreground">{m.name}</span>
                {m.description && <span className="block text-ui-xs text-foreground-subtlest">{m.description}</span>}
              </span>
              {m.id === projectMode && <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TitleBar() {
  const { project, sidebarOpen, setSidebarOpen, sidePaneOpen, setSidePaneOpen } = useApp();
  return (
    <header className="drag flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 bg-background pr-1.5">
      {/* 左段：ZCode 式联动——侧栏收起时 logo 移入标题栏（点击展开）；展开时只留标题 */}
      <div className="flex min-w-0 items-center gap-2.5 px-4">
        {!sidebarOpen && (
          <button type="button" aria-label="展开侧栏" title="展开侧栏"
            className="no-drag flex h-6 w-6 shrink-0 animate-in fade-in items-center justify-center rounded-md bg-primary text-ui-sm font-bold text-primary-foreground transition-colors hover:bg-primary/80"
            onClick={() => setSidebarOpen(true)}>
            A
          </button>
        )}
        {project ? (
          <>
            <span className="truncate text-ui-sm font-medium text-foreground">{project.name}</span>
            <ModeSwitcher />
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
