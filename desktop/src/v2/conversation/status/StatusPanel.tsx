// StatusPanel — 对话状态面板：对话区右上角常驻，收起为一枚胶囊，展开为分区面板。
//
// 与「谁在干活」绑定：胶囊与面板头都以当前智能体的头像开头，面板头显示本轮
// 运行时长。区块只在有内容时出现：目标（逐轮验收轨迹）· 进程（任务清单）·
// 协作（子代理 + 流水线节点条）· 终端 · 计划 · 工作区（Git + 插件持有的环境
// 资源）。展开偏好：自动（宽容器展开、窄容器收起）/ 始终展开 / 始终收起。
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIcon, ArrowDownIcon, ArrowUpFromLineIcon, ArrowUpIcon, BotIcon, CableIcon, CheckCircle2Icon,
  ChevronRightIcon, CircleCheckBigIcon, CircleIcon, EllipsisIcon, FileDiffIcon, GitBranchIcon,
  GitCommitHorizontalIcon, GlobeIcon, GoalIcon, ListChecksIcon, Loader2Icon, Maximize2Icon, Minimize2Icon,
  PauseIcon, PlayIcon, SmartphoneIcon, SquareIcon, SquareTerminalIcon, WorkflowIcon,
} from 'lucide-react';
import { useApp } from '../../app/appState';
import { AgentAvatar } from '../../app/agentIcon';
import { useCurrentMode } from '../../app/modeRegistry';
import { useWorkspace } from '../../app/workspace';
import { engine } from '../../protocol';
import { useConversation } from '../store';
import { Collapse } from '../../components/ui/collapse';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { cn } from '../../components/lib/utils';
import { subAgentTraceTabId } from '../../lib/traceTabs';
import { BranchSwitcher } from '../../pane/git/BranchSwitcher';
import { CommitDialog } from '../../pane/git/CommitDialog';
import { refreshGit } from '../../pane/gitChanges';
import { refreshSessionStatus } from './sessionStatus';
import {
  capsuleOf, foldLabel, formatDuration, goalElapsedMs, todoFocusWindow,
  type Capsule, type StatusPanelModel, type TaskItem, type ThreadGoal,
} from './statusPanelModel';
import { useStatusPanelUi, type StatusSectionId } from './useStatusPanel';

/** 每秒跳动的当前时间（active 为 false 时不起计时器）。 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// ---------- 区块外壳 ----------

function Section({ id, title, trailing, separated, maxH = 'max-h-48', children }: {
  id: StatusSectionId;
  title: string;
  trailing?: (open: boolean) => ReactNode;
  separated: boolean;
  maxH?: string;
  children: ReactNode;
}) {
  const open = useStatusPanelUi((s) => s.open[id]);
  const setOpen = useStatusPanelUi((s) => s.setOpen);
  return (
    <section className={cn('min-w-0 flex-none', separated && 'border-t border-border/60 pt-1')}>
      <div className="flex h-8 min-w-0 items-center gap-1.5 px-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen(id, !open)}
          className="group flex min-w-0 items-center gap-1 text-ui-xs font-medium text-foreground-subtle hover:text-foreground">
          <span className="truncate">{title}</span>
          <ChevronRightIcon className={cn('size-3 shrink-0 opacity-60 transition-transform duration-150 group-hover:opacity-100', open && 'rotate-90')} />
        </button>
        {trailing && (
          <div className="ml-auto flex min-w-0 items-center gap-1.5 text-ui-2xs tabular-nums text-foreground-subtlest">
            {trailing(open)}
          </div>
        )}
      </div>
      <Collapse open={open}>
        <div className={cn(maxH, 'min-h-0 overflow-y-auto overflow-x-hidden pb-1')}>{children}</div>
      </Collapse>
    </section>
  );
}

const rowCls = 'flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-sm text-foreground transition-colors';

function StopButton({ onStop, label }: { onStop(): void; label: string }) {
  return (
    <button type="button" aria-label={label} title={label}
      onClick={(e) => { e.stopPropagation(); onStop(); }}
      className="relative z-[1] ml-auto flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-ui-xs text-foreground-subtle hover:bg-destructive/10 hover:text-destructive">
      <SquareIcon className="size-2.5 fill-current" />停止
    </button>
  );
}

// ---------- 目标 ----------

function GoalTrack({ goal }: { goal: ThreadGoal }) {
  const checks = goal.checks ?? [];
  const total = Math.max(goal.maxIterations, goal.iteration);
  return (
    <div className="flex items-center gap-1" aria-label={`第 ${goal.iteration}/${goal.maxIterations} 轮`}>
      {Array.from({ length: Math.min(total, 30) }, (_, i) => {
        const n = i + 1;
        const c = checks.find((x) => x.iteration === n);
        const current = !c && n === goal.iteration && goal.status !== 'verified';
        return (
          <span key={n} title={c ? `第 ${n} 轮：${c.passed ? '达成' : '未通过'}${c.reason ? `，${c.reason}` : ''}` : current ? `第 ${n} 轮进行中` : undefined}
            className={cn(
              'size-2 shrink-0 rounded-full',
              c?.passed ? 'bg-success'
                : c ? 'bg-warning'
                  : current && goal.status === 'active' ? 'animate-pulse border-2 border-brand'
                    : current ? 'border border-foreground-subtlest'
                      : 'bg-border',
            )} />
        );
      })}
    </div>
  );
}

function GoalSection({ sid, goal, separated }: { sid: string; goal: ThreadGoal; separated: boolean }) {
  const pauseGoal = useWorkspace((s) => s.pauseGoal);
  const resumeGoal = useWorkspace((s) => s.resumeGoal);
  const clearGoal = useWorkspace((s) => s.clearGoal);
  const busy = useConversation((s) => s.sessions[sid]?.busy ?? false);
  const now = useNow(goal.status === 'active');
  const last = goal.checks?.[goal.checks.length - 1];
  const control = goal.status === 'active'
    ? <button type="button" aria-label="暂停目标" title="暂停目标（本轮结束后不再续跑）" onClick={(e) => { e.stopPropagation(); void pauseGoal(sid); }} className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground"><PauseIcon className="size-3" /></button>
    : goal.status === 'paused'
      ? <button type="button" aria-label="继续目标" title="继续推进" disabled={busy} onClick={(e) => { e.stopPropagation(); void resumeGoal(sid); }} className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground disabled:opacity-40"><PlayIcon className="size-3" /></button>
      : <CircleCheckBigIcon className="size-3.5 text-success" aria-label="已达成" />;
  return (
    <Section id="goal" title="目标" separated={separated}
      trailing={() => <><span>{formatDuration(goalElapsedMs(goal, now))}</span>{control}</>}>
      <div className="grid gap-2 px-2 pb-1.5 pt-0.5">
        <p className="line-clamp-3 text-ui-sm leading-snug text-foreground" title={goal.objective}>{goal.objective}</p>
        <div className="flex items-center gap-2">
          <GoalTrack goal={goal} />
          <span className="ml-auto shrink-0 text-ui-2xs tabular-nums text-foreground-subtlest">
            {goal.status === 'verified' ? `${goal.checks?.length ?? 0} 轮达成` : `第 ${goal.iteration}/${goal.maxIterations} 轮`}
          </span>
        </div>
        {last && (
          <div className="rounded-lg bg-surface px-2 py-1.5 text-ui-xs leading-relaxed">
            <span className={last.passed ? 'text-success' : 'text-warning'}>第 {last.iteration} 轮{last.passed ? '达成' : '未通过'}</span>
            {last.reason && <span className="text-foreground-subtle">：{last.reason}</span>}
            {!last.passed && last.nextAction && <div className="text-foreground-subtlest">下一步：{last.nextAction}</div>}
          </div>
        )}
        {goal.status === 'paused' && goal.pausedReason && (
          <div className="text-ui-xs text-warning">已暂停 · {goal.pausedReason}</div>
        )}
        <button type="button" onClick={() => void clearGoal(sid)}
          className="w-fit text-ui-2xs text-foreground-subtlest hover:text-destructive">
          结束目标
        </button>
      </div>
    </Section>
  );
}

// ---------- 进程 ----------

function TodoIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-success" />;
  if (status === 'in_progress') return <Loader2Icon className="mt-0.5 size-3.5 shrink-0 animate-spin text-brand" />;
  return <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-foreground-subtlest" />;
}

function TodoRows({ items }: { items: TaskItem[] }) {
  return items.map((t) => (
    <li key={t.id} className="flex min-h-8 items-start gap-2 rounded-lg px-2 py-1.5 text-ui-sm hover:bg-hover">
      <TodoIcon status={t.status} />
      <span title={t.subject} className={cn('line-clamp-2 min-w-0 flex-1 break-words leading-5',
        t.status === 'completed' ? 'text-foreground-subtlest line-through' : 'text-foreground')}>
        {t.subject}
      </span>
    </li>
  ));
}

function FoldRow({ group, items }: { group: 'preceding' | 'following'; items: TaskItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <>
      {open && group === 'following' ? null : (
        <li>
          <button type="button" onClick={() => setOpen(!open)}
            className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-ui-xs text-foreground-subtle hover:bg-hover">
            <ChevronRightIcon className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
            {open ? '收起' : foldLabel(group, items)}
          </button>
        </li>
      )}
      {open && <TodoRows items={items} />}
      {open && group === 'following' && (
        <li>
          <button type="button" onClick={() => setOpen(false)}
            className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-ui-xs text-foreground-subtle hover:bg-hover">
            <ChevronRightIcon className="size-3 shrink-0 -rotate-90" />收起
          </button>
        </li>
      )}
    </>
  );
}

function TodoSection({ todo, separated }: { todo: NonNullable<StatusPanelModel['todo']>; separated: boolean }) {
  const w = todoFocusWindow(todo.items);
  const allDone = todo.completed >= todo.total;
  return (
    <Section id="todo" title="进程" separated={separated} maxH="max-h-80"
      trailing={() => <span className={allDone ? 'text-success' : undefined}>{todo.completed}/{todo.total}</span>}>
      <ul>
        {w.compact && <FoldRow group="preceding" items={w.preceding} />}
        <TodoRows items={w.focus} />
        {w.compact && <FoldRow group="following" items={w.following} />}
      </ul>
    </Section>
  );
}

// ---------- 协作：子代理 + 流水线 ----------

const NODE_CLS: Record<string, string> = {
  pending: 'bg-surface text-foreground-subtlest',
  running: 'bg-brand/15 text-brand',
  done: 'bg-success/12 text-success',
  error: 'bg-destructive/12 text-destructive',
};

function CollabSection({ sid, model, separated }: { sid: string; model: StatusPanelModel; separated: boolean }) {
  const { openPaneTab } = useApp();
  const stopAgent = useConversation((s) => s.stopAgent);
  const now = useNow(model.agents.length > 0 || !!model.pipeline);
  const running = model.agents.length + (model.pipeline ? 1 : 0);
  return (
    <Section id="collab" title="协作" separated={separated}
      trailing={() => (running > 0 ? <span>{running} 进行中</span> : null)}>
      {model.pipeline && (
        <button type="button" onClick={() => openPaneTab({ id: 'pipeline', kind: 'pipeline', label: '流水线' })}
          className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-hover">
          <span className="flex min-w-0 items-center gap-2 text-ui-sm text-foreground">
            <WorkflowIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate">{model.pipeline.title}</span>
            <span className="shrink-0 text-ui-2xs tabular-nums text-foreground-subtlest">
              {model.pipeline.settled}/{model.pipeline.total} · {formatDuration(now - model.pipeline.startedAt)}
            </span>
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1 pl-6">
            {model.pipeline.nodes.map((n) => (
              <span key={n.name} title={`${n.name}：${n.status}`}
                className={cn('flex h-5 max-w-28 items-center gap-1 rounded-md px-1.5 text-ui-2xs', NODE_CLS[n.status] ?? NODE_CLS.pending)}>
                {n.status === 'running' && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand" />}
                <span className="truncate">{n.name}</span>
              </span>
            ))}
          </span>
        </button>
      )}
      <ul>
        {model.agents.map((a) => (
          <li key={a.id} className="group relative flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
            <button type="button" aria-label={`查看子代理：${a.title}`}
              onClick={() => openPaneTab({ id: subAgentTraceTabId(sid, a.id), kind: 'subagentTrace', label: a.title.slice(0, 16) })}
              className="absolute inset-0 rounded-lg" />
            <BotIcon className="pointer-events-none relative mt-0.5 size-4 shrink-0 text-foreground-subtle" />
            <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-1">
              <span className="line-clamp-2 text-ui-sm leading-5 text-foreground">{a.title}</span>
              <span className="text-ui-xs tabular-nums text-foreground-subtle">已运行 {formatDuration(now - a.startedAt)}</span>
            </span>
            <span className="relative self-center">
              <StopButton label="停止该子代理" onStop={() => { void stopAgent(sid, a.id).then(() => refreshSessionStatus(sid)); }} />
            </span>
          </li>
        ))}
      </ul>
      {model.endedAgents > 0 && (
        <div className="px-2 py-1 text-ui-2xs text-foreground-subtlest">已结束 {model.endedAgents} 个子代理</div>
      )}
    </Section>
  );
}

// ---------- 终端 ----------

function TerminalSection({ sid, model, separated }: { sid: string; model: StatusPanelModel; separated: boolean }) {
  const { openViewerFile } = useApp();
  const now = useNow(model.terminals.length > 0);
  const longest = Math.max(...model.terminals.map((t) => now - t.startedAt));
  const stop = async (id: string): Promise<void> => {
    await engine.post(`/bgtasks/${encodeURIComponent(id)}/stop`, {}).catch(() => null);
    refreshSessionStatus(sid);
  };
  return (
    <Section id="terminal" title="终端" separated={separated}
      trailing={(open) => (open
        ? <span>{model.terminals.length} 个后台运行</span>
        : <span>最长 {formatDuration(longest)} · {model.terminals.length} 个</span>)}>
      <ul>
        {model.terminals.map((t) => (
          <li key={t.id} className="group relative flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-hover">
            {t.outputFile && (
              <button type="button" aria-label={`查看 ${t.title} 的输出`} onClick={() => openViewerFile(t.outputFile!)}
                className="absolute inset-0 rounded-lg" />
            )}
            <SquareTerminalIcon className="pointer-events-none relative mt-0.5 size-4 shrink-0 text-foreground-subtle" />
            <span className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-1">
              <span className="line-clamp-2 break-all font-mono text-ui-xs leading-5 text-foreground">{t.title}</span>
              <span className="text-ui-xs tabular-nums text-foreground-subtle">已运行 {formatDuration(now - t.startedAt)}</span>
            </span>
            <span className="relative self-center">
              <StopButton label="停止该后台命令" onStop={() => void stop(t.id)} />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- 计划 ----------

function PlanSection({ model, separated }: { model: StatusPanelModel; separated: boolean }) {
  const { openPaneTab } = useApp();
  return (
    <Section id="plan" title="计划" separated={separated}
      trailing={() => (model.plans.length > 1 ? <span>{model.plans.length} 份</span> : null)}>
      <ul>
        {model.plans.map((p) => (
          <li key={p.toolUseId}>
            <button type="button" onClick={() => openPaneTab({ id: `plan:${p.toolUseId}`, kind: 'planDoc', label: p.title.slice(0, 16) })}
              className={cn(rowCls, 'hover:bg-hover')}>
              <ListChecksIcon className="size-4 shrink-0 text-foreground-subtle" />
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------- 工作区：Git + 环境资源 ----------

function WorkspaceSection({ dir, model, separated }: { dir: string; model: StatusPanelModel; separated: boolean }) {
  const { openPaneTab, openSettings, paneTabs, setPaneActive } = useApp();
  const [commitOpen, setCommitOpen] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState('');
  const git = model.git;
  const env = model.env;
  const mcpErr = env?.mcp?.filter((s) => s.status === 'error') ?? [];
  const mcpOk = env?.mcp?.filter((s) => s.status === 'connected').length ?? 0;
  const push = async (): Promise<void> => {
    setPushing(true);
    setPushError('');
    const r = await window.amc.git.push(dir);
    setPushing(false);
    if (!r.ok) setPushError(r.error || '推送失败');
    refreshGit(dir);
  };
  const openBrowser = (): void => {
    const tab = paneTabs.find((t) => t.kind === 'browser');
    if (tab) { openPaneTab(tab); setPaneActive(tab.id); } else void window.amc.browser.open('about:blank');
  };
  return (
    <Section id="workspace" title="工作区" separated={separated}
      trailing={(open) => (!open && git
        ? <span><span className="text-success">+{git.added}</span> <span className="text-destructive">-{git.deleted}</span></span>
        : null)}>
      {git && (
        <>
          <button type="button" onClick={() => openPaneTab({ id: 'git', kind: 'git', label: '变更' })} className={cn(rowCls, 'hover:bg-hover')}>
            <FileDiffIcon className="size-4 shrink-0 text-foreground-subtle" />
            <span className="min-w-0 flex-1 truncate">改动 · {git.files} 个文件</span>
            <span className="shrink-0 font-mono text-ui-xs tabular-nums">
              <span className="text-success">+{git.added}</span> <span className="text-destructive">-{git.deleted}</span>
            </span>
          </button>
          <BranchSwitcher dir={dir}>
            <button type="button" className={cn(rowCls, 'hover:bg-hover')}>
              <GitBranchIcon className="size-4 shrink-0 text-foreground-subtle" />
              <span className="min-w-0 flex-1 truncate">{git.branch || '分支'}</span>
              {(git.ahead ?? 0) > 0 && <span className="flex shrink-0 items-center text-ui-xs text-info"><ArrowUpIcon className="size-3" />{git.ahead}</span>}
              {(git.behind ?? 0) > 0 && <span className="flex shrink-0 items-center text-ui-xs text-warning"><ArrowDownIcon className="size-3" />{git.behind}</span>}
            </button>
          </BranchSwitcher>
          {git.files > 0 ? (
            <button type="button" onClick={() => setCommitOpen(true)} className={cn(rowCls, 'hover:bg-hover')}>
              <GitCommitHorizontalIcon className="size-4 shrink-0 text-foreground-subtle" />
              <span className="min-w-0 flex-1 truncate">提交改动…</span>
            </button>
          ) : (git.ahead ?? 0) > 0 ? (
            <button type="button" disabled={pushing} onClick={() => void push()} className={cn(rowCls, 'hover:bg-hover disabled:opacity-60')}>
              {pushing ? <Loader2Icon className="size-4 shrink-0 animate-spin" /> : <ArrowUpFromLineIcon className="size-4 shrink-0 text-foreground-subtle" />}
              <span className="min-w-0 flex-1 truncate">推送 {git.ahead} 个提交</span>
            </button>
          ) : null}
          {pushError && <div className="mx-2 rounded-md bg-destructive/10 px-2 py-1 text-ui-2xs text-destructive">{pushError}</div>}
        </>
      )}
      {(env?.browserPages ?? 0) > 0 && (
        <button type="button" onClick={openBrowser} className={cn(rowCls, 'hover:bg-hover')}>
          <GlobeIcon className="size-4 shrink-0 text-foreground-subtle" />
          <span className="min-w-0 flex-1 truncate">浏览器</span>
          <span className="shrink-0 text-ui-xs text-foreground-subtle">{env!.browserPages} 个页面</span>
        </button>
      )}
      {(env?.devices?.length ?? 0) > 0 && (
        <button type="button" onClick={() => openPaneTab({ id: 'mode:device', kind: 'mode', label: '设备' })} className={cn(rowCls, 'hover:bg-hover')}>
          <SmartphoneIcon className="size-4 shrink-0 text-foreground-subtle" />
          <span className="min-w-0 flex-1 truncate">{env!.devices!.join('、')}</span>
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
        </button>
      )}
      {(env?.mcp?.length ?? 0) > 0 && (
        <button type="button" onClick={() => openSettings('mcp')} className={cn(rowCls, 'hover:bg-hover')}
          title={mcpErr.map((s) => `${s.name}：${s.error || '连接失败'}`).join('\n') || undefined}>
          <CableIcon className="size-4 shrink-0 text-foreground-subtle" />
          <span className="min-w-0 flex-1 truncate">MCP 服务</span>
          <span className={cn('shrink-0 text-ui-xs', mcpErr.length ? 'text-destructive' : 'text-foreground-subtle')}>
            {mcpErr.length ? `${mcpErr.length} 个失败` : `${mcpOk}/${env!.mcp!.length} 正常`}
          </span>
        </button>
      )}
      <CommitDialog dir={dir} open={commitOpen} onOpenChange={setCommitOpen} />
    </Section>
  );
}

// ---------- 胶囊 ----------

function CapsuleBody({ capsule }: { capsule: Capsule }) {
  const m = capsule.main;
  const icon = m.kind === 'pipeline' ? <WorkflowIcon className="size-4" />
    : m.kind === 'todoCurrent' ? <Loader2Icon className="size-4 animate-spin text-brand" />
      : m.kind === 'goal' ? (m.done ? <CircleCheckBigIcon className="size-4 text-success" /> : <GoalIcon className="size-4" />)
        : m.kind === 'git' ? <FileDiffIcon className="size-4" />
          : m.kind === 'todoDone' ? <CheckCircle2Icon className="size-4 text-success" />
            : m.kind === 'activity' ? <ActivityIcon className="size-4" />
              : <ListChecksIcon className="size-4" />;
  return (
    <>
      <span className="relative size-4 shrink-0 text-foreground">
        <span className="absolute inset-0 transition-opacity group-hover:opacity-0">{icon}</span>
        <Maximize2Icon className="absolute inset-0 size-4 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      {m.kind === 'pipeline' && (
        <>
          <span className="min-w-0 truncate">{m.title}</span>
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand" />
          <span className="max-w-[45%] shrink-0 truncate text-foreground-subtle">{m.phase}</span>
        </>
      )}
      {(m.kind === 'todoCurrent' || m.kind === 'todoDone') && <span className="min-w-0 truncate">{m.text}</span>}
      {m.kind === 'goal' && <span className="min-w-0 truncate">{m.text}</span>}
      {m.kind === 'git' && (
        <>
          <span className="min-w-0 truncate">改动</span>
          <span className="shrink-0 tabular-nums text-success">+{m.added}</span>
          <span className="shrink-0 tabular-nums text-destructive">-{m.deleted}</span>
        </>
      )}
      {m.kind === 'todoProgress' && <><span className="min-w-0 truncate">进程</span><span className="shrink-0 tabular-nums text-foreground-subtle">{m.completed}/{m.total}</span></>}
      {m.kind === 'plan' && <span className="min-w-0 truncate">{m.title}</span>}
      {m.kind === 'activity' && <span className="min-w-0 truncate">后台运行中</span>}
      {(capsule.agents > 0 || capsule.terminals > 0) && (
        <span className="ml-0.5 flex shrink-0 items-center gap-1.5 border-l border-border pl-2 text-ui-xs tabular-nums text-foreground-subtle">
          {capsule.agents > 0 && <span className="flex items-center gap-0.5"><BotIcon className="size-3.5" />{capsule.agents}</span>}
          {capsule.terminals > 0 && <span className="flex items-center gap-0.5"><SquareTerminalIcon className="size-3.5" />{capsule.terminals}</span>}
        </span>
      )}
    </>
  );
}

// ---------- 面板 ----------

export function StatusPanel({ sid, dir, model }: { sid: string; dir: string; model: StatusPanelModel }) {
  const mode = useCurrentMode();
  const variant = useStatusPanelUi((s) => s.variant);
  const setVariant = useStatusPanelUi((s) => s.setVariant);
  const busy = useConversation((s) => s.sessions[sid]?.busy ?? false);
  const runStartedAt = useConversation((s) => s.sessions[sid]?.runStartedAt ?? null);
  const now = useNow(busy && !!runStartedAt);
  if (!model.hasContent) return null;
  const capsule = capsuleOf(model);
  const auto = variant === null;

  const sections: Array<[boolean, (separated: boolean) => ReactNode]> = [
    [!!model.goal, (s) => <GoalSection key="goal" sid={sid} goal={model.goal!} separated={s} />],
    [!!model.todo, (s) => <TodoSection key="todo" todo={model.todo!} separated={s} />],
    [model.agents.length > 0 || !!model.pipeline || model.endedAgents > 0, (s) => <CollabSection key="collab" sid={sid} model={model} separated={s} />],
    [model.terminals.length > 0, (s) => <TerminalSection key="terminal" sid={sid} model={model} separated={s} />],
    [model.plans.length > 0, (s) => <PlanSection key="plan" model={model} separated={s} />],
    [!!model.git || !!model.env, (s) => <WorkspaceSection key="workspace" dir={dir} model={model} separated={s} />],
  ];
  let shown = 0;
  const body = sections.map(([visible, render]) => (visible ? render(shown++ > 0) : null));

  return (
    <div className="pointer-events-none absolute right-4 top-3 z-20 flex justify-end">
      <aside aria-label="对话状态"
        className={cn(
          'pointer-events-auto relative overflow-hidden rounded-2xl border border-popover-border bg-popover text-foreground shadow-md transition-[border-radius,box-shadow] duration-300',
          variant === 'mini' ? 'inline-flex w-max max-w-[min(22rem,calc(100cqw-2rem))]'
            : variant === 'panel' ? 'flex max-h-[min(64dvh,34rem)] w-80 max-w-[calc(100cqw-2rem)] flex-col'
              : 'inline-flex w-max max-w-[min(22rem,calc(100cqw-2rem))] @min-[1120px]/conversation:flex @min-[1120px]/conversation:max-h-[min(64dvh,34rem)] @min-[1120px]/conversation:w-80 @min-[1120px]/conversation:flex-col',
        )}>
        {variant !== 'mini' && (
          <div className={cn('min-h-0 flex-1 flex-col', auto ? 'hidden @min-[1120px]/conversation:flex' : 'flex')}>
            {/* 面板头：谁在干活 + 本轮时长 + 展开偏好 */}
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 pl-3 pr-1.5">
              <AgentAvatar icon={mode?.icon} size="sm" className={cn(busy && 'ring-2 ring-brand/40')} />
              <span className="min-w-0 truncate text-ui-sm font-medium text-foreground">{mode?.name ?? '智能体'}</span>
              <span className={cn('shrink-0 text-ui-2xs tabular-nums', busy ? 'text-brand' : 'text-foreground-subtlest')}>
                {busy ? `工作中${runStartedAt ? ` · ${formatDuration(now - runStartedAt)}` : ''}` : '待命'}
              </span>
              <span className="ml-auto flex shrink-0 items-center">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label="展开策略" className="rounded-md p-1 text-foreground-subtle hover:bg-hover hover:text-foreground">
                      <EllipsisIcon className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuLabel>展开策略</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={variant ?? 'auto'}
                      onValueChange={(v) => setVariant(v === 'auto' ? null : v as 'panel' | 'mini')}>
                      <DropdownMenuRadioItem value="auto">自动</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="panel">始终展开</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="mini">始终收起</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button type="button" aria-label="收起为胶囊" title="收起为胶囊" onClick={() => setVariant('mini')}
                  className="rounded-md p-1 text-foreground-subtle hover:bg-hover hover:text-foreground">
                  <Minimize2Icon className="size-3.5" />
                </button>
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden p-1.5">
              {body}
            </div>
          </div>
        )}
        {capsule && (
          <button type="button" aria-label="展开对话状态" title="展开对话状态"
            onClick={() => setVariant('panel')}
            className={cn(
              'group flex h-9 w-max max-w-full items-center gap-2 pl-1.5 pr-3 text-left text-ui-sm text-foreground transition-colors hover:bg-menu-hover',
              variant === 'panel' && 'hidden',
              auto && '@min-[1120px]/conversation:hidden',
            )}>
            <AgentAvatar icon={mode?.icon} size="sm" className={cn(busy && 'ring-2 ring-brand/40')} />
            <CapsuleBody capsule={capsule} />
          </button>
        )}
      </aside>
    </div>
  );
}
