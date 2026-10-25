// SettingsPage — 整页设置（ZCode / JetBrains New UI 形态：左导航分区 + 右内容面）。
// 分区：常规（主题/界面字号，即时生效免重启）、模型设置（提供商端点，保存重启引擎）、
// 能力目录（模式 / 插件 / 提示词 / 工具集 / 子代理 / MCP / 技能，引擎只读数据，
// 实现在 ./settings/）、关于（版本 / 引擎状态）。settingsOpen 由侧栏底部齿轮触发。
//
// 能力目录的详情页用卡片互相引用（模式 → 插件 → 技能 …），跳转走路由栈：
// 返回逐级弹栈，点左栏分区重置栈。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MinusIcon, PlusIcon, XIcon } from 'lucide-react';
import { useApp } from './appState';
import { AgentAvatar } from './agentIcon';
import { engine } from '../protocol';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { cn } from '../components/lib/utils';
import { CatalogProvider } from './settings/catalog';
import { NavContext, TAB_GROUPS, TABS, type Nav, type Route, type Tab } from './settings/nav';
import { ModesTab } from './settings/ModesTab';
import { PluginsTab } from './settings/PluginsTab';
import { PromptsTab } from './settings/PromptsTab';
import { ToolsetsTab } from './settings/ToolsetsTab';
import { AgentsTab } from './settings/AgentsTab';
import { McpTab } from './settings/McpTab';
import { SkillsTab } from './settings/SkillsTab';

interface EngineConfig {
  binary?: string;
  addr?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  autoStart?: boolean;
  mode?: string;
}
/** 供应商档案：一份 OpenAI 兼容端点配置；激活的那份同步进 engine.* 供引擎启动。 */
interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}
type Cfg = {
  engine?: EngineConfig;
  providers?: ProviderProfile[];
  activeProvider?: string;
  theme?: string;
  uiFontSize?: number;
} & Record<string, unknown>;

/** 预设供应商（OpenAI 兼容 chat/completions 端点；一键填名称与地址，模型列表在线拉取）。 */
const PROVIDER_PRESETS: Array<{ name: string; baseUrl: string }> = [
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: 'Z.ai', baseUrl: 'https://api.z.ai/api/paas/v4' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1' },
  { name: '阿里百炼 Qwen', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
  { name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1' },
  { name: '小米 MiMo', baseUrl: 'https://api.xiaomimimo.com/v1' },
  { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1' },
];

/** 描述字段行：label + 控件 + 辅助说明（JetBrains 设置行的节奏）。 */
function Field({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-ui-base font-normal text-foreground-subtle">{label}</Label>
      {children}
      {hint && <p className="text-ui-sm text-foreground-subtlest">{hint}</p>}
    </div>
  );
}

/** 分组标题（内容面内的一级节）。 */
function Section({ title, desc, children }: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="text-ui-base font-semibold text-foreground">{title}</h2>
        {desc && <p className="mt-0.5 text-ui-sm text-foreground-subtlest">{desc}</p>}
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

/** 分段选择钮（主题 / 字号这类互斥小选项；JetBrains segmented button 质感）。 */
function Segmented<T extends string | number>({ value, options, onChange }: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange(v: T): void;
}) {
  return (
    <div className="inline-flex w-fit rounded-lg border border-border bg-input p-0.5" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value}
          className={cn(
            'rounded-md px-3 py-1 text-ui-base transition-colors',
            o.value === value
              ? 'bg-selected text-foreground shadow-xs'
              : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
          )}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 能力目录分区的标题与一句话（详情页不显示，让位给详情自己的标题）。 */
const CATALOG_SECTIONS: Partial<Record<Tab, { title: string; desc: string }>> = {
  modes: { title: '智能体', desc: '一组插件 + 一套指令 = 一种工作者。对话里随时切换。' },
  plugins: { title: '插件', desc: '能力包：工具、技能、子代理、MCP 与右栏面板。打开开关即可加进智能体。' },
  prompts: { title: '提示词', desc: '智能体的系统提示词组与插件携带的领域规范。' },
  toolsets: { title: '工具集', desc: '引擎内置的原生工具，由插件引用。' },
  agents: { title: '子代理', desc: '插件携带的只读助手，智能体把检索类任务委派给它们。' },
  mcp: { title: 'MCP', desc: '插件声明的外部工具服务及其连接状态。' },
  skills: { title: '技能', desc: '智能体按需加载的操作知识。' },
};

export function SettingsPage() {
  const { settingsOpen, setSettingsOpen, settingsRoute, engineStatus, defaultMode, saveDefaultMode, modes } = useApp();
  const [stack, setStack] = useState<Route[]>([{ tab: 'general' }]);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  // 供应商编辑：正在新增/修改的档案草稿；formModels 是该端点拉到的模型列表
  const [editing, setEditing] = useState<ProviderProfile | null>(null);
  const [formModels, setFormModels] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // 'id:<pid>' | 'preset:<name>' | 'custom'
  const scrollRef = useRef<HTMLDivElement>(null);

  const route = stack[stack.length - 1] ?? { tab: 'general' };
  const tab = route.tab;
  const nav = useMemo<Nav>(() => ({
    route,
    prev: stack[stack.length - 2] ?? null,
    go: (t, id) => setStack((s) => [...s, { tab: t, id }]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : [{ tab: s[0]?.tab ?? 'general' }])),
    replace: (t, id) => setStack((s) => [...s.slice(0, -1), { tab: t, id }]),
  }), [route, stack]);

  // 换页回到顶部（详情页之间跳转时尤其需要）
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [route]);

  useEffect(() => {
    if (settingsOpen) {
      setStack(settingsRoute ? [{ tab: settingsRoute.tab }, ...(settingsRoute.id ? [settingsRoute] : [])] : [{ tab: 'general' }]);
      window.amc.config.get().then(setCfg).catch(() => {});
    }
  }, [settingsOpen, settingsRoute]);

  const close = useCallback((open: boolean): void => {
    if (!saving) setSettingsOpen(open);
  }, [saving, setSettingsOpen]);

  // Esc 关闭（保存中不关）
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsOpen, close]);

  // —— 以下派生与 hook 必须在早退 return 之前（hooks 无条件注册）——
  const eng = cfg?.engine || {};
  // 供应商档案：首次进入从旧的单供应商 engine 字段播种（向后兼容）。
  const providers: ProviderProfile[] = cfg?.providers?.length
    ? cfg.providers
    : (eng.baseUrl
      ? [{ id: 'default', name: '默认供应商', baseUrl: eng.baseUrl, apiKey: eng.apiKey || '', model: eng.model || '', contextWindow: eng.contextWindow, maxOutputTokens: eng.maxOutputTokens }]
      : []);
  const activeId = cfg?.activeProvider || providers[0]?.id || '';

  // 进入模型页时默认选中当前使用中的供应商
  useEffect(() => {
    if (!settingsOpen || !cfg || tab !== 'model' || selectedKey || !providers.length) return;
    const p = providers.find((x) => x.id === activeId) ?? providers[0];
    if (p) {
      setEditing({ ...p });
      setSelectedKey(`id:${p.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen, tab, selectedKey, activeId]);

  if (!settingsOpen || !cfg) return null;

  /** 写回供应商列表并同步激活档案到 engine.*（contextWindow 等是启动期参数，restart 时生效）。 */
  const persistProviders = async (next: ProviderProfile[], active: string, restart: boolean): Promise<void> => {
    const cur = next.find((p) => p.id === active) ?? next[0];
    const nextCfg: Cfg = {
      ...cfg,
      providers: next,
      activeProvider: cur?.id,
      engine: {
        ...eng,
        baseUrl: cur?.baseUrl,
        apiKey: cur?.apiKey,
        model: cur?.model,
        contextWindow: Number(cur?.contextWindow) || 1_000_000,
        maxOutputTokens: Number(cur?.maxOutputTokens) || undefined,
      },
    };
    setCfg(nextCfg);
    await window.amc.config.save(nextCfg as Record<string, unknown>);
    if (restart) await engine.restart();
  };

  const saveEditing = async (activate: boolean): Promise<void> => {
    if (!editing) return;
    const next = providers.some((p) => p.id === editing.id)
      ? providers.map((p) => (p.id === editing.id ? editing : p))
      : [...providers, editing];
    setSaving(true);
    try {
      await persistProviders(next, activate ? editing.id : activeId, activate);
      setSelectedKey(`id:${editing.id}`); // 新增/接入后导航落到已配置分组
      setEditing(null);
      setFormModels([]);
    } finally {
      setSaving(false);
    }
  };

  const removeProvider = async (id: string): Promise<void> => {
    const next = providers.filter((p) => p.id !== id);
    const wasActive = id === activeId;
    setSaving(true);
    try {
      await persistProviders(next, wasActive ? (next[0]?.id ?? '') : activeId, wasActive);
    } finally {
      setSaving(false);
    }
  };

  const fetchFormModels = async (): Promise<void> => {
    if (!editing?.baseUrl) return;
    setTesting(true);
    setTestResult('');
    try {
      const list = await window.amc.engine.fetchModels({ baseUrl: editing.baseUrl, apiKey: editing.apiKey });
      const n = Array.isArray(list) ? list.length : 0;
      setFormModels(Array.isArray(list) ? list : []);
      setTestResult(n ? `连接正常，可用模型 ${n} 个` : '端点可达，但未返回模型列表');
    } catch (e) {
      setTestResult(`连接失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  // 未配置的预置（baseUrl 未出现在已配置列表里）
  const unconfiguredPresets = PROVIDER_PRESETS.filter((pr) => !providers.some((p) => p.baseUrl === pr.baseUrl));
  const isPresetDraft = !!editing && !providers.some((p) => p.id === editing.id) && selectedKey?.startsWith('preset:');
  const isCustomDraft = !!editing && !providers.some((p) => p.id === editing.id) && selectedKey === 'custom';

  const openExisting = (p: ProviderProfile): void => {
    setEditing({ ...p });
    setFormModels([]);
    setTestResult('');
    setSelectedKey(`id:${p.id}`);
  };
  const openPreset = (preset: { name: string; baseUrl: string }): void => {
    setEditing({ id: `prov-${Date.now()}`, name: preset.name, baseUrl: preset.baseUrl, apiKey: '', model: '', contextWindow: 1_000_000 });
    setFormModels([]);
    setTestResult('');
    setSelectedKey(`preset:${preset.name}`);
  };
  const openCustom = (): void => {
    setEditing({ id: `prov-${Date.now()}`, name: '', baseUrl: '', apiKey: '', model: '', contextWindow: 1_000_000 });
    setFormModels([]);
    setTestResult('');
    setSelectedKey('custom');
  };

  /** 即时生效项（主题/字号）：写 config + 立刻应用，引擎不重启。 */
  const patchLive = async (patch: Partial<Cfg>): Promise<void> => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    if (patch.theme !== undefined) {
      document.documentElement.classList.toggle('dark', patch.theme === 'dark');
    }
    if (patch.uiFontSize !== undefined) {
      document.documentElement.style.setProperty('--ui-font-size', `${patch.uiFontSize}px`);
    }
    try { await window.amc.config.save(next as Record<string, unknown>); } catch { /* 磁盘异常：本次会话仍生效 */ }
  };

  /** 默认模式：只写 config（模式按项目生效，会话级装配，不重启引擎）。 */
  const setDefault = async (id: string): Promise<void> => {
    await saveDefaultMode(id);
    setCfg((c) => (c ? { ...c, engine: { ...c.engine, mode: id } } : c));
  };

  const stepFont = (d: number): void => {
    const v = Math.min(18, Math.max(12, (cfg.uiFontSize ?? 14) + d));
    if (v !== cfg.uiFontSize) void patchLive({ uiFontSize: v });
  };

  const catalogSection = CATALOG_SECTIONS[tab];
  const catalogBody = (
    <>
      {tab === 'modes' && <ModesTab defaultMode={defaultMode} onSetDefault={(id) => void setDefault(id)} />}
      {tab === 'plugins' && <PluginsTab />}
      {tab === 'prompts' && <PromptsTab />}
      {tab === 'toolsets' && <ToolsetsTab />}
      {tab === 'agents' && <AgentsTab />}
      {tab === 'mcp' && <McpTab />}
      {tab === 'skills' && <SkillsTab />}
    </>
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background [app-region:no-drag]">
      {/* 页头：与 TitleBar 同节奏（h-12 + 下边框），右端关闭钮 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 px-4">
        <span className="text-ui-base font-semibold text-foreground">设置</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭设置"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => close(false)}>
          <XIcon />
        </Button>
      </header>

      <CatalogProvider>
        <NavContext.Provider value={nav}>
          <div className="flex min-h-0 flex-1">
            {/* 左导航：分组；点分区重置路由栈 */}
            <nav className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/50 p-2">
              {TAB_GROUPS.map((g) => (
                <div key={g.title || 'tail'} className={cn('grid gap-0.5', g.title ? 'mb-2' : 'mt-auto border-t border-border/50 pt-2')}>
                  {g.title && <div className="px-2.5 pb-0.5 pt-1 text-ui-xs font-medium text-foreground-subtlest">{g.title}</div>}
                  {g.tabs.map((id) => {
                    const t = TABS.find((x) => x.id === id)!;
                    const Icon = t.icon;
                    return (
                      <button key={t.id} type="button"
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-ui-base transition-colors',
                          tab === t.id
                            ? 'bg-selected font-medium text-foreground'
                            : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
                        )}
                        onClick={() => setStack([{ tab: t.id }])}>
                        <Icon className="size-4 shrink-0" />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            {/* 内容面 */}
            <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto grid max-w-3xl gap-8 p-6">
                {tab === 'general' && (
                  <Section title="常规" desc="外观偏好即时生效，无需重启。">
                    <Field label="主题">
                      <Segmented
                        value={cfg.theme ?? 'dark'}
                        options={[
                          { value: 'dark', label: '深色' },
                          { value: 'light', label: '浅色' },
                        ]}
                        onChange={(v) => void patchLive({ theme: v })} />
                    </Field>
                    <Field label="界面字号" hint="仅正文与控件文字随动，图标与间距不变。">
                      <div className="flex items-center gap-1">
                        <Button type="button" variant="outline" size="icon-sm" aria-label="减小字号"
                          onClick={() => stepFont(-1)}>
                          <MinusIcon />
                        </Button>
                        <span className="w-12 text-center text-ui-base tabular-nums text-foreground">
                          {cfg.uiFontSize ?? 14}px
                        </span>
                        <Button type="button" variant="outline" size="icon-sm" aria-label="增大字号"
                          onClick={() => stepFont(1)}>
                          <PlusIcon />
                        </Button>
                      </div>
                    </Field>
                    {modes.length > 0 && (
                      <Field label="默认智能体" hint="新项目与没有记录过智能体的项目，开新对话时默认交给它。">
                        <div className="flex flex-wrap gap-1.5">
                          {modes.map((m) => (
                            <button key={m.id} type="button" onClick={() => void setDefault(m.id)}
                              className={cn('flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-ui-base transition-colors',
                                m.id === defaultMode ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}>
                              <AgentAvatar icon={m.icon} size="sm" className="rounded-full" />
                              {m.name}
                            </button>
                          ))}
                        </div>
                      </Field>
                    )}
                  </Section>
                )}

                {tab === 'model' && (
                  <Section
                    title="模型供应商"
                    desc="管理多个 OpenAI 兼容端点（中转 / 官方 / 本地）。对话中可在输入框右下角临时切换模型与思考档位。">
                    <div className="grid grid-cols-[13rem_1fr] gap-5">
                      {/* 左：供应商导航（预置 / 已配置，对齐 ZCode 的分组导航） */}
                      <div className="flex min-w-0 flex-col gap-1 border-r border-border pr-3">
                        {providers.length > 0 && (
                          <div className="px-2 pb-1 text-ui-xs font-medium tracking-wider text-foreground-subtlest">已配置</div>
                        )}
                        {providers.map((p) => (
                          <button key={p.id} type="button"
                            onClick={() => openExisting(p)}
                            className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-base transition-colors',
                              selectedKey === `id:${p.id}` ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover hover:text-foreground')}>
                            <span className={cn('size-1.5 shrink-0 rounded-full', p.id === activeId ? 'bg-brand' : 'bg-border')} />
                            <span className="min-w-0 flex-1 truncate">{p.name || p.baseUrl}</span>
                            {p.id === activeId && <span className="shrink-0 text-ui-xs text-brand">使用中</span>}
                          </button>
                        ))}
                        {unconfiguredPresets.length > 0 && (
                          <div className="px-2 pb-1 pt-3 text-ui-xs font-medium tracking-wider text-foreground-subtlest">预置供应商</div>
                        )}
                        {unconfiguredPresets.map((preset) => (
                          <button key={preset.name} type="button" title={preset.baseUrl}
                            onClick={() => openPreset(preset)}
                            className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-base transition-colors',
                              selectedKey === `preset:${preset.name}` ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover hover:text-foreground')}>
                            <span className="size-1.5 shrink-0 rounded-full bg-border" />
                            <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                          </button>
                        ))}
                        <button type="button"
                          onClick={openCustom}
                          className={cn('mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-base transition-colors',
                            selectedKey === 'custom' ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover hover:text-foreground')}>
                          <PlusIcon className="size-3.5 shrink-0" />
                          自定义供应商
                        </button>
                      </div>

                      {/* 右：详情表单 */}
                      {editing ? (
                        <div className="flex min-w-0 flex-col gap-3">
                          <div className="flex items-center gap-2">
                            <span className="text-ui-base font-semibold text-foreground">
                              {editing.name || '新供应商'}
                            </span>
                            {editing.id === activeId && (
                              <span className="rounded-full bg-brand/15 px-2 py-0.5 text-ui-xs font-medium text-brand">使用中</span>
                            )}
                          </div>
                          {!providers.some((p) => p.id === editing.id) && !isCustomDraft && (
                            <p className="text-ui-sm text-foreground-subtlest">
                              填入 API Key 并选择模型即可接入；接入后可在对话中直接使用。
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="名称" hint="显示在左下角与切换菜单里">
                              <Input value={editing.name} placeholder="如 智谱 / OpenRouter / 本地"
                                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                            </Field>
                            <Field label="API Key" hint="仅保存在本机配置文件">
                              <Input type="password" value={editing.apiKey} placeholder="sk-…"
                                onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} />
                            </Field>
                          </div>
                          <Field label="API 地址" hint="OpenAI 兼容的 chat/completions 端点（以 /v1 结尾）">
                            <Input value={editing.baseUrl} placeholder="https://…/v1"
                              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} />
                          </Field>
                          <Field label="默认模型" hint="可直接输入，或先「获取模型列表」再从下拉里选">
                            <div className="flex items-center gap-2">
                              <Input list="provider-model-options" value={editing.model} placeholder="如 glm-5.3-flashx"
                                onChange={(e) => setEditing({ ...editing, model: e.target.value })} />
                              <datalist id="provider-model-options">
                                {formModels.map((m) => <option key={m} value={m} />)}
                              </datalist>
                              <Button type="button" variant="outline" className="shrink-0" disabled={testing || !editing.baseUrl}
                                onClick={() => void fetchFormModels()}>
                                {testing ? '获取中…' : '获取模型列表'}
                              </Button>
                            </div>
                          </Field>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="上下文窗口（token）" hint="决定压缩阈值，须与真实模型一致">
                              <Input type="number" value={String(editing.contextWindow ?? 1_000_000)}
                                onChange={(e) => setEditing({ ...editing, contextWindow: Number(e.target.value) })} />
                            </Field>
                            <Field label="最大输出（token）" hint="推理模型的思考也占此额度">
                              <Input type="number" value={String(editing.maxOutputTokens ?? '')}
                                onChange={(e) => setEditing({ ...editing, maxOutputTokens: Number(e.target.value) || undefined })} />
                            </Field>
                          </div>
                          <div className="flex items-center gap-2.5 border-t border-border pt-3">
                            {isPresetDraft ? (
                              <Button type="button" disabled={saving || !editing.baseUrl || !editing.model}
                                onClick={() => void saveEditing(true)}>
                                {saving ? '接入中…' : '连接并使用'}
                              </Button>
                            ) : (
                              <>
                                <Button type="button" disabled={saving || !editing.baseUrl || !editing.model}
                                  onClick={() => void saveEditing(editing.id !== activeId)}>
                                  {saving ? '保存中…' : editing.id === activeId ? '保存更改' : '保存并使用'}
                                </Button>
                                {editing.id !== activeId && (
                                  <Button type="button" variant="outline" disabled={saving || !editing.baseUrl}
                                    onClick={() => void saveEditing(false)}>
                                    仅保存
                                  </Button>
                                )}
                                {providers.length > 1 && (
                                  <Button type="button" variant="ghost" disabled={saving}
                                    className="ml-auto text-destructive hover:text-destructive"
                                    onClick={() => { void removeProvider(editing.id); setSelectedKey(null); }}>
                                    删除此供应商
                                  </Button>
                                )}
                              </>
                            )}
                            {testResult && (
                              <span className={cn('text-ui-sm', testResult.startsWith('连接正常') ? 'text-success' : 'text-destructive')}>
                                {testResult}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-ui-sm text-foreground-subtlest">从左侧选择一个供应商，或添加自定义端点。</div>
                      )}
                    </div>
                  </Section>
                )}

                {catalogSection && (route.id
                  ? catalogBody
                  : <Section title={catalogSection.title} desc={catalogSection.desc}>{catalogBody}</Section>)}

                {tab === 'about' && (
                  <Section title="关于">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-ui-lg font-bold text-primary-foreground">Y</span>
                      <div>
                        <div className="text-ui-base font-semibold text-foreground">YCode</div>
                        <div className="text-ui-sm text-foreground-subtlest">版本 0.1.0 · 桌面 AI 智能体工作台</div>
                      </div>
                    </div>
                    <div className="mt-1 grid gap-2 rounded-xl border border-border bg-card p-3 text-ui-base">
                      <div className="flex justify-between gap-4">
                        <span className="text-foreground-subtle">引擎状态</span>
                        <span className="text-foreground">{engineStatus.status === 'running' ? '运行中' : engineStatus.status}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-foreground-subtle">引擎地址</span>
                        <span className="truncate font-mono text-foreground">{engineStatus.addr || '—'}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-foreground-subtle">引擎程序</span>
                        <span className="min-w-0 truncate font-mono text-foreground" title={eng.binary}>{eng.binary || '—'}</span>
                      </div>
                    </div>
                    <p className="text-ui-sm text-foreground-subtlest">
                      本产品聚合了多个开源组件，许可声明见安装目录 THIRD-PARTY-NOTICES.md。
                    </p>
                  </Section>
                )}
              </div>
            </div>
          </div>
        </NavContext.Provider>
      </CatalogProvider>
    </div>
  );
}
