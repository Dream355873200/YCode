// SidePane — 右侧面板（ZCode 式动态标签页流）：
//   初始 = 卡片引导「选择要在侧边面板中打开的标签」；此后全部是浏览器式
//   tab——「+」添加新标签（Git/浏览器/模式面板），「×」关闭；
//   文件（树里点开）与浏览器实例（agent 或用户开的）自动进 tab 流。
//   任务与计划不在这里：状态胶囊已覆盖（任务清单/计划文档都在面板里按需展开）。
//   收起用标题栏右端的开合钮（本面板不再放收起钮）。左缘拖拽自由调宽。
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import {
  BoxesIcon, FileDiffIcon, FileTextIcon, GlobeIcon, PlusIcon, UserIcon,
  WorkflowIcon, XIcon,
} from 'lucide-react';
import { useApp, type PaneTabState } from '../app/appState';
import { useCurrentMode } from '../app/modeRegistry';
import { cn } from '../components/lib/utils';
import { ReviewPanel } from './ReviewPanel';
import SpecPanel from './SpecPanel';
import TestReportPanel from './TestReportPanel';
import DevicePanel from './DevicePanel';
import VideoPreviewPanel from './VideoPreviewPanel';
import FileView from './FileViewer';
import BrowserTab from './BrowserTab';
import { useBrowserInsts } from './browserStore';
import { PipelinePanel } from './PipelinePanel';
import { NodeTracePane, parseNodeTraceTabId } from './NodeTracePane';
import { SubAgentTracePane, parseSubAgentTraceTabId } from './SubAgentTracePane';
import { PlanDocPane, parsePlanDocTabId } from './PlanDocPane';
import { TeamMemberPane } from '../team/TeamMemberPane';
import { parseMemberTabId } from '../team/teamApi';

// 插件面板组件注册表：plugin.json 只声明 id/label（纯数据，引擎/壳都不
// import 组件），id → 组件的绑定只存在于这份表——新增面板 = 写组件
// + 在此注册一行，插件声明即可点亮。
const MODE_PANELS: Record<string, { component: ComponentType; desc: string }> = {
  spec: { component: SpecPanel, desc: '产品规格：范围与验收标准' },
  'test-report': { component: TestReportPanel, desc: '真机测试的步骤、截图与结论' },
  device: { component: DevicePanel, desc: '真机投屏与设备状态' },
  video: { component: VideoPreviewPanel, desc: 'AI 渲染的视频产物，自动刷新' },
};

const MIN_W = 320, MAX_W = 760, DEFAULT_W = 336;

type Card = { id: string; kind: PaneTabState['kind']; label: string; desc: string; icon: typeof FileDiffIcon };
const KIND_ICONS: Partial<Record<PaneTabState['kind'], typeof FileDiffIcon>> = {
  git: FileDiffIcon, browser: GlobeIcon, file: FileTextIcon, pipeline: WorkflowIcon, teamMember: UserIcon, mode: BoxesIcon,
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

  // ---------- 可添加的标签类型（「+」菜单与空态启动器共用） ----------
  // 任务/计划/流水线不设独立入口：胶囊与状态面板已按需承载（计划文档走
  // planDoc tab、流水线走 capsule 行），启动器只留常驻面板。
  const cards: Card[] = [
    { id: 'git', kind: 'git', label: '变更', desc: '逐文件审查改动，撤销或提交', icon: FileDiffIcon },
    { id: 'browser', kind: 'browser', label: '浏览器', desc: '内置浏览器，智能体也能操作它', icon: GlobeIcon },
    ...(mode?.resolved.sidePanels || [])
      .filter((p) => p.id !== 'browser' && MODE_PANELS[p.id])
      .map((p) => ({ id: `mode:${p.id}`, kind: 'mode' as const, label: p.label, desc: MODE_PANELS[p.id]!.desc, icon: BoxesIcon })),
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
  const ModePanel = activeTab?.kind === 'mode' ? MODE_PANELS[activeTab.id.slice(5)]?.component ?? null : null;
  const nodeTrace = activeTab?.kind === 'pipelineNode' ? parseNodeTraceTabId(activeTab.id) : null;
  const subTrace = activeTab?.kind === 'subagentTrace' ? parseSubAgentTraceTabId(activeTab.id) : null;
  const planDoc = activeTab?.kind === 'planDoc' ? parsePlanDocTabId(activeTab.id) : null;
  const member = activeTab?.kind === 'teamMember' ? parseMemberTabId(activeTab.id) : null;
  const BuiltinPanel = activeTab?.kind === 'git' ? ReviewPanel
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
          {/* 面板头：动态 tab 条 + 添加钮（没有标签页时不占位——空态只有启动器） */}
          {paneTabs.length > 0 && (
            <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/50 px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {paneTabs.map((t) => {
              const Icon = KIND_ICONS[t.kind];
              const active = paneActive === t.id;
              // 浏览器 tab 的 label 跟随实例标题/地址实时变化
              const label = t.kind === 'browser'
                ? insts.find((i) => i.id === t.id.slice(8))?.title || t.label
                : t.label;
              return (
                <div key={t.id} className={cn(
                  'group flex shrink-0 items-center gap-1 rounded-lg text-ui-sm transition-colors',
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
                    className={cn('rounded p-0.5 hover:text-destructive', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
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
          )}

          {/* 「+」菜单：portal 到 body，避开 tab 条 overflow 裁剪 */}
          {menuPos && createPortal(
            <div ref={menuRef}
              className="fixed z-50 w-44 rounded-xl border border-border bg-popover p-1 shadow-md"
              style={{ left: menuPos.x, top: menuPos.y }}>
              {available.map((c) => (
                <button key={c.id} type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-ui-base text-foreground hover:bg-hover"
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
              : nodeTrace ? <NodeTracePane key={activeTab!.id} runId={nodeTrace.runId} node={nodeTrace.node} />
              : subTrace ? <SubAgentTracePane key={activeTab!.id} sessionID={subTrace.sessionID} toolUseID={subTrace.toolUseID} />
              : planDoc ? <PlanDocPane key={activeTab!.id} toolUseId={planDoc} />
              : member ? <TeamMemberPane key={activeTab!.id} team={member.team} member={member.member} />
              : BuiltinPanel ? <BuiltinPanel />
              : ModePanel ? <ModePanel />
              : <Launcher cards={cards} onPick={openCard} />}
          </div>
        </div>
      )}
    </aside>
  );
}

/** 空态启动器：每类标签一行（图标块 · 名称 · 一句话用途）。 */
function Launcher({ cards, onPick }: { cards: Card[]; onPick: (c: Card) => void }) {
  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="px-1 pb-2 text-ui-sm font-medium text-foreground-subtle">打开一个面板</div>
      <div className="grid gap-1">
        {cards.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c)}
            className="group flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-hover">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-foreground-subtle group-hover:text-brand">
              <c.icon className="size-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-ui-base text-foreground">{c.label}</span>
              <span className="block truncate text-ui-sm text-foreground-subtlest">{c.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
