// SidePane — 右侧面板（tab 化功能面）：内置槽位（Git / 任务 / 计划）+
// 当前项目模式经插件声明的槽位（plugin.json sidePanels，见 modeRegistry）。
// 标题栏右端（PanelRightIcon）与面板头部的关闭钮均可收起；appState.sidePaneOpen 控制。
// 各面板独立拉数（引擎端点 /tasks /plan + 主进程 git IPC），15s 兜底轮询。
import { useEffect, useState, type ComponentType } from 'react';
import { ClipboardListIcon, GitBranchIcon, ListChecksIcon, XIcon } from 'lucide-react';
import { useApp } from '../app/appState';
import { useCurrentMode } from '../app/modeRegistry';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';
import { GitPanel } from './GitPanel';
import { TasksPanel } from './TasksPanel';
import { PlanPanel } from './PlanPanel';
import SpecPanel from './SpecPanel';
import TestReportPanel from './TestReportPanel';
import DevicePanel from './DevicePanel';

interface PaneTab { id: string; label: string; icon?: typeof GitBranchIcon }

const BUILTIN_TABS: PaneTab[] = [
  { id: 'git', label: 'Git', icon: GitBranchIcon },
  { id: 'tasks', label: '任务', icon: ListChecksIcon },
  { id: 'plan', label: '计划', icon: ClipboardListIcon },
];

// mode 面板组件注册表：plugin.json 只声明 id/label（纯数据，引擎/壳都不
// import 组件），id → 组件的绑定只存在于这份表——新增面板 = 写组件
// + 在此注册一行，插件声明即可点亮。
const MODE_PANELS: Record<string, ComponentType> = {
  spec: SpecPanel,
  'test-report': TestReportPanel,
  device: DevicePanel,
};

export function SidePane({ open }: { open: boolean }) {
  const { setSidePaneOpen } = useApp();
  const mode = useCurrentMode();
  // 内置 tab 前置，当前项目模式（插件聚合）声明的面板跟在后面
  //（注册表里没有组件的 id 跳过）
  const tabs: PaneTab[] = [
    ...BUILTIN_TABS,
    ...(mode?.resolved.sidePanels || [])
      .filter((p) => MODE_PANELS[p.id])
      .map((p) => ({ id: p.id, label: p.label })),
  ];
  // 用户选中的 tab 是「偏好」：切到没有该面板的模式时临时显示 Git，
  // 偏好不被覆盖——切回来自动回到原面板（如 code → flutter 回到「手机」）
  const [preferred, setTab] = useState<string>('git');
  const tab = tabs.some((t) => t.id === preferred) ? preferred : 'git';
  // 内容延后卸载：展开立即挂载（随宽度增长逐渐露出），收起等宽度动画
  // 走完再卸载（期间内容被裁切着退出，之后轮询停止）
  const [rendered, setRendered] = useState(open);
  useEffect(() => {
    if (open) { setRendered(true); return; }
    const t = setTimeout(() => setRendered(false), 220);
    return () => clearTimeout(t);
  }, [open]);

  const ModePanel = MODE_PANELS[tab];
  const BuiltinPanel = tab === 'git' ? GitPanel : tab === 'tasks' ? TasksPanel : tab === 'plan' ? PlanPanel : null;

  return (
    <aside className={cn(
      'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
      open ? 'w-84' : 'w-0',
    )}>
      {rendered && (
      <div className="flex h-full w-84 flex-col border-l border-border bg-panel">
      {/* 面板头：tab 切换 + 收起钮 */}
      <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/50 px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button"
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-ui-xs transition-colors',
                tab === t.id
                  ? 'bg-selected font-medium text-foreground'
                  : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
              )}
              onClick={() => setTab(t.id)}>
              {Icon && <Icon className="size-3.5" />}
              {t.label}
            </button>
          );
        })}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="收起右栏"
          className="ml-auto shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => setSidePaneOpen(false)}>
          <XIcon />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {BuiltinPanel && <BuiltinPanel />}
        {ModePanel && <ModePanel />}
      </div>
      </div>
      )}
    </aside>
  );
}
