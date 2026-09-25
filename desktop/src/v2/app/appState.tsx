// appState — v2 应用级状态：项目列表 / 当前项目与会话 / 引擎状态 / 模式目录。
// 会话 ID：每项目一个持久会话（规则见 sessionId.ts），
// 引擎按会话扎根项目目录，切项目只是切会话。
// 模式是项目级的：project.mode（缺省回落 config.engine.mode），写进会话
// 绑定后引擎按会话裁剪工具/提示词/规范/技能——切模式不重启引擎。
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { engine } from '../protocol';
import type { ModeDecl, ModesBody } from './modeRegistry';
import { projectSessionId } from './sessionId';

export interface Project {
  name: string;
  dir: string;
  mode?: string;
  idea?: string;
  kind?: string;
  color?: string;
  exists?: boolean;
  head?: string | null;
  commits?: number;
  dirty?: boolean;
}

export const sessionIdOf = (p: Project | null): string | null => projectSessionId(p?.dir);

interface AppCtxValue {
  projects: Project[];
  refreshProjects(): Promise<void>;
  project: Project | null;
  sid: string | null;
  openProject(p: Project): void;
  /** 全部模式（引擎 /modes；不可达时为空）。 */
  modes: ModeDecl[];
  /** 重拉模式目录（设置页保存用户资产并 reload 引擎后调用）。 */
  refreshModes(): void;
  /** 默认模式 id（config.engine.mode）。 */
  defaultMode: string;
  /** 改默认模式（写 config；只影响新建项目预选与未记录模式的旧项目）。 */
  saveDefaultMode(mode: string): Promise<void>;
  /** 当前项目的模式 id（无项目时为默认模式）。 */
  projectMode: string;
  /** 切换当前项目的模式（注册表 + 会话绑定，不重启引擎）。 */
  setProjectMode(mode: string): Promise<void>;
  engineStatus: { status: string; addr: string; model: string };
  createDialogOpen: boolean;
  setCreateDialogOpen(v: boolean): void;
  settingsOpen: boolean;
  setSettingsOpen(v: boolean): void;
  sidebarOpen: boolean;
  setSidebarOpen(v: boolean): void;
  sidePaneOpen: boolean;
  setSidePaneOpen(v: boolean): void;
  /** 会话左缘的文件树面板（ZCode 式：悬停左缘弹出开合钮）。 */
  fileTreeOpen: boolean;
  setFileTreeOpen(v: boolean): void;
  /** 右栏文件查看器：打开的文件（绝对路径，tab 顺序）与当前聚焦文件。 */
  viewerFiles: string[];
  viewerActive: string | null;
  /** 打开/聚焦文件：入 tab、聚焦、自动展开右栏并切到「文件」页。 */
  openViewerFile(path: string): void;
  closeViewerFile(path: string): void;
  setViewerActive(path: string): void;
  /** 查看器内容版本号（保存/外部刷新后 +1，FileViewer 据此重读）。 */
  viewerTick: number;
  bumpViewerTick(): void;
  /** 对话注入通道（ZCode 式「选网页元素加入对话」等外部内容 → composer 草稿）。 */
  composerSeed: { text: string; tick: number };
  injectComposer(text: string): void;
  /** 右栏动态标签页（ZCode 式：全部可 +/×，无固定 tab）。 */
  paneTabs: PaneTabState[];
  paneActive: string | null;
  openPaneTab(t: PaneTabState): void;
  closePaneTab(id: string): void;
  setPaneActive(id: string): void;
}

/** 右栏标签页状态：kind 决定渲染器（file/browser/git/tasks/plan/mode/team/pipeline）。 */
export interface PaneTabState {
  id: string;      // 'file:<path>' | 'browser:<instId>' | 'git' | 'tasks' | 'plan' | 'mode:<panelId>' | 'team' | 'pipeline'
  kind: 'file' | 'browser' | 'git' | 'tasks' | 'plan' | 'mode' | 'team' | 'pipeline';
  label: string;
}

const Ctx = createContext<AppCtxValue | null>(null);
export const useApp = (): AppCtxValue => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [sid, setSid] = useState<string | null>(null);
  const [engineStatus, setEngineStatus] = useState({ status: 'unknown', addr: '', model: '' });
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  // 右栏标签页与文件查看器：按项目分桶存储——切项目/会话各看各的标签
  //（浏览器实例是壳级全局资源，其 tab 跟随实例归属项目）
  const [paneByProject, setPaneByProject] = useState<Record<string, { tabs: PaneTabState[]; active: string | null; files: string[]; fileActive: string | null }>>({});
  const dir = project?.dir;
  const curPane = (dir && paneByProject[dir]) || { tabs: [] as PaneTabState[], active: null as string | null, files: [] as string[], fileActive: null as string | null };
  const paneTabs = curPane.tabs;
  const paneActive = curPane.active;
  const viewerFiles = curPane.files;
  const viewerActive = curPane.fileActive;
  const mutatePane = useCallback((fn: (p: { tabs: PaneTabState[]; active: string | null; files: string[]; fileActive: string | null }) => { tabs: PaneTabState[]; active: string | null; files: string[]; fileActive: string | null }) => {
    if (!dir) return;
    setPaneByProject((m) => {
      const cur = m[dir] || { tabs: [] as PaneTabState[], active: null as string | null, files: [] as string[], fileActive: null as string | null };
      return { ...m, [dir]: fn(cur) };
    });
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
      return {
        ...p,
        files,
        fileActive: p.fileActive === path ? files[files.length - 1] ?? null : p.fileActive,
      };
    });
  }, [mutatePane]);
  const setViewerActive = useCallback((path: string) => {
    mutatePane((p) => ({ ...p, fileActive: path }));
  }, [mutatePane]);

  // 右栏动态标签页
  const openPaneTab = useCallback((t: PaneTabState) => {
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
  const [modes, setModes] = useState<ModeDecl[]>([]);
  const [defaultMode, setDefaultMode] = useState('code');

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await window.amc.projects.list() as Project[]);
    } catch { /* IPC 不可用 */ }
  }, []);

  useEffect(() => {
    refreshProjects();
    window.amc.config.get().then((cfg) => {
      const c = cfg as { engine?: { model?: string; mode?: string }; theme?: string; uiFontSize?: number };
      const model = c.engine?.model || '';
      setEngineStatus((e) => ({ ...e, model }));
      if (c.engine?.mode) setDefaultMode(c.engine.mode);
      // 主题跟随 config（index.html 已预置 .dark，避免 FOUC）
      if (c.theme) document.documentElement.classList.toggle('dark', c.theme === 'dark');
      // 界面字号基准（token 层只改 --ui-font-size，图标/间距不随动）
      if (c.uiFontSize) document.documentElement.style.setProperty('--ui-font-size', `${c.uiFontSize}px`);
    }).catch(() => {});
    engine.status().then((s) => setEngineStatus((e) => ({ ...e, ...s }))).catch(() => {});
    const off = engine.onStatus((s) => setEngineStatus((e) => ({ ...e, ...s })));
    return off;
  }, [refreshProjects]);

  // 模式目录：引擎（重新）就绪时拉一次；设置页改了用户资产并 reload 后经 refreshModes 重拉
  const [modesTick, setModesTick] = useState(0);
  const refreshModes = useCallback(() => setModesTick((t) => t + 1), []);
  useEffect(() => {
    if (engineStatus.status !== 'running') return;
    let alive = true;
    engine.get('/modes').then((r) => {
      const body = r.body as Partial<ModesBody> | undefined;
      // 只认带聚合视图的新格式（旧版引擎实例返回的清单没有 resolved）
      const list = (body?.modes ?? []).filter((m) => m && m.resolved);
      if (alive) setModes(list);
    }).catch(() => {});
    return () => { alive = false; };
  }, [engineStatus.status, modesTick]);

  const projectMode = project?.mode || defaultMode;

  const openProject = useCallback((p: Project) => {
    setProject(p);
    const s = sessionIdOf(p);
    setSid(s);
    if (s && p.dir) engine.bindProject(s, p.dir, p.mode || defaultMode).catch(() => {});
  }, [defaultMode]);

  const setProjectMode = useCallback(async (mode: string) => {
    if (!project || mode === projectMode) return;
    const r = await window.amc.projects.setMode(project.dir, mode);
    if (!r.ok) return;
    const next = { ...project, mode };
    setProject(next);
    setProjects((list) => list.map((x) => (x.dir === next.dir ? { ...x, mode } : x)));
    const s = sessionIdOf(next);
    if (s) await engine.bindProject(s, next.dir, mode).catch(() => {});
  }, [project, projectMode]);

  const saveDefaultMode = useCallback(async (mode: string) => {
    const cfg = await window.amc.config.get() as { engine?: Record<string, unknown> } & Record<string, unknown>;
    await window.amc.config.save({ ...cfg, engine: { ...cfg.engine, mode } });
    setDefaultMode(mode);
  }, []);

  return (
    <Ctx.Provider value={{
      projects, refreshProjects, project, sid, openProject,
      modes, refreshModes, defaultMode, saveDefaultMode, projectMode, setProjectMode,
      engineStatus, createDialogOpen, setCreateDialogOpen,
      settingsOpen, setSettingsOpen,
      sidebarOpen, setSidebarOpen,
      sidePaneOpen, setSidePaneOpen,
      fileTreeOpen, setFileTreeOpen,
      viewerFiles, viewerActive, openViewerFile, closeViewerFile, setViewerActive,
      viewerTick, bumpViewerTick,
      composerSeed, injectComposer,
      paneTabs, paneActive, openPaneTab, closePaneTab, setPaneActive,
    }}>
      {children}
    </Ctx.Provider>
  );
}
