// PlanPanel — 右栏计划面板：引擎 /plan（规划模式产出的计划文档）。
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../app/appState';
import { engine } from '../protocol';

interface PlanState {
  active?: boolean;
  state?: string;
  file_path?: string;
  content?: string;
}

export function PlanPanel() {
  const { sid } = useApp();
  const [plan, setPlan] = useState<PlanState | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await engine.get('/plan');
      if (r.body && typeof r.body === 'object') setPlan(r.body as PlanState);
    } catch { /* 引擎不可达：下个周期再试 */ }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load, sid]); // sid 变化（切项目）即刷新

  if (!plan) {
    return <div className="p-6 text-center text-ui-xs text-foreground-subtlest">读取中…</div>;
  }
  if (!plan.active || !plan.content) {
    return (
      <div className="p-6 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
        暂无计划<br />用输入框左下的「规划模式」发起调研，计划会显示在这里
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-info/15 px-1.5 py-0.5 text-ui-2xs text-info">{plan.state}</span>
        {plan.file_path && (
          <span className="min-w-0 truncate font-mono text-ui-2xs text-foreground-subtlest" title={plan.file_path}>
            {plan.file_path}
          </span>
        )}
      </div>
      <pre className="whitespace-pre-wrap font-mono text-ui-xs leading-relaxed text-foreground-subtle">
        {plan.content}
      </pre>
    </div>
  );
}
