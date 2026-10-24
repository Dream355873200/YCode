// Composer — 输入卡：圆角卡面内含编辑器与底部工具行。
//   leading：智能体（谁来做）· 权限（能做到哪一步，对话级）· 目标（持续推进直到验收达成）
//   trailing：上下文用量环 · 模型与思考强度 · 停止 / 发送
// 草稿对话（sid = null）发出第一条消息时才在引擎创建对话。
// busy 时：无草稿显示停止钮；有草稿时发送 = 入队（当前轮结束后独立成轮）。
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpIcon, BrainIcon, ChevronDownIcon, ClipboardListIcon, FolderIcon, FolderPlusIcon, GoalIcon, Loader2Icon,
  PenLineIcon, ShieldCheckIcon, SlidersHorizontalIcon, SquareIcon, ZapIcon, type LucideIcon,
} from 'lucide-react';
import { useConversation } from './store';
import ContextRing from './ContextRing';
import { useApp, type Permission } from '../app/appState';
import { AgentAvatar } from '../app/agentIcon';
import { useWorkspace } from '../app/workspace';
import { engine } from '../protocol';
import { Button } from '../components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { cn } from '../components/lib/utils';

/** 权限档位（对话级，持久化在对话绑定里）。 */
export const PERMISSIONS: Array<{ id: Permission; label: string; desc: string; icon: LucideIcon; tone?: string }> = [
  { id: 'plan', label: '规划', desc: '只调研、出方案，不改任何文件', icon: ClipboardListIcon },
  { id: 'default', label: '逐项审批', desc: '每次写文件或执行命令前都先问你', icon: ShieldCheckIcon },
  { id: 'accept_edits', label: '自动编辑', desc: '改文件自动通过，危险操作才问你', icon: PenLineIcon },
  { id: 'bypass', label: '完全放行', desc: '全部自动执行，适合无人值守', icon: ZapIcon, tone: 'text-warning' },
];

/** 思考强度（引擎 /thinking；'' = 跟随模型默认）。 */
const EFFORTS: Array<{ id: string; label: string }> = [
  { id: '', label: '默认' },
  { id: 'off', label: '关' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
];

const chipCls = 'flex h-7 items-center gap-1.5 rounded-lg px-2 text-ui-sm text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground';

function AgentPicker() {
  const { modes, projectMode, setProjectMode, openSettings } = useApp();
  const agent = modes.find((m) => m.id === projectMode);
  if (!modes.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipCls} title="换一个智能体（下一轮生效）">
          <AgentAvatar icon={agent?.icon} size="sm" />
          <span className="max-w-28 truncate text-foreground">{agent?.name ?? projectMode}</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-76">
        <DropdownMenuLabel>智能体</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={projectMode} onValueChange={(v) => void setProjectMode(v)}>
          {modes.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id} className="items-start py-2">
              <AgentAvatar icon={m.icon} size="sm" className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-ui-base text-foreground">{m.name}</span>
                {m.description && <span className="line-clamp-2 block text-ui-sm text-foreground-subtlest">{m.description}</span>}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings('modes')}>
          <SlidersHorizontalIcon />管理智能体与插件
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PermissionPicker() {
  const { permission, setPermission } = useApp();
  const cur = PERMISSIONS.find((p) => p.id === permission) ?? PERMISSIONS[2]!;
  const Icon = cur.icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipCls} title="这段对话里智能体能做到哪一步">
          <Icon className={cn('size-3.5', cur.tone)} />
          <span>{cur.label}</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-68">
        <DropdownMenuLabel>权限（本对话）</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={permission} onValueChange={(v) => setPermission(v as Permission)}>
          {PERMISSIONS.map((p) => {
            const PIcon = p.icon;
            return (
              <DropdownMenuRadioItem key={p.id} value={p.id} className="items-start py-2">
                <PIcon className={cn('mt-0.5', p.tone)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-ui-base text-foreground">{p.label}</span>
                  <span className="block text-ui-sm text-foreground-subtlest">{p.desc}</span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 模型与思考强度（引擎全局，运行时切换不重启）。 */
function ModelPicker({ disabled }: { disabled: boolean }) {
  const { engineStatus } = useApp();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(engineStatus.model);
  const [effort, setEffort] = useState('');
  const [switching, setSwitching] = useState(false);

  useEffect(() => { if (engineStatus.model) setModel(engineStatus.model); }, [engineStatus.model]);
  useEffect(() => {
    engine.get('/model').then((r) => {
      const m = (r.body as { model?: string } | undefined)?.model;
      if (m) setModel(m);
    }).catch(() => {});
    engine.get('/thinking').then((r) => {
      const e = (r.body as { effort?: string } | undefined)?.effort;
      if (e !== undefined) setEffort(e);
    }).catch(() => {});
  }, [engineStatus.status]);
  useEffect(() => {
    if (!open || models.length) return;
    window.amc.engine.listModels().then((list) => {
      if (Array.isArray(list) && list.length) setModels(list as string[]);
    }).catch(() => {});
  }, [open, models.length]);

  const pickModel = async (id: string): Promise<void> => {
    if (disabled || switching || id === model) return;
    setSwitching(true);
    try {
      await engine.post('/model', { model: id });
      setModel(id);
      const cfg = await window.amc.config.get() as Record<string, unknown>;
      await window.amc.config.save({ ...cfg, engine: { ...(cfg.engine as object), model: id } });
    } catch { /* 引擎不可达：保持原选择 */ } finally {
      setSwitching(false);
    }
  };
  const pickEffort = (id: string): void => {
    setEffort(id);
    engine.post('/thinking', { effort: id }).catch(() => {});
  };
  const effortLabel = EFFORTS.find((e) => e.id === effort)?.label ?? '默认';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(chipCls, 'max-w-56 text-foreground-subtlest')} title="模型与思考强度">
          <BrainIcon className="size-3.5 shrink-0" />
          <span className="truncate">{switching ? '切换中…' : (model || '模型')}</span>
          {effort && <span className="shrink-0 text-foreground-subtlest">· {effortLabel}</span>}
          <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-72 p-2">
        <div className="px-1 pb-1.5 text-ui-xs font-medium text-foreground-subtlest">思考强度</div>
        <div className="grid grid-cols-5 gap-0.5 rounded-lg border border-border bg-input p-0.5" role="radiogroup">
          {EFFORTS.map((e) => (
            <button key={e.id || 'default'} type="button" role="radio" aria-checked={e.id === effort}
              onClick={() => pickEffort(e.id)}
              className={cn('rounded-md py-1 text-ui-sm transition-colors',
                e.id === effort ? 'bg-selected font-medium text-foreground' : 'text-foreground-subtle hover:bg-hover hover:text-foreground')}>
              {e.label}
            </button>
          ))}
        </div>
        <div className="mt-2.5 px-1 pb-1 text-ui-xs font-medium text-foreground-subtlest">模型</div>
        <div className="max-h-60 overflow-y-auto">
          {models.length === 0 && (
            <div className="px-2 py-1.5 text-ui-sm text-foreground-subtlest">{model ? `当前：${model}` : '未获取到模型列表'}</div>
          )}
          {models.map((m) => (
            <button key={m} type="button" disabled={disabled} onClick={() => void pickModel(m)}
              className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-base transition-colors disabled:opacity-50',
                m === model ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover hover:text-foreground')}>
              <span className="min-w-0 flex-1 truncate" title={m}>{m}</span>
            </button>
          ))}
        </div>
        {disabled && <div className="px-1 pt-1.5 text-ui-xs text-foreground-subtlest">任务执行中，结束后可切换模型</div>}
      </PopoverContent>
    </Popover>
  );
}

/** 草稿的项目：新对话还没建，可以换到别的项目再发。 */
function ProjectChip() {
  const { project, projects, setCreateDialogOpen } = useApp();
  const select = useWorkspace((s) => s.select);
  if (!project) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={chipCls} title="在哪个项目里开始">
          <FolderIcon className="size-3.5" />
          <span className="max-w-32 truncate text-foreground">{project.name}</span>
          <ChevronDownIcon className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel>项目</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={project.dir} onValueChange={(dir) => select({ kind: 'draft', dir })}>
          {projects.map((p) => (
            <DropdownMenuRadioItem key={p.dir} value={p.dir} title={p.dir}>
              <FolderIcon />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCreateDialogOpen(true)}><FolderPlusIcon />添加项目</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Composer({ sid, variant = 'docked', seed }: {
  /** 对话 id；null = 草稿（首条消息时创建对话）。 */
  sid: string | null;
  variant?: 'hero' | 'docked';
  /** 外部注入草稿（开场建议点击填充；tick 递增即重新填充）。 */
  seed?: { text: string; tick: number };
}) {
  const send = useConversation((s) => s.send);
  const enqueue = useConversation((s) => s.enqueue);
  const interrupt = useConversation((s) => s.interrupt);
  const consumeDraftRestore = useConversation((s) => s.consumeDraftRestore);
  const busy = useConversation((s) => (sid ? s.sessions[sid]?.busy ?? false : false));
  const hasHistory = useConversation((s) => (sid ? (s.sessions[sid]?.rows.length ?? 0) > 0 : false));
  const { project, composerSeed, projectMode, permission, modes, thread } = useApp();
  const startThread = useWorkspace((s) => s.startThread);
  const startGoal = useWorkspace((s) => s.startGoal);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [goalMode, setGoalMode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hero = variant === 'hero';
  const agent = modes.find((m) => m.id === projectMode);
  const goalActive = thread?.goal?.status === 'active';

  const fill = (text: string, append = false): void => {
    setDraft((d) => (append && d ? `${d}\n${text}` : text));
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, hero ? 220 : 160)}px`;
    });
  };

  const seedTick = seed?.tick ?? 0;
  useEffect(() => {
    if (seedTick > 0 && seed) fill(seed.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedTick]);

  // 外部注入（「选网页元素加入对话」、变更面板「让智能体审查」等）：追加到草稿并聚焦
  const injectTick = composerSeed.tick;
  useEffect(() => {
    if (injectTick > 0) fill(composerSeed.text, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectTick]);

  // 队列项「撤回编辑」：store 的草稿回填请求落到输入框
  useEffect(() => {
    if (!sid) return;
    const text = consumeDraftRestore(sid);
    if (text) fill(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, consumeDraftRestore, draft]);

  const submit = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || starting) return;
    setError('');
    setDraft('');
    if (taRef.current) taRef.current.style.height = 'auto';
    const asGoal = goalMode;
    setGoalMode(false);
    if (!sid) {
      if (!project) return;
      setStarting(true);
      try {
        await startThread(project.dir, text, { mode: projectMode, permission, goal: asGoal });
      } catch (e) {
        setDraft(text);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStarting(false);
      }
      return;
    }
    if (asGoal && !busy) { void startGoal(sid, text); return; }
    if (busy) void enqueue(sid, text);
    else void send(sid, text);
  };

  const hasDraft = draft.trim().length > 0;
  const showStop = !!sid && busy && !hasDraft;
  const placeholder = goalMode
    ? '描述要达成的目标：智能体会持续推进，每轮结束自动验收，直到达成'
    : busy
      ? '继续输入，排队到当前任务之后（Esc 停止当前任务）'
      : hasHistory
        ? '提出后续要求'
        : agent ? `交给${agent.name}：描述你要完成的事` : '描述你要完成的事';

  return (
    <div className="relative z-10">
      <div className={cn(
        'rounded-2xl border bg-input p-3 transition-colors',
        goalMode ? 'border-brand/60' : 'border-input-border hover:border-input-border-hover',
        focused && !goalMode && 'border-input-border-focused bg-input-focused',
      )}>
        <textarea
          ref={taRef}
          value={draft}
          rows={hero ? 3 : 1}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, hero ? 220 : 160)}px`;
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            } else if (e.key === 'Escape' && sid && busy) {
              e.preventDefault();
              void interrupt(sid);
            }
          }}
          placeholder={placeholder}
          className="block w-full resize-none bg-transparent px-1 pt-1.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtlest"
          style={{ minHeight: 54 }}
        />
        <div className="mt-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-0.5">
            {!sid && <ProjectChip />}
            <AgentPicker />
            <PermissionPicker />
            <button type="button" onClick={() => setGoalMode(!goalMode)} aria-pressed={goalMode}
              title={goalActive ? '本对话已有进行中的目标；开启后发送会替换它' : '以目标发送：每轮结束自动验收，未达成就继续推进'}
              className={cn(chipCls, goalMode && 'bg-brand/12 text-brand hover:bg-brand/18 hover:text-brand')}>
              <GoalIcon className="size-3.5" />
              <span>{goalActive && !goalMode ? '目标进行中' : '目标'}</span>
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {sid && <ContextRing sid={sid} />}
            <ModelPicker disabled={busy} />
            {showStop ? (
              <Button type="button" variant="secondary" size="icon-md" aria-label="停止当前任务"
                title="停止当前任务" onClick={() => void interrupt(sid!)}>
                <SquareIcon className="size-4 fill-current" />
              </Button>
            ) : (
              <Button type="button" size="icon-md" disabled={!hasDraft || starting}
                aria-label={busy ? '加入队列' : '发送（Enter）'}
                title={busy ? '加入队列（当前任务结束后执行）' : '发送（Enter）'}
                className="rounded-lg bg-brand text-foreground-inverse hover:bg-brand/80"
                onClick={() => void submit()}>
                {starting ? <Loader2Icon className="size-4 animate-spin" /> : <ArrowUpIcon className="size-4" />}
              </Button>
            )}
          </div>
        </div>
      </div>
      {error && <div className="mt-1.5 px-2 text-ui-sm text-destructive">{error}</div>}
    </div>
  );
}
