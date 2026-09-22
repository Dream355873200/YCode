// appState — v2 应用级状态：项目列表 / 当前项目与会话 / 引擎状态。
// 会话 ID 规则沿用 legacy：每项目一个持久会话（amc-<目录名>），
// 引擎按会话扎根项目目录，切项目只是切会话。
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { engine } from '../protocol';

export interface Project {
  name: string;
  dir: string;
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

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await window.amc.projects.list() as Project[]);
    } catch { /* IPC 不可用 */ }
  }, []);

  useEffect(() => {
    refreshProjects();
    window.amc.config.get().then((cfg) => {
      const c = cfg as { engine?: { model?: string }; theme?: string; uiFontSize?: number };
      const model = c.engine?.model || '';
      setEngineStatus((e) => ({ ...e, model }));
      // 主题跟随 config（index.html 已预置 .dark，避免 FOUC）
      if (c.theme) document.documentElement.classList.toggle('dark', c.theme === 'dark');
      // 界面字号基准（token 层只改 --ui-font-size，图标/间距不随动）
      if (c.uiFontSize) document.documentElement.style.setProperty('--ui-font-size', `${c.uiFontSize}px`);
    }).catch(() => {});
    engine.status().then((s) => setEngineStatus((e) => ({ ...e, ...s }))).catch(() => {});
    const off = engine.onStatus((s) => setEngineStatus((e) => ({ ...e, ...s })));
    return off;
  }, [refreshProjects]);

  const openProject = useCallback((p: Project) => {
    setProject(p);
    const s = sessionIdOf(p);
    setSid(s);
    if (s && p.dir) {
      (window.amc.engine as unknown as { bindProject(s: string, d: string): Promise<unknown> })
        .bindProject(s, p.dir).catch(() => {});
    }
  }, []);

  return (
    <Ctx.Provider value={{
      projects, refreshProjects, project, sid, openProject,
      engineStatus, createDialogOpen, setCreateDialogOpen,
      settingsOpen, setSettingsOpen,
      sidebarOpen, setSidebarOpen,
      sidePaneOpen, setSidePaneOpen,
    }}>
      {children}
    </Ctx.Provider>
  );
}
