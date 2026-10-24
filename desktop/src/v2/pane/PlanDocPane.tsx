// PlanDocPane — 计划文档 tab：本对话某次退出规划模式时提交的计划（取自
// ExitPlanMode 的结果），按 Markdown 渲染只读查看。
import { useApp } from '../app/appState';
import { useSession } from '../conversation/store';
import { extractPlans } from '../conversation/status/statusPanelModel';
import { renderMD } from '../../lib/markdown';

export function parsePlanDocTabId(id: string): string | null {
  return id.startsWith('plan:') ? id.slice(5) : null;
}

export function PlanDocPane({ toolUseId }: { toolUseId: string }) {
  const { sid } = useApp();
  const session = useSession(sid || '');
  const plan = extractPlans(session.rows).find((p) => p.toolUseId === toolUseId);
  if (!plan) {
    return <div className="p-6 text-center text-ui-xs text-foreground-subtlest">这份计划不在当前对话里</div>;
  }
  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <div className="v2-md text-ui-sm text-foreground" dangerouslySetInnerHTML={{ __html: renderMD(plan.markdown) }} />
    </div>
  );
}
