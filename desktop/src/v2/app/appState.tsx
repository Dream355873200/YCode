// appState — v2 应用级状态：项目列表 / 当前项目与会话 / 引擎状态 / 模式目录。
// 会话 ID 规则沿用 legacy：每项目一个持久会话（amc-<目录名>），
// 引擎按会话扎根项目目录，切项目只是切会话。
// 模式是项目级的：project.mode（缺省回落 config.engine.mode），写进会话
// 绑定后引擎按会话裁剪工具/提示词/规范/技能——切模式不重启引擎。
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { engine } from '../protocol';
import type { ModeDecl, ModesBody } from './modeRegistry';

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

export const sessionIdOf = (p: Project | null): string | null =>
  p && p.dir ? 'amc-' + p.dir.split(/[\\/]/).filter(Boolean).pop()! : null;

interface AppCtxValue {
  projects: Project[];
  refreshProjects(): Promise<void>;
  project: Project | null;
  sid: string | null;
  openProject(p: Project): void;
  /** 全部模式（引擎 /modes；不可达时为空）。 */
  modes: ModeDecl[];
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
  const [modes, setModes] = useState<ModeDecl[]>([]);
  const [defaultMode, setDefaultMode] = useState('flutter');

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

  // 模式目录：引擎（重新）就绪时拉一次——清单在引擎启动时加载、运行期不变
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
  }, [engineStatus.status]);

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
      modes, defaultMode, saveDefaultMode, projectMode, setProjectMode,
      engineStatus, createDialogOpen, setCreateDialogOpen,
      settingsOpen, setSettingsOpen,
      sidebarOpen, setSidebarOpen,
      sidePaneOpen, setSidePaneOpen,
    }}>
      {children}
    </Ctx.Provider>
  );
}
