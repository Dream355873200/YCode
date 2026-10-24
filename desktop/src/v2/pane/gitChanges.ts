// gitChanges — 项目工作区改动（逐文件 +/−）与分支信息的共享轮询：顶栏、状态
// 面板「工作区」区块与右栏变更面板读同一份数据。可见时每 8s 一次；项目里有
// 对话结束运行时立即刷新。
import { useEffect } from 'react';
import { create } from 'zustand';
import type { GitFileStat } from '../protocol';
import { sameDir, useWorkspace } from '../app/workspace';

export interface GitChanges {
  ok: boolean;
  error?: string;
  files: GitFileStat[];
  added: number;
  deleted: number;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** 不是 Git 仓库（可在变更面板一键初始化）。 */
  notRepo: boolean;
}

interface GitStatusBody {
  ok: boolean; error?: string;
  branch?: string | null; upstream?: string | null; ahead?: number; behind?: number;
}

interface GitStore {
  byDir: Record<string, GitChanges>;
  refresh(dir: string): Promise<void>;
}

export const useGitStore = create<GitStore>((set) => ({
  byDir: {},
  async refresh(dir) {
    let next: GitChanges;
    try {
      const [num, st] = await Promise.all([
        window.amc.git.numstat(dir),
        window.amc.git.status(dir) as Promise<GitStatusBody>,
      ]);
      const notRepo = !st?.ok && /not a git repository|不是 git 仓库/i.test(String(st?.error || ''));
      next = num.ok
        ? {
          ok: true, files: num.files ?? [], added: num.added ?? 0, deleted: num.deleted ?? 0,
          branch: st?.branch ?? null, upstream: st?.upstream ?? null, ahead: st?.ahead ?? 0, behind: st?.behind ?? 0,
          notRepo: false,
        }
        : { ok: false, error: num.error, files: [], added: 0, deleted: 0, branch: null, upstream: null, ahead: 0, behind: 0, notRepo };
    } catch (e) {
      next = {
        ok: false, error: e instanceof Error ? e.message : String(e),
        files: [], added: 0, deleted: 0, branch: null, upstream: null, ahead: 0, behind: 0, notRepo: false,
      };
    }
    set((s) => ({ byDir: { ...s.byDir, [dir]: next } }));
  },
}));

/** 立即刷新（提交 / 撤销 / 切分支之后）。 */
export function refreshGit(dir: string): void {
  void useGitStore.getState().refresh(dir);
}

/** 订阅项目改动（挂载期间轮询）。 */
export function useGitChanges(dir?: string | null): GitChanges | undefined {
  const entry = useGitStore((s) => (dir ? s.byDir[dir] : undefined));
  const running = useWorkspace((s) => (dir ? s.threads.filter((t) => sameDir(t.dir, dir) && t.state === 'running').length : 0));
  useEffect(() => {
    if (!dir) return;
    const refresh = useGitStore.getState().refresh;
    void refresh(dir);
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(dir);
    }, 8000);
    return () => clearInterval(t);
  }, [dir, running]);
  return entry;
}
