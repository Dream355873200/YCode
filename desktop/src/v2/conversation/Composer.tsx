// Composer — 输入卡（对齐 ZCode ChatPromptEditor 壳层）：
// 圆角卡面（border-input-border bg-input，focus-within 高亮边+提底）内含编辑器与
// 底部工具行：leading 模式菜单（规划/自动编辑/手动审批/全部放行，引擎 /mode），
// trailing 模型选择器（OpenAI 兼容 /models）+ 停止·发送簇。
// busy 态：无草稿显示停止钮（secondary + 方块）；有草稿时发送 = 入队
// （queue 车道，当前轮结束后独立成轮——队列面板显示待发消息）。
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpIcon, BrainIcon, CheckIcon, ChevronDownIcon, ClipboardListIcon, PenLineIcon,
  ShieldCheckIcon, SquareIcon, ZapIcon,
} from 'lucide-react';
import { useConversation } from './store';
import { useApp } from '../app/appState';
import { engine } from '../protocol';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';
import { useDismiss } from '../components/lib/useDismiss';

/** 权限模式（引擎 /mode 端点的字符串枚举）。 */
const MODES: Array<{ id: string; label: string; desc: string; icon: typeof ZapIcon }> = [
  { id: 'plan', label: '规划模式', desc: '只读调研，不改代码', icon: ClipboardListIcon },
  { id: 'accept_edits', label: '自动编辑', desc: '改文件自动通过，危险操作询问', icon: PenLineIcon },
  { id: 'default', label: '手动审批', desc: '每次写操作都需确认', icon: ShieldCheckIcon },
  { id: 'bypass', label: '全部放行', desc: '无人值守，全自动执行', icon: ZapIcon },
];

/** 思考强度档位（引擎 /thinking；off = 关闭思考，空 = 跟随模型默认）。 */
const EFFORTS: Array<{ id: string; label: string; desc: string }> = [
  { id: 'off', label: '关闭思考', desc: '直接作答，最快' },
  { id: 'low', label: '低', desc: '简单任务，省时省 token' },
  { id: 'medium', label: '中', desc: '常规开发任务的平衡档' },
  { id: 'high', label: '高', desc: '复杂架构/疑难问题，想得更深' },
];

export function Composer({ sid, variant = 'docked', seed = '' }: {
  sid: string;
  variant?: 'hero' | 'docked';
  /** 外部注入草稿（快捷 chips 点击填充）。 */
  seed?: string;
}) {
  const send = useConversation((s) => s.send);
  const enqueue = useConversation((s) => s.enqueue);
  const interrupt = useConversation((s) => s.interrupt);
  const consumeDraftRestore = useConversation((s) => s.consumeDraftRestore);
  const busy = useConversation((s) => s.sessions[sid]?.busy ?? false);
  const { engineStatus, project } = useApp();
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 模式（引擎权威；挂载时拉取）
  const [mode, setMode] = useState('accept_edits');
  const [modeOpen, setModeOpen] = useState(false);
  const modeRef = useDismiss(modeOpen, () => setModeOpen(false));
  useEffect(() => {
    engine.get('/mode').then((r) => {
      const m = (r.body as { mode?: string } | undefined)?.mode;
      if (m) setMode(m);
    }).catch(() => { /* 引擎未起：保持初始值 */ });
  }, []);

  // 模型列表（OpenAI 兼容 /models；引擎 /model 为当前值，运行时切换不重启）
  const [models, setModels] = useState<string[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [switchingModel, setSwitchingModel] = useState(false);
  const modelRef = useDismiss(modelOpen, () => setModelOpen(false));
  const [cfgModel, setCfgModel] = useState(engineStatus.model);
  useEffect(() => {
    if (engineStatus.model) setCfgModel(engineStatus.model);
  }, [engineStatus.model]);
  useEffect(() => {
    engine.get('/model').then((r) => {
      const m = (r.body as { model?: string } | undefined)?.model;
      if (m) setCfgModel(m);
    }).catch(() => { /* 引擎未起：保持初始值 */ });
  }, []);
  useEffect(() => {
    if (!modelOpen || models.length) return;
    window.amc.engine.listModels().then((list) => {
      if (Array.isArray(list) && list.length) setModels(list as string[]);
    }).catch(() => { /* 端点不可用：只显示当前模型 */ });
  }, [modelOpen, models.length]);

  // 切模型：POST /model 运行时生效（下一次请求即用新模型），同时写 config 持久化（下次启动沿用），不重启
  const pickModel = async (id: string): Promise<void> => {
    if (busy || switchingModel || id === cfgModel) { setModelOpen(false); return; }
    setSwitchingModel(true);
    try {
      await engine.post('/model', { model: id });
      setCfgModel(id);
      setModelOpen(false);
      const cfg = await window.amc.config.get() as Record<string, unknown>;
      await window.amc.config.save({ ...cfg, engine: { ...(cfg.engine as object), model: id } });
    } catch { /* 引擎不可达：保持原选择 */ }
    finally {
      setSwitchingModel(false);
    }
  };

  // 思考强度（引擎 /thinking；下一轮生效）
  const [effort, setEffort] = useState('');
  const [effortOpen, setEffortOpen] = useState(false);
  const effortRef = useDismiss(effortOpen, () => setEffortOpen(false));
  useEffect(() => {
    engine.get('/thinking').then((r) => {
      const e = (r.body as { effort?: string } | undefined)?.effort;
      if (e !== undefined) setEffort(e);
    }).catch(() => { /* 引擎未起 */ });
  }, []);
  const pickEffort = (id: string): void => {
    setEffort(id);
    setEffortOpen(false);
    engine.post('/thinking', { effort: id }).catch(() => { /* 引擎不可达：下轮拉取对账 */ });
  };

  useEffect(() => {
    if (seed) {
      setDraft(seed);
      taRef.current?.focus();
    }
  }, [seed]);

  // 队列项「撤回编辑」：store 的草稿回填请求落到输入框
  useEffect(() => {
    const text = consumeDraftRestore(sid);
    if (text) {
      setDraft(text);
      taRef.current?.focus();
    }
  }, [sid, consumeDraftRestore, draft]); // draft 依赖：每次输入变化都尝试消费（store 只发一次）

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    if (taRef.current) taRef.current.style.height = 'auto';
    if (busy) void enqueue(sid, text);
    else void send(sid, text);
  };

  const hasDraft = draft.trim().length > 0;
  // ZCode 状态机：busy 且无草稿 → 停止钮；有草稿 → 发送键（入队）。
  const showStop = busy && !hasDraft;
  const hero = variant === 'hero';
  const modeDef = MODES.find((m) => m.id === mode) ?? MODES[1]!;
  const ModeIcon = modeDef.icon;

  const applyMode = (id: string): void => {
    setMode(id);
    setModeOpen(false);
    engine.post('/mode', { mode: id }).catch(() => { /* 引擎不可达：UI 保持所选，下轮拉取对账 */ });
  };

  return (
    <div
      className={
        'relative z-10 rounded-2xl border border-input-border bg-input p-3 transition-colors'
        + ' hover:border-input-border-hover'
        + (focused ? ' border-input-border-focused bg-input-focused' : '')
      }
    >
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
            submit();
          }
        }}
        placeholder={busy
          ? '任务执行中——发送将排队，当前任务结束后依次执行'
          : '描述你的想法，AI 帮你做成 App'}
        className="block w-full resize-none bg-transparent px-1 pt-1.5 text-ui-base text-foreground outline-none placeholder:text-foreground-subtlest"
        style={{ minHeight: hero ? 72 : undefined }}
      />
      {/* 工具行：leading 模式菜单 · trailing 模型选择器 + 停止/发送 */}
      <div className="mt-2 flex items-end gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {hero && project && (
            <span className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-ui-xs text-foreground-subtle">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: project.color || 'var(--color-brand)' }} />
              <span className="truncate">{project.name}</span>
            </span>
          )}
          {/* 模式菜单（引擎 /mode；对进行中的 run 也立即生效） */}
          <div ref={modeRef} className="relative shrink-0">
            <button type="button"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
              onClick={() => setModeOpen(!modeOpen)}>
              <ModeIcon className="size-3.5" />
              <span>{modeDef.label}</span>
              <ChevronDownIcon className="size-3 opacity-60" />
            </button>
            {modeOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border border-border bg-popover p-1 shadow-lg">
                {MODES.map((m) => {
                  const Icon = m.icon;
                  return (
                    <button key={m.id} type="button"
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                        m.id === mode ? 'bg-selected' : 'hover:bg-hover',
                      )}
                      onClick={() => applyMode(m.id)}>
                      <Icon className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-ui-sm text-foreground">{m.label}</span>
                        <span className="block text-ui-xs text-foreground-subtlest">{m.desc}</span>
                      </span>
                      {m.id === mode && <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {/* 思考强度菜单（引擎 /thinking；下一轮生效） */}
          <div ref={effortRef} className="relative shrink-0">
            <button type="button"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-ui-xs text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground"
              onClick={() => setEffortOpen(!effortOpen)}>
              <BrainIcon className="size-3.5" />
              <span>{EFFORTS.find((e) => e.id === effort)?.label ?? '思考'}</span>
              <ChevronDownIcon className="size-3 opacity-60" />
            </button>
            {effortOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border border-border bg-popover p-1 shadow-lg">
                {EFFORTS.map((e) => (
                  <button key={e.id} type="button"
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                      e.id === effort ? 'bg-selected' : 'hover:bg-hover',
                    )}
                    onClick={() => pickEffort(e.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-ui-sm text-foreground">{e.label}</span>
                      <span className="block text-ui-xs text-foreground-subtlest">{e.desc}</span>
                    </span>
                    {e.id === effort && <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 模型选择器（OpenAI 兼容 /models；切换 = 写 config + 重启引擎） */}
          <div ref={modelRef} className="relative">
            <button type="button"
              className="flex max-w-44 items-center gap-1.5 rounded-lg px-2 py-1 text-ui-xs text-foreground-subtlest transition-colors hover:bg-hover hover:text-foreground"
              title="切换模型（保存并重启引擎）"
              onClick={() => setModelOpen(!modelOpen)}>
              <span className="truncate">{switchingModel ? '切换中…' : (cfgModel || '模型')}</span>
              <ChevronDownIcon className="size-3 opacity-60" />
            </button>
            {modelOpen && (
              <div className="absolute bottom-full right-0 z-30 mb-2 max-h-72 w-56 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
                {models.length === 0 && (
                  <div className="px-2.5 py-2 text-ui-xs text-foreground-subtlest">
                    {cfgModel ? `当前：${cfgModel}` : '未获取到模型列表'}
                  </div>
                )}
                {models.map((m) => (
                  <button key={m} type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-sm transition-colors',
                      m === cfgModel ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
                    )}
                    onClick={() => void pickModel(m)}>
                    <span className="min-w-0 flex-1 truncate" title={m}>{m}</span>
                    {m === cfgModel && <CheckIcon className="size-3.5 shrink-0 text-brand" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {showStop ? (
            <Button type="button" variant="secondary" size="icon-md" aria-label="停止当前任务"
              title="停止当前任务" onClick={() => void interrupt(sid)}>
              <SquareIcon className="size-4 fill-current" />
            </Button>
          ) : (
            <Button type="button" size="icon-md" disabled={!hasDraft}
              aria-label={busy ? '加入队列' : '发送（Enter）'}
              title={busy ? '加入队列（当前任务结束后执行）' : '发送（Enter）'}
              className="rounded-lg bg-brand text-foreground-inverse hover:bg-brand/80"
              onClick={submit}>
              <ArrowUpIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
