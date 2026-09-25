// TasksPanel — 右栏任务面板：引擎 /tasks（TaskCreate 卡片），完成进度 + 状态图标。
import { useCallback, useEffect, useState } from 'react';
import { Check as CheckIco, Circle as CircleIco, Loader2 as Loader2Ico } from 'lucide-react';
import { useApp } from '../app/appState';
import { engine } from '../protocol';
import { cn } from '../components/lib/utils';

interface TaskCard {
  id?: string;
  status?: string;
  subject?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export function TasksPanel() {
  const { sid } = useApp();
  const [tasks, setTasks] = useState<TaskCard[] | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!sid) return;
    try {
      const r = await engine.get(`/tasks?session_id=${encodeURIComponent(sid)}`);
      if (Array.isArray(r.body)) setTasks(r.body as TaskCard[]);
    } catch { /* 引擎不可达：下个周期再试 */ }
  }, [sid]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  if (!sid) {
    return <div className="p-6 text-center text-ui-xs text-foreground-subtlest">选择项目后查看任务</div>;
  }
  if (!tasks || tasks.length === 0) {
    return (
      <div className="p-6 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
        暂无任务卡<br />AI 拆解计划后任务会实时出现在这里
      </div>
    );
  }
  const done = tasks.filter((t) => t.status === 'completed').length;
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2 text-ui-2xs text-foreground-subtlest">
        <span>{done}/{tasks.length} 完成</span>
        <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-500/20">
          <span className="block h-full rounded-full bg-brand transition-all" style={{ width: `${(done / tasks.length) * 100}%` }} />
        </span>
      </div>
      <div className="grid gap-1">
        {tasks.map((t) => (
          <div key={t.id || t.subject} className="flex items-start gap-2 rounded-lg px-1.5 py-1">
            <span className={cn(
              'mt-0.5 shrink-0',
              t.status === 'completed' ? 'text-success'
                : t.status === 'in_progress' ? 'text-brand'
                  : 'text-foreground-subtlest',
            )}>
              {t.status === 'completed' ? <CheckIco className="size-3" />
                : t.status === 'in_progress' ? <Loader2Ico className="size-3 animate-spin" />
                  : <CircleIco className="size-2.5" />}
            </span>
            <span className={cn(
              'min-w-0 flex-1 text-ui-xs leading-relaxed',
              t.status === 'completed' ? 'text-foreground-subtlest line-through' : 'text-foreground-subtle',
            )}>
              {t.subject || t.id}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
