// useStatusPanel — 状态面板的数据装配与界面状态。
//   - useStatusPanelModel：把对话的各路运行态（目标 / 任务 / 子代理 / 后台命令 /
//     流水线 / Git / 环境资源）合成 StatusPanelModel；主区据 hasContent 决定是否
//     给时间线让位。
//   - useStatusPanelUi：展开偏好（自动 / 始终展开 / 始终收起，按窗口记忆）与各
//     区块的折叠状态。
import { useMemo } from 'react';
import { create } from 'zustand';
import { useApp } from '../../app/appState';
import { useCurrentMode } from '../../app/modeRegistry';
import { useWorkspace } from '../../app/workspace';
import { useGitChanges } from '../../pane/gitChanges';
import { usePipelineSelector } from '../../pane/pipelineStore';
import { useSession } from '../store';
import { useEnvSnapshot } from './envSnapshot';
import { useSessionStatus } from './sessionStatus';
import { buildStatusPanelModel, type StatusPanelModel } from './statusPanelModel';

/** 展开偏好：null = 自动（宽容器展开、窄容器收起为胶囊）。 */
export type StatusPanelVariant = 'panel' | 'mini' | null;

export type StatusSectionId = 'goal' | 'todo' | 'collab' | 'terminal' | 'plan' | 'workspace';

const VARIANT_KEY = 'ycode.statusPanelVariant';
const DEFAULT_OPEN: Record<StatusSectionId, boolean> = {
  goal: true, todo: true, collab: true, terminal: false, plan: true, workspace: true,
};

interface StatusPanelUi {
  variant: StatusPanelVariant;
  setVariant(v: StatusPanelVariant): void;
  open: Record<StatusSectionId, boolean>;
  setOpen(id: StatusSectionId, open: boolean): void;
}

const loadVariant = (): StatusPanelVariant => {
  const v = localStorage.getItem(VARIANT_KEY);
  return v === 'panel' || v === 'mini' ? v : null;
};

export const useStatusPanelUi = create<StatusPanelUi>((set) => ({
  variant: loadVariant(),
  setVariant(variant) {
    try {
      if (variant) localStorage.setItem(VARIANT_KEY, variant);
      else localStorage.removeItem(VARIANT_KEY);
    } catch { /* 忽略 */ }
    set({ variant });
  },
  open: { ...DEFAULT_OPEN },
  setOpen(id, open) {
    set((s) => ({ open: { ...s.open, [id]: open } }));
  },
}));

/** 主区布局：none = 不出面板；auto/inline = 宽容器时面板与时间线并排（时间线左移让位）。 */
export function statusPanelLayout(hasContent: boolean, variant: StatusPanelVariant): 'none' | 'auto' | 'inline' {
  if (!hasContent || variant === 'mini') return 'none';
  return variant === 'panel' ? 'inline' : 'auto';
}

/** 状态面板宽容器断点：与对话列宽布局同一 1280px 分水岭（ZCode 同款），面板左移 168px 让位。 */
export const STATUS_PANEL_OFFSET_CLASS = '@min-[1280px]/conversation:-translate-x-42';

export function useStatusPanelModel(sid: string | null): StatusPanelModel | null {
  const { project, thread } = useApp();
  const mode = useCurrentMode();
  const session = useSession(sid || '');
  const status = useSessionStatus(sid);
  const git = useGitChanges(sid ? project?.dir : null);
  const env = useEnvSnapshot(mode, !!sid);
  const goal = useWorkspace((s) => (sid ? s.threads.find((t) => t.id === sid)?.goal ?? null : null));
  const pipeline = usePipelineSelector((s) => (s.sessionId === sid ? s : null));
  return useMemo(() => {
    if (!sid) return null;
    return buildStatusPanelModel({
      sid,
      goal: goal ?? thread?.goal ?? null,
      rows: session.rows,
      tasks: status.tasks,
      bgtasks: status.bgtasks,
      agents: status.agents,
      pipeline: pipeline ? {
        sessionId: pipeline.sessionId,
        goal: pipeline.goal,
        nodes: pipeline.nodes.map((n) => ({ name: n.name, status: n.status, dependsOn: n.dependsOn })),
        startedAt: pipeline.startedAt,
        finishedAt: pipeline.finishedAt,
      } : null,
      git: git ? { ok: git.ok, added: git.added, deleted: git.deleted, files: git.files.length, branch: git.branch, upstream: git.upstream, ahead: git.ahead, behind: git.behind } : null,
      env,
    });
  }, [sid, goal, thread?.goal, session.rows, status, pipeline, git, env]);
}
