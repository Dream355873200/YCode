// appState — v2 应用级状态门面。
//
// 工作区数据（项目 / 对话 / 团队 / 选中项）在 workspace.ts（zustand）；这里
// 把它和界面状态（弹层、侧栏、右栏标签）合成 useApp()，供各组件消费：
//   - project：当前选中项所属项目；sid：当前对话 id（草稿与团队为 null）
//   - projectMode：当前智能体（对话自带；草稿取草稿设置 → 项目最近选用 → 默认）
//   - permission：当前权限（对话持久化；草稿取草稿设置 → 上次选择）
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { engine } from '../protocol';
import type { ModeDecl, ModesBody } from './modeRegistry';
import {
  draftOf, sameDir, startWorkspaceSync, threadsOf, useWorkspace,
  type Permission, type Project, type Selection, type Thread,
} from './workspace';
import type { Tab } from './settings/nav';

export type { Permission, Project, Selection, Thread } from './workspace';

const PERM_KEY = 'ycode.permission';
const PERMISSIONS: Permission[] = ['plan', 'default', 'accept_edits', 'bypass'];
const asPermission = (v: unknown): Permission | null =>
  (PERMISSIONS as unknown[]).includes(v) ? v as Permission : null;

const baseName = (dir: string): string => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;

interface AppCtxValue {
  projects: Project[];
  refreshProjects(): Promise<void>;
  /** 当前选中项所属项目（无选中时为 null）。 */
  project: Project | null;
  /** 当前对话（草稿 / 团队为 null）。 */
  thread: Thread | null;
  selection: Selection | null;
  /** 当前对话的引擎会话 id（草稿 / 团队为 null）。 */
  sid: string | null;
  /** 打开项目：选中其最近的对话，没有对话时进入新对话草稿。 */
  openProject(p: Project): void;
  /** 新对话草稿（dir 省略 = 当前项目）。 */
  newThread(dir?: string): void;
  /** 全部智能体（引擎 /modes；不可达时为空）。 */
  modes: ModeDecl[];
  refreshModes(): void;
  /** 默认智能体 id（config.engine.mode）。 */
  defaultMode: string;
  saveDefaultMode(mode: string): Promise<void>;
  /** 当前智能体 id。 */
  projectMode: string;
  /** 切换当前智能体（对话：改绑定，下一轮生效；草稿：改草稿设置）。 */
  setProjectMode(mode: string): Promise<void>;
  /** 当前权限。 */
  permission: Permission;
  setPermission(p: Permission): void;
  engineStatus: { status: string; addr: string; model: string; provider: string };
  createDialogOpen: boolean;
  setCreateDialogOpen(v: boolean): void;
  /** 新建团队对话框（目标项目目录；null = 关闭）。 */
  teamDialogDir: string | null;
  setTeamDialogDir(dir: string | null): void;
  settingsOpen: boolean;
  setSettingsOpen(v: boolean): void;
  /** 设置页打开时的初始路由（openSettings 指定；null = 常规）。 */
  settingsRoute: { tab: Tab; id?: string } | null;
  openSettings(tab?: Tab, id?: string): void;
  paletteOpen: boolean;
  setPaletteOpen(v: boolean): void;
  sidebarOpen: boolean;
  setSidebarOpen(v: boolean): void;
  sidePaneOpen: boolean;
  setSidePaneOpen(v: boolean): void;
  /** 侧栏文件树视图。 */
  fileTreeOpen: boolean;
  setFileTreeOpen(v: boolean): void;
  /** 右栏文件查看器：打开的文件（绝对路径，tab 顺序）与当前聚焦文件。 */
  viewerFiles: string[];
  viewerActive: string | null;
  /** 打开/聚焦文件：入 tab、聚焦、自动展开右栏。 */
  openViewerFile(path: string): void;
  closeViewerFile(path: string): void;
  setViewerActive(path: string): void;
  /** 查看器内容版本号（保存/外部刷新后 +1，FileViewer 据此重读）。 */
  viewerTick: number;
  bumpViewerTick(): void;
  /** 对话注入通道（「选网页元素加入对话」、变更面板「让智能体审查」等 → composer 草稿）。 */
  composerSeed: { text: string; tick: number };
  injectComposer(text: string): void;
  /** 右栏动态标签页（全部可 +/×，按项目分桶）。 */
  paneTabs: PaneTabState[];
  paneActive: string | null;
  openPaneTab(t: PaneTabState): void;
  closePaneTab(id: string): void;
  setPaneActive(id: string): void;
}

/** 右栏标签页状态：kind 决定渲染器。 */
export interface PaneTabState {
  // 'file:<path>' | 'browser:<instId>' | 'git' | 'mode:<panelId>' | 'pipeline'
  // | 'pnode:<runId>:<node>' | 'subtrace:<sid>:<toolUse>' | 'tmember:<team>:<member>' | 'plan:<toolUseId>'
  id: string;
  kind: 'file' | 'browser' | 'git' | 'mode' | 'pipeline' | 'pipelineNode' | 'subagentTrace' | 'teamMember' | 'planDoc';
  label: string;
}

type PaneBucket = { tabs: PaneTabState[]; active: string | null; files: string[]; fileActive: string | null };
const EMPTY_BUCKET: PaneBucket = { tabs: [], active: null, files: [], fileActive: null };

const Ctx = createContext<AppCtxValue | null>(null);
export const useApp = (): AppCtxValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const projects = useWorkspace((s) => s.projects);
  const threads = useWorkspace((s) => s.threads);
  const selection = useWorkspace((s) => s.selection);
  const drafts = useWorkspace((s) => s.drafts);
  const threadsLoaded = useWorkspace((s) => s.threadsLoaded);

  const [engineStatus, setEngineStatus] = useState({ status: 'unknown', addr: '', model: '', provider: '' });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [teamDialogDir, setTeamDialogDir] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpenRaw] = useState(false);
  const [settingsRoute, setSettingsRoute] = useState<{ tab: Tab; id?: string } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidePaneOpen, setSidePaneOpen] = useState(true);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [viewerTick, setViewerTick] = useState(0);
  const bumpViewerTick = useCallback(() => setViewerTick((t) => t + 1), []);
  const [composerSeed, setComposerSeed] = useState({ text: '', tick: 0 });
  const injectComposer = useCallback((text: string) => {
    if (!text) return;
    setComposerSeed((s) => ({ text, tick: s.tick + 1 }));
  }, []);

  const setSettingsOpen = useCallback((v: boolean) => {
    if (!v) setSettingsRoute(null);
    setSettingsOpenRaw(v);
  }, []);
  const openSettings = useCallback((tab?: Tab, id?: string) => {
    setSettingsRoute(tab ? { tab, id } : null);
    setSettingsOpenRaw(true);
  }, []);

  // ---------- 当前选中 → 项目 / 对话 ----------
  const thread = useMemo(
    () => (selection?.kind === 'thread' ? threads.find((t) => t.id === selection.id) ?? null : null),
    [selection, threads],
  );
  const selDir = selection?.dir ?? null;
  const project = useMemo<Project | null>(() => {
    if (!selDir) return null;
    return projects.find((p) => sameDir(p.dir, selDir)) ?? { name: baseName(selDir), dir: selDir };
  }, [projects, selDir]);
  const sid = selection?.kind === 'thread' ? selection.id : null;

  // 选中项失效（首启 / 项目被移除 / 对话被删）：回到第一个项目
  useEffect(() => {
    if (!projects.length) return;
    const ws = useWorkspace.getState();
    if (!selection || !projects.some((p) => sameDir(p.dir, selection.dir))) {
      ws.openProject(projects[0]!.dir);
      return;
    }
    if (selection.kind === 'thread' && threadsLoaded && !threads.some((t) => t.id === selection.id)) {
      ws.openProject(selection.dir);
    }
  }, [projects, selection, threads, threadsLoaded]);

  // ---------- 右栏标签页（按项目分桶：切项目各看各的标签） ----------
  const [paneByProject, setPaneByProject] = useState<Record<string, PaneBucket>>({});
  const dir = project?.dir;
  const curPane = (dir && paneByProject[dir]) || EMPTY_BUCKET;
  const mutatePane = useCallback((fn: (p: PaneBucket) => PaneBucket) => {
    if (!dir) return;
    setPaneByProject((m) => ({ ...m, [dir]: fn(m[dir] || EMPTY_BUCKET) }));
  }, [dir]);

  const openViewerFile = useCallback((path: string) => {
    if (!path) return;
    setSidePaneOpen(true);
    const name = path.split(/[\\/]/).pop() || path;
    mutatePane((p) => ({
      tabs: p.tabs.some((t) => t.id === `file:${path}`) ? p.tabs : [...p.tabs, { id: `file:${path}`, kind: 'file' as const, label: name }],
      active: `file:${path}`,
      files: p.files.includes(path) ? p.files : [...p.files, path],
      fileActive: path,
    }));
  }, [mutatePane]);
  const closeViewerFile = useCallback((path: string) => {
    mutatePane((p) => {
      const files = p.files.filter((f) => f !== path);
      return { ...p, files, fileActive: p.fileActive === path ? files[files.length - 1] ?? null : p.fileActive };
    });
  }, [mutatePane]);
  const setViewerActive = useCallback((path: string) => {
    mutatePane((p) => ({ ...p, fileActive: path }));
  }, [mutatePane]);
  const openPaneTab = useCallback((t: PaneTabState) => {
    setSidePaneOpen(true);
    mutatePane((p) => ({
      ...p,
      tabs: p.tabs.some((x) => x.id === t.id) ? p.tabs.map((x) => (x.id === t.id ? t : x)) : [...p.tabs, t],
      active: t.id,
    }));
  }, [mutatePane]);
  const closePaneTab = useCallback((id: string) => {
    mutatePane((p) => {
      const tabs = p.tabs.filter((t) => t.id !== id);
      return { ...p, tabs, active: p.active === id ? tabs[tabs.length - 1]?.id ?? null : p.active };
    });
  }, [mutatePane]);
  const setPaneActive = useCallback((id: string) => {
    mutatePane((p) => ({ ...p, active: id }));
  }, [mutatePane]);

  // ---------- 智能体目录 ----------
  const [modes, setModes] = useState<ModeDecl[]>([]);
  const [defaultMode, setDefaultMode] = useState('code');
  const [globalPermission, setGlobalPermission] = useState<Permission>('accept_edits');
  const [lastPermission, setLastPermission] = useState<Permission>(
    () => asPermission(localStorage.getItem(PERM_KEY)) ?? 'accept_edits',
  );

  useEffect(() => {
    startWorkspaceSync();
    window.amc.config.get().then((cfg) => {
      const c = cfg as { engine?: { model?: string; mode?: string }; providers?: { id: string; name: string }[]; activeProvider?: string; theme?: string; uiFontSize?: number };
      const providerName = c.providers?.find((p) => p.id === c.activeProvider)?.name || '';
      setEngineStatus((e) => ({ ...e, model: c.engine?.model || '', provider: providerName }));
      if (c.engine?.mode) setDefaultMode(c.engine.mode);
      // 主题跟随 config（index.html 已预置 .dark，避免 FOUC）
      if (c.theme) document.documentElement.classList.toggle('dark', c.theme === 'dark');
      // 界面字号基准（token 层只改 --ui-font-size，图标/间距不随动）
      if (c.uiFontSize) document.documentElement.style.setProperty('--ui-font-size', `${c.uiFontSize}px`);
    }).catch(() => {});
    engine.status().then((s) => setEngineStatus((e) => ({ ...e, ...s }))).catch(() => {});
    return engine.onStatus((s) => setEngineStatus((e) => ({ ...e, ...s })));
  }, []);

  // 引擎（重新）就绪：拉智能体目录、对账对话与团队、读全局权限
  const [modesTick, setModesTick] = useState(0);
  const refreshModes = useCallback(() => setModesTick((t) => t + 1), []);
  useEffect(() => {
    if (engineStatus.status !== 'running') return;
    let alive = true;
    engine.get('/modes').then((r) => {
      const body = r.body as Partial<ModesBody> | undefined;
      const list = (body?.modes ?? []).filter((m) => m && m.resolved);
      if (alive) setModes(list);
    }).catch(() => {});
    const ws = useWorkspace.getState();
    void ws.refreshThreads();
    void ws.refreshTeams();
    engine.get('/mode').then((r) => {
      const m = asPermission((r.body as { mode?: string } | undefined)?.mode);
      if (alive && m) setGlobalPermission(m);
    }).catch(() => {});
    return () => { alive = false; };
  }, [engineStatus.status, modesTick]);

  // ---------- 当前智能体 / 权限 ----------
  const draftSettings = selection?.kind === 'draft' ? draftOf(drafts, selection.dir) : undefined;
  const known = (id?: string): string | undefined => (id && (!modes.length || modes.some((m) => m.id === id)) ? id : undefined);
  const projectMode = (selection?.kind === 'thread'
    ? known(thread?.mode)
    : known(draftSettings?.mode)) ?? known(project?.mode) ?? defaultMode;
  const permission: Permission = selection?.kind === 'thread'
    ? asPermission(thread?.permission) ?? globalPermission
    : draftSettings?.permission ?? lastPermission;

  const setProjectMode = useCallback(async (mode: string) => {
    const ws = useWorkspace.getState();
    if (selection?.kind === 'thread') await ws.updateThread(selection.id, { mode });
    else if (selection) ws.setDraft(selection.dir, { mode });
  }, [selection]);

  const setPermission = useCallback((p: Permission) => {
    const ws = useWorkspace.getState();
    if (selection?.kind === 'thread') void ws.updateThread(selection.id, { permission: p });
    else if (selection) ws.setDraft(selection.dir, { permission: p });
    setLastPermission(p);
    try { localStorage.setItem(PERM_KEY, p); } catch { /* 忽略 */ }
  }, [selection]);

  const saveDefaultMode = useCallback(async (mode: string) => {
    const cfg = await window.amc.config.get() as { engine?: Record<string, unknown> } & Record<string, unknown>;
    await window.amc.config.save({ ...cfg, engine: { ...cfg.engine, mode } });
    setDefaultMode(mode);
  }, []);

  const openProject = useCallback((p: Project) => useWorkspace.getState().openProject(p.dir), []);
  const newThread = useCallback((d?: string) => {
    useWorkspace.getState().newThread(d);
    setFileTreeOpen(false);
  }, []);
  const refreshProjects = useCallback(() => useWorkspace.getState().refreshProjects(), []);

  return (
    <Ctx.Provider value={{
      projects, refreshProjects, project, thread, selection, sid, openProject, newThread,
      modes, refreshModes, defaultMode, saveDefaultMode, projectMode, setProjectMode,
      permission, setPermission,
      engineStatus, createDialogOpen, setCreateDialogOpen, teamDialogDir, setTeamDialogDir,
      settingsOpen, setSettingsOpen, settingsRoute, openSettings,
      paletteOpen, setPaletteOpen,
      sidebarOpen, setSidebarOpen,
      sidePaneOpen, setSidePaneOpen,
      fileTreeOpen, setFileTreeOpen,
      viewerFiles: curPane.files, viewerActive: curPane.fileActive,
      openViewerFile, closeViewerFile, setViewerActive,
      viewerTick, bumpViewerTick,
      composerSeed, injectComposer,
      paneTabs: curPane.tabs, paneActive: curPane.active, openPaneTab, closePaneTab, setPaneActive,
    }}>
      {children}
    </Ctx.Provider>
  );
}

/** 项目内可见对话（侧栏 / 命令面板共用）。 */
export { threadsOf };
