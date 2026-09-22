// SettingsPage — 整页设置（ZCode / JetBrains New UI 形态：左导航分区 + 右内容面）。
// 三分区：常规（主题/界面字号，即时生效免重启）、模型设置（提供商端点，保存重启引擎）、
// 关于（版本 / 引擎状态 / 目录信息）。settingsOpen 由侧栏底部齿轮触发。
import { useCallback, useEffect, useState } from 'react';
import {
  CheckIcon, CpuIcon, InfoIcon, MinusIcon, PlusIcon, Settings2Icon, XIcon,
} from 'lucide-react';
import { useApp } from './appState';
import { engine } from '../protocol';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { cn } from '../components/lib/utils';

type Tab = 'general' | 'model' | 'about';

const TABS: Array<{ id: Tab; label: string; icon: typeof Settings2Icon }> = [
  { id: 'general', label: '常规', icon: Settings2Icon },
  { id: 'model', label: '模型设置', icon: CpuIcon },
  { id: 'about', label: '关于', icon: InfoIcon },
];

interface EngineConfig {
  binary?: string;
  addr?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  autoStart?: boolean;
}
type Cfg = {
  engine?: EngineConfig;
  theme?: string;
  uiFontSize?: number;
  knowledgeDir?: string;
} & Record<string, unknown>;

/** 描述字段行：label + 控件 + 辅助说明（JetBrains 设置行的节奏）。 */
function Field({ label, hint, children }: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-ui-sm font-normal text-foreground-subtle">{label}</Label>
      {children}
      {hint && <p className="text-ui-xs text-foreground-subtlest">{hint}</p>}
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
        {desc && <p className="mt-0.5 text-ui-xs text-foreground-subtlest">{desc}</p>}
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
            'rounded-md px-3 py-1 text-ui-sm transition-colors',
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

export function SettingsPage() {
  const { settingsOpen, setSettingsOpen, engineStatus } = useApp();
  const [tab, setTab] = useState<Tab>('general');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  useEffect(() => {
    if (settingsOpen) {
      setTab('general');
      window.amc.config.get().then(setCfg).catch(() => {});
    }
  }, [settingsOpen]);

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

  if (!settingsOpen || !cfg) return null;

  const eng = cfg.engine || {};

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

  /** 模型设置：保存需重启引擎（contextWindow / maxOutputTokens 是启动期参数）。 */
  const saveEngine = async (): Promise<void> => {
    setSaving(true);
    try {
      await window.amc.config.save({
        ...cfg,
        engine: {
          ...eng,
          contextWindow: Number(eng.contextWindow) || 1_000_000,
          maxOutputTokens: Number(eng.maxOutputTokens) || undefined,
        },
      });
      await engine.restart();
      close(false);
    } finally {
      setSaving(false);
    }
  };

  /** 端点连通性：拉一次 /models（主进程转发，key 不进渲染层）。 */
  const testConnection = async (): Promise<void> => {
    setTesting(true);
    setTestResult('');
    try {
      const list = await window.amc.engine.listModels();
      const n = Array.isArray(list) ? list.length : 0;
      setTestResult(n ? `✓ 连接正常，可用模型 ${n} 个` : '端点可达，但未返回模型列表');
    } catch (e) {
      setTestResult(`✗ 连接失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTesting(false);
    }
  };

  const stepFont = (d: number): void => {
    const v = Math.min(18, Math.max(12, (cfg.uiFontSize ?? 14) + d));
    if (v !== cfg.uiFontSize) void patchLive({ uiFontSize: v });
  };

  const field = (label: string, k: keyof EngineConfig, ph: string, type = 'text', hint?: string): React.ReactNode => (
    <Field label={label} hint={hint}>
      <Input type={type} placeholder={ph} value={String(eng[k] ?? '')}
        onChange={(e) => setCfg({ ...cfg, engine: { ...eng, [k]: e.target.value } })} />
    </Field>
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background [app-region:no-drag]">
      {/* 页头：与 TitleBar 同节奏（h-12 + 下边框），右端关闭钮 */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/50 px-4">
        <span className="text-ui-sm font-semibold text-foreground">设置</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭设置"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => close(false)}>
          <XIcon />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 左导航 */}
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border/50 p-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} type="button"
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-ui-sm transition-colors',
                  tab === t.id
                    ? 'bg-selected font-medium text-foreground'
                    : 'text-foreground-subtle hover:bg-hover hover:text-foreground',
                )}
                onClick={() => setTab(t.id)}>
                <Icon className="size-4 shrink-0" />
                {t.label}
                {tab === t.id && <CheckIcon className="ml-auto size-3.5 shrink-0 text-brand" />}
              </button>
            );
          })}
        </nav>

        {/* 内容面 */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid max-w-2xl gap-8 p-6">
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
                    <span className="w-12 text-center text-ui-sm tabular-nums text-foreground">
                      {cfg.uiFontSize ?? 14}px
                    </span>
                    <Button type="button" variant="outline" size="icon-sm" aria-label="增大字号"
                      onClick={() => stepFont(1)}>
                      <PlusIcon />
                    </Button>
                  </div>
                </Field>
              </Section>
            )}

            {tab === 'model' && (
              <Section
                title="模型设置"
                desc="OpenAI 兼容端点；保存后自动重启引擎生效。对话中可在输入框右下角临时切换模型（无需重启）。">
                {field('API 地址', 'baseUrl', 'https://…/v1', 'text', 'OpenAI 兼容的 chat/completions 端点')}
                {field('API Key', 'apiKey', 'sk-…', 'password', '仅保存在本机配置文件，随请求发往该端点')}
                {field('默认模型', 'model', 'DeepSeek-V4.1-Flash', 'text', '引擎启动时加载的模型；运行中可临时切换')}
                {field('上下文窗口（token）', 'contextWindow', '1000000', 'number')}
                {field('最大输出（token）', 'maxOutputTokens', '393216', 'number', '推理模型的思考过程也占此额度')}

                <div className="flex items-center gap-3 pt-1">
                  <Button type="button" variant="outline" disabled={testing}
                    onClick={() => void testConnection()}>
                    {testing ? '检测中…' : '测试连接'}
                  </Button>
                  <Button type="button" disabled={saving} onClick={() => void saveEngine()}>
                    {saving ? '保存并重启引擎…' : '保存并重启引擎'}
                  </Button>
                  {testResult && (
                    <span className={cn(
                      'text-ui-xs',
                      testResult.startsWith('✓') ? 'text-success' : 'text-destructive',
                    )}>
                      {testResult}
                    </span>
                  )}
                </div>
              </Section>
            )}

            {tab === 'about' && (
              <Section title="关于">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-ui-lg font-bold text-primary-foreground">A</span>
                  <div>
                    <div className="text-ui-base font-semibold text-foreground">amobileCreater</div>
                    <div className="text-ui-xs text-foreground-subtlest">版本 0.1.0 · 描述想法，AI 自动开发 Flutter App 并上真机测试</div>
                  </div>
                </div>
                <div className="mt-1 grid gap-2 rounded-xl border border-border bg-card p-3 text-ui-sm">
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
                  <div className="flex justify-between gap-4">
                    <span className="text-foreground-subtle">知识库</span>
                    <span className="min-w-0 truncate font-mono text-foreground" title={cfg.knowledgeDir}>{cfg.knowledgeDir || '—'}</span>
                  </div>
                </div>
                <p className="text-ui-xs text-foreground-subtlest">
                  本产品聚合了多个开源组件，许可声明见安装目录 THIRD-PARTY-NOTICES.md。
                </p>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
