// SidePane — 右侧面板（ZCode 式动态标签页流）：
//   初始 = 卡片引导「选择要在侧边面板中打开的标签」；此后全部是浏览器式
//   tab——「+」添加新标签（Git/任务/计划/浏览器/模式面板），「×」关闭；
//   文件（树里点开）与浏览器实例（agent 或用户开的）自动进 tab 流。
//   收起用标题栏右端的开合钮（本面板不再放收起钮）。左缘拖拽自由调宽。
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import {
  BoxesIcon, ClipboardListIcon, FileTextIcon, GitBranchIcon, GlobeIcon,
  ListChecksIcon, PlusIcon, UsersIcon, WorkflowIcon, XIcon,
} from 'lucide-react';
import { useApp, type PaneTabState } from '../app/appState';
import { useCurrentMode } from '../app/modeRegistry';
import { cn } from '../components/lib/utils';
import { GitPanel } from './GitPanel';
import { TasksPanel } from './TasksPanel';
import { PlanPanel } from './PlanPanel';
import SpecPanel from './SpecPanel';
import TestReportPanel from './TestReportPanel';
import DevicePanel from './DevicePanel';
import FileView, { fileBasename } from './FileViewer';
import BrowserTab from './BrowserTab';
import { useBrowserInsts } from './browserStore';
import { TeamPanel } from './TeamPanel';
import { PipelinePanel } from './PipelinePanel';

// mode 面板组件注册表：plugin.json 只声明 id/label（纯数据，引擎/壳都不
// import 组件），id → 组件的绑定只存在于这份表——新增面板 = 写组件
// + 在此注册一行，插件声明即可点亮。
const MODE_PANELS: Record<string, ComponentType> = {
  spec: SpecPanel,
  'test-report': TestReportPanel,
  device: DevicePanel,
};

const MIN_W = 320, MAX_W = 760, DEFAULT_W = 336;

type Card = { id: string; kind: PaneTabState['kind']; label: string; icon: typeof GitBranchIcon };
const CARD_ICONS: Partial<Record<PaneTabState['kind'], typeof GitBranchIcon>> = {
  git: GitBranchIcon, tasks: ListChecksIcon, plan: ClipboardListIcon,
  browser: GlobeIcon, file: FileTextIcon, team: UsersIcon, pipeline: WorkflowIcon,
};

export function SidePane({ open }: { open: boolean }) {
  const {
    paneTabs, paneActive, openPaneTab, closePaneTab, setPaneActive,
    viewerActive, closeViewerFile, setViewerActive,
  } = useApp();
  const insts = useBrowserInsts();
  const mode = useCurrentMode();

  // ---------- 浏览器实例 ↔ tab 流同步 ----------
  const knownRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const i of insts) {
      if (knownRef.current.has(i.id)) continue;
      knownRef.current.add(i.id);
      openPaneTab({ id: `browser:${i.id}`, kind: 'browser', label: i.title || i.url || i.id });
      if (i.active) setPaneActive(`browser:${i.id}`);
    }
  }, [insts, openPaneTab, setPaneActive]);
  // 实例被 agent 关闭：回收对应 tab
  useEffect(() => {
    for (const t of paneTabs) {
      if (t.kind === 'browser' && !insts.some((i) => i.id === t.id.slice(8))) closePaneTab(t.id);
    }
  }, [insts, paneTabs, closePaneTab]);

  // ---------- 拖拽调宽 ----------
  // 拖动期间直接改 DOM 宽度（零重渲染，消除卡顿主因），松手才提交 state。
  const [width, setWidth] = useState(DEFAULT_W);
  const dragRef = useRef<{ startX: number; startW: number; dragged?: number } | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || !asideRef.current) return;
      const w = Math.min(MAX_W, Math.max(MIN_W, d.startW - (e.clientX - d.startX)));
      asideRef.current.style.width = `${w}px`;
      d.dragged = w;
    };
    const up = () => {
      const d = dragRef.current;
      if (d?.dragged) setWidth(d.dragged);
      dragRef.current = null;
      document.body.style.cursor = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);
  const startDrag = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = 'col-resize';
  };

  // 内容延后卸载：展开立即挂载，收起等宽度动画走完再卸载
  const [rendered, setRendered] = useState(open);
  useEffect(() => {
    if (open) { setRendered(true); return; }
    const t = setTimeout(() => setRendered(false), 220);
    return () => clearTimeout(t);
  }, [open]);

  // ---------- 可添加的标签类型（「+」菜单与空态卡片共用） ----------
  const cards: Card[] = [
    { id: 'browser', kind: 'browser', label: '浏览器', icon: GlobeIcon },
    { id: 'git', kind: 'git', label: 'Git', icon: GitBranchIcon },
    { id: 'tasks', kind: 'tasks', label: '任务', icon: ListChecksIcon },
    { id: 'plan', kind: 'plan', label: '计划', icon: ClipboardListIcon },
    { id: 'team', kind: 'team', label: '团队', icon: UsersIcon },
    { id: 'pipeline', kind: 'pipeline', label: 'Pipeline', icon: WorkflowIcon },
    ...(mode?.resolved.sidePanels || [])
      .filter((p) => p.id !== 'browser' && MODE_PANELS[p.id])
      .map((p) => ({ id: `mode:${p.id}`, kind: 'mode' as const, label: p.label, icon: BoxesIcon })),
  ];

  const openCard = (c: Card) => {
    if (c.kind === 'browser') {
      // 浏览器：新建实例（tab 由实例同步 effect 自动加入并激活）
      (window as unknown as { amc?: { browser?: { open?: (u: string) => Promise<unknown> } } }).amc?.browser?.open?.('about:blank');
      return;
    }
    openPaneTab({ id: c.id, kind: c.kind, label: c.label });
  };

  const closeTab = (t: PaneTabState) => {
    if (t.kind === 'file') closeViewerFile(t.id.slice(5));
    else if (t.kind === 'browser') (window as unknown as { amc?: { browser?: { close?: (id: string) => void } } }).amc?.browser?.close?.(t.id.slice(8));
    closePaneTab(t.id);
  };

  const activeTab = paneTabs.find((t) => t.id === paneActive) || null;
  // 「+」菜单：portal 到 body（tab 条 overflow 裁剪会盖住内联弹层）
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleMenu = () => {
    if (menuPos) { setMenuPos(null); return; }
    const r = plusRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenuPos({ x: Math.max(8, r.left - 8), y: r.bottom + 6 });
  };
  useEffect(() => {
    if (!menuPos) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || plusRef.current?.contains(t)) return;
      setMenuPos(null);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuPos(null); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [menuPos]);
  const available = cards.filter((c) => c.kind === 'browser' || !paneTabs.some((t) => t.id === c.id));

  const fileOf = activeTab?.kind === 'file' ? activeTab.id.slice(5) : null;
  const instOf = activeTab?.kind === 'browser' ? insts.find((i) => i.id === activeTab.id.slice(8)) : null;
  const ModePanel = activeTab?.kind === 'mode' ? MODE_PANELS[activeTab.id.slice(5)] : null;
  const BuiltinPanel = activeTab?.kind === 'git' ? GitPanel
    : activeTab?.kind === 'tasks' ? TasksPanel
    : activeTab?.kind === 'plan' ? PlanPanel
    : activeTab?.kind === 'team' ? TeamPanel
    : activeTab?.kind === 'pipeline' ? PipelinePanel
    : null;

  // 非浏览器 tab 激活、或「+」菜单打开时隐藏浏览器视图（主进程 detach）——
  // 原生 WebContentsView 永远盖在 DOM 之上，不卸下会遮住菜单导致无法点击；
  // 关闭菜单后重新激活当前浏览器 tab，视图恢复原位。
  useEffect(() => {
    const amc = (window as unknown as { amc?: { browser?: { setRect?: (r: unknown) => void; activate?: (id: string) => void } } }).amc;
    if (!paneActive?.startsWith('browser:') || menuPos) {
      amc?.browser?.setRect?.(null);
    } else if (paneActive) {
      amc?.browser?.activate?.(paneActive.slice(8));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneActive, menuPos]);

  return (
    <aside
      ref={asideRef}
      className={cn('relative flex shrink-0 overflow-hidden transition-[width] duration-200 ease-out', open ? '' : 'w-0')}
      style={open ? { width } : undefined}
    >
      {/* 拖拽手柄（左缘 4px）：拖动调宽 */}
      {open && (
        <div role="separator" aria-orientation="vertical"
          className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-brand/40"
          onMouseDown={startDrag} />
      )}
      {rendered && (
        <div className="flex h-full min-w-0 flex-1 flex-col border-l border-border bg-panel">
          {/* 面板头：动态 tab 条 + 添加钮（无收起钮——收起走标题栏开合钮） */}
          <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/50 px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {paneTabs.map((t) => {
              const Icon = CARD_ICONS[t.kind];
              const active = paneActive === t.id;
              // 浏览器 tab 的 label 跟随实例标题/地址实时变化
              const label = t.kind === 'browser'
                ? insts.find((i) => i.id === t.id.slice(8))?.title || t.label
                : t.label;
              return (
                <div key={t.id} className={cn(
                  'group flex shrink-0 items-center gap-1 rounded-lg text-ui-xs transition-colors',
                  'pl-2 pr-1',
                  active ? 'bg-selected font-medium text-foreground' : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
                )}>
                  <button type="button" title={t.label}
                    className="flex items-center gap-1.5 py-1"
                    onClick={() => { setPaneActive(t.id); if (t.kind === 'file') setViewerActive(t.id.slice(5)); }}>
                    {Icon && <Icon className="size-3.5" />}
                    <span className="max-w-32 truncate">{label}</span>
                  </button>
                  <button type="button" aria-label={`关闭 ${label}`}
                    className="rounded p-0.5 opacity-0 hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => { e.stopPropagation(); closeTab(t); }}>
                    <XIcon className="size-3" />
                  </button>
                </div>
              );
            })}
            <button ref={plusRef} type="button" aria-label="添加标签" title="添加标签"
              className={cn('relative shrink-0 flex h-6 w-6 items-center justify-center rounded-md hover:bg-hover',
                menuPos ? 'text-foreground' : 'text-foreground-subtle hover:text-foreground')}
              onClick={toggleMenu}>
              <PlusIcon className="size-4" />
            </button>
          </div>

          {/* 「+」菜单：portal 到 body，避开 tab 条 overflow 裁剪 */}
          {menuPos && createPortal(
            <div ref={menuRef}
              className="fixed z-50 w-40 rounded-lg border border-border bg-popover p-1 shadow-md"
              style={{ left: menuPos.x, top: menuPos.y }}>
              {available.map((c) => (
                <button key={c.id} type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-ui-xs text-foreground hover:bg-hover"
                  onClick={() => { setMenuPos(null); openCard(c); }}>
                  <c.icon className="size-3.5 text-foreground-subtle" />
                  {c.label}
                </button>
              ))}
            </div>,
            document.body,
          )}

          {/* 内容区 */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {fileOf ? <FileView key={fileOf} file={fileOf} />
              : instOf ? <BrowserTab key={instOf.id} inst={instOf} />
              : BuiltinPanel ? <BuiltinPanel />
              : ModePanel ? <ModePanel />
              : <EmptyCards cards={cards} onPick={openCard} />}
          </div>
        </div>
      )}
    </aside>
  );
}

/** 空态：卡片引导「选择要在侧边面板中打开的标签」（ZCode 式）。 */
function EmptyCards({ cards, onPick }: { cards: Card[]; onPick: (c: Card) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <div className="text-center text-ui-sm font-medium text-foreground">选择要在侧边面板中打开的标签</div>
      <div className="grid w-full max-w-60 grid-cols-2 gap-2">
        {cards.map((c) => (
          <button key={c.id} type="button"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card px-2 py-3 text-ui-xs text-foreground-subtle transition-colors hover:border-brand/50 hover:bg-hover hover:text-foreground"
            onClick={() => onPick(c)}>
            <c.icon className="size-4" />
            {c.label}
          </button>
        ))}
      </div>
      <div className="text-center text-ui-2xs text-foreground-subtlest">
        文件树里点开的文件、Agent 打开的网页<br />也会作为标签出现在这里
      </div>
    </div>
  );
}
