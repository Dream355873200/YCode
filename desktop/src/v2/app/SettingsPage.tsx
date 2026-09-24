// SettingsPage — 整页设置（ZCode / JetBrains New UI 形态：左导航分区 + 右内容面）。
// 三分区：常规（主题/界面字号，即时生效免重启）、模型设置（提供商端点，保存重启引擎）、
// 关于（版本 / 引擎状态 / 目录信息）。settingsOpen 由侧栏底部齿轮触发。
import { useCallback, useEffect, useState } from 'react';
import {
  BlocksIcon, CheckIcon, ChevronLeftIcon, CpuIcon, FileTextIcon, InfoIcon, MinusIcon, PlusIcon,
  PuzzleIcon, RotateCwIcon, SearchIcon, Settings2Icon, ShapesIcon, SparklesIcon,
  CableIcon, XIcon,
} from 'lucide-react';
import { useApp } from './appState';
import type { MCPServerDecl, ModeDecl } from './modeRegistry';
import { engine } from '../protocol';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { cn } from '../components/lib/utils';

type Tab = 'general' | 'model' | 'modes' | 'toolsets' | 'plugins' | 'skills' | 'prompts' | 'mcp' | 'about';

const TABS: Array<{ id: Tab; label: string; icon: typeof Settings2Icon }> = [
  { id: 'general', label: '常规', icon: Settings2Icon },
  { id: 'model', label: '模型设置', icon: CpuIcon },
  { id: 'modes', label: '模式', icon: ShapesIcon },
  { id: 'toolsets', label: '工具集', icon: BlocksIcon },
  { id: 'plugins', label: '插件', icon: PuzzleIcon },
  { id: 'skills', label: '技能', icon: SparklesIcon },
  { id: 'prompts', label: '提示词', icon: FileTextIcon },
  { id: 'mcp', label: 'MCP', icon: CableIcon },
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
  mode?: string;
}
type Cfg = {
  engine?: EngineConfig;
  theme?: string;
  uiFontSize?: number;
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

// ---------- 能力资源分区（模式/插件/技能/MCP）----------
// 对齐成熟 IDE 设置页的资源组节奏：组头（标题+计数+操作）→ 圆角列表容器
// （行间细分隔线）→ 行（图标块 | 名称+描述 | 右侧徽标/操作），hover 高亮。

/** 引擎只读资源拉取（tab 激活时取，手动刷新）。body 为响应全文（附带段用）。 */
function useEngineList<T>(path: string, enabled: boolean): {
  items: T[];
  body: Record<string, unknown> | null;
  loading: boolean;
  error: string;
  refresh(): void;
} {
  const [items, setItems] = useState<T[]>([]);
  const [body, setBody] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    setError('');
    engine.get(path).then((r) => {
      if (!alive) return;
      const b = (r.body as Record<string, unknown> | undefined) ?? null;
      setBody(b);
      const key = path.replace(/^\//, '');
      const list = Array.isArray(b) ? b : ((b?.[key] as T[] | undefined) ?? []);
      setItems(list);
    }).catch((e: unknown) => {
      if (alive) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, enabled, tick]);
  return { items, body, loading, error, refresh: () => setTick((t) => t + 1) };
}

/** 资源组头：标题 + 计数 + 右侧操作（刷新等）。 */
function GroupHeader({ title, count, actions }: {
  title: string; count: number; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex h-7 items-center gap-1.5 text-ui-base font-medium text-foreground">
        {title}
        <span className="text-ui-sm font-normal text-foreground-subtle">{count}</span>
      </h3>
      {actions}
    </div>
  );
}

/** 资源列表容器：圆角面 + 行间细分隔线（与 ZCode 资源组同节奏）。 */
function ResourceList({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-surface">
      {Array.isArray(children) ? children.map((child, i) => (
        <div key={i}>
          {i > 0 && <div className="h-px bg-border/50" aria-hidden="true" />}
          {child}
        </div>
      )) : children}
    </div>
  );
}

/** 作用域徽标（项目 / 应用 / 插件——图标 + 圆角胶囊，与 ZCode scope badge 同构）。 */
function ScopeChip({ scope }: { scope: 'project' | 'user' | 'builtin' | 'plugin' }) {
  const map = {
    project: { label: '项目', cls: '' },
    user: { label: '应用', cls: '' },
    builtin: { label: '内置', cls: '' },
    plugin: { label: '插件', cls: '' },
  } as const;
  const s = map[scope];
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-2 py-0.5 text-ui-2xs text-foreground-subtle',
      s.cls,
    )}>
      {s.label}
    </span>
  );
}

/** 小徽标（能力计数：工具集 N · 技能 · 面板 …）。 */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-surface px-2 py-0.5 text-ui-2xs text-foreground-subtlest">
      {children}
    </span>
  );
}

/** 资源行：图标块 | 名称+描述 | 右侧内容。 */
function ResourceRow({ icon, name, desc, right, onClick }: {
  icon: React.ReactNode;
  name: string;
  desc?: string;
  right?: React.ReactNode;
  onClick?(): void;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors',
        onClick && 'cursor-pointer hover:bg-hover',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background text-foreground-subtle">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-ui-base font-medium text-foreground">{name}</div>
        {desc && <div className="mt-0.5 truncate text-ui-sm text-foreground-subtle">{desc}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{right}</div>
    </div>
  );
}

/** 分区空态（居中提示卡）。 */
function EmptyHint({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="text-foreground-subtlest">{icon}</span>
      <div className="text-ui-sm font-medium text-foreground-subtle">{title}</div>
      <div className="max-w-md text-ui-xs text-foreground-subtlest">{desc}</div>
    </div>
  );
}

interface PluginItem {
  id: string;
  name: string;
  description?: string;
  toolsets?: string[];
  rules?: string;
  skills?: string;
  agents?: string;
  mcpServers?: MCPServerDecl[];
  sidePanels?: Array<{ id: string; label: string }>;
  dir: string;
  usedBy: string[];
}
interface SkillItem {
  name: string;
  description?: string;
  whenToUse?: string;
  origin: 'plugin' | 'global';
  plugin?: string;
  filePath?: string;
}
interface PromptGroupItem {
  name: string;
  files?: string[];
  usedBy: string[];
}
/** /modes 附带的 toolset 明细：id → 工具名 + 非工具资产说明。 */
type ToolsetsDetail = Record<string, { tools?: string[]; notes?: string[] }>;

/** MCP 声明的一行摘要（stdio 命令行或远程 url）。 */
const mcpSummary = (s: MCPServerDecl): string =>
  s.url || [s.command, ...(s.args ?? [])].filter(Boolean).join(' ');

/** 技能行列表（详情页「技能」组）。 */
function SkillLines({ skills, empty }: { skills: SkillItem[]; empty: string }) {
  if (skills.length === 0) return <span className="text-ui-sm text-foreground-subtlest">{empty}</span>;
  return (
    <>
      {skills.map((s) => (
        <div key={s.filePath || s.name} className="min-w-0">
          <div className="flex items-center gap-1.5 text-ui-sm font-medium text-foreground">
            {s.name}
            <Chip>{s.origin === 'plugin' ? s.plugin : '全局'}</Chip>
          </div>
          <div className="truncate text-ui-xs text-foreground-subtlest">{s.description || s.whenToUse || '（无描述）'}</div>
        </div>
      ))}
    </>
  );
}

/** 键值信息行（详情页「装配」组里的 definition list）。 */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3">
      <span className="text-ui-xs text-foreground-subtlest">{label}</span>
      <div className="min-w-0 text-ui-sm text-foreground">{children}</div>
    </div>
  );
}

/** 详情页骨架：返回面包屑 + 图标标题 + 描述 + 分区组。 */
function DetailFrame({ backLabel, onBack, icon, title, desc, children }: {
  backLabel: string;
  onBack(): void;
  icon: React.ReactNode;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="ghost" size="sm"
          className="-ml-2 gap-1 text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={onBack}>
          <ChevronLeftIcon className="size-3.5" />
          {backLabel}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-foreground-subtle">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-ui-base font-semibold text-foreground">{title}</div>
          {desc && <div className="mt-0.5 line-clamp-2 text-ui-xs text-foreground-subtlest">{desc}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

/** 详情页分区（InfoRow 行 + 追加内容）。 */
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-ui-sm font-medium text-foreground">{title}</h3>
      <div className="space-y-2 rounded-xl border border-border/50 bg-surface px-4 py-3">{children}</div>
    </div>
  );
}

/** 路径末段（规范文件等只显示文件名，完整路径放 title）。 */
const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).slice(-2).join('/');

/** 模式详情：组成（提示词组 + 插件）→ 聚合能力（工具 / 规范 / 技能 / MCP / 面板）→ 新建项目。 */
function ModeDetail({ mode, isDefault, onSetDefault, onBack, toolsetsDetail }: {
  mode: ModeDecl;
  isDefault: boolean;
  onSetDefault(id: string): void;
  onBack(): void;
  toolsetsDetail?: ToolsetsDetail;
}) {
  const { items: skills } = useEngineList<SkillItem>('/skills', true);
  const { items: promptGroups } = useEngineList<PromptGroupItem>('/prompts', true);
  // 会话可见技能 = 引用插件的技能 + 全局技能（同名时插件优先，与引擎一致）
  const modeSkills = skills.filter((s) =>
    s.origin === 'global' || (s.plugin !== undefined && mode.plugins.includes(s.plugin)));
  const promptGroup = mode.prompts ? promptGroups.find((g) => g.name === mode.prompts) ?? null : null;
  const r = mode.resolved;
  return (
    <DetailFrame
      backLabel="模式"
      onBack={onBack}
      icon={<ShapesIcon className="size-5" />}
      title={mode.name}
      desc={mode.description}>
      {!isDefault && (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => onSetDefault(mode.id)}>
            设为默认模式
          </Button>
        </div>
      )}
      <DetailSection title="组成">
        <InfoRow label="提示词组">
          {mode.prompts ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-mono text-ui-xs">{mode.prompts}</span>
              <Chip>{promptGroup?.files?.length ?? 0} 段覆盖</Chip>
            </span>
          ) : '内置通用 Agent 提示词'}
        </InfoRow>
        {promptGroup?.files?.length ? (
          <div className="flex flex-wrap gap-1.5 pl-[108px]">
            {promptGroup.files.map((f) => (
              <span key={f} className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background px-1.5 py-0.5 font-mono text-ui-2xs text-foreground-subtle">
                <FileTextIcon className="size-3" />{f}
              </span>
            ))}
          </div>
        ) : null}
        <InfoRow label="插件">
          {mode.plugins.length
            ? <span className="flex flex-wrap gap-1.5">{mode.plugins.map((p) => <Chip key={p}>{p}</Chip>)}</span>
            : '无'}
        </InfoRow>
      </DetailSection>
      <DetailSection title="工具">
        <InfoRow label="基础工具">文件读写 / Bash / 检索 / 任务 / 计划 / 提问（所有模式恒可用）</InfoRow>
        {r.toolsets.map((t) => {
          const d = toolsetsDetail?.[t];
          return (
            <div key={t} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-full bg-brand/15 px-2 py-0.5 text-ui-2xs font-medium text-brand">{t}</span>
                {d?.tools?.map((tn) => <Chip key={tn}>{tn}</Chip>)}
              </div>
              {d?.notes?.map((n, i) => (
                <div key={i} className="text-ui-xs text-foreground-subtlest">· {n}</div>
              ))}
            </div>
          );
        })}
      </DetailSection>
      <DetailSection title="领域规范">
        {r.rules.length
          ? r.rules.map((p) => (
            <span key={p} title={p} className="flex items-center gap-1.5 font-mono text-ui-xs text-foreground">
              <FileTextIcon className="size-3.5 shrink-0 text-foreground-subtlest" />{baseName(p)}
            </span>
          ))
          : <span className="text-ui-sm text-foreground-subtlest">无</span>}
      </DetailSection>
      <DetailSection title={`技能（${modeSkills.length}）`}>
        <SkillLines skills={modeSkills} empty="没有可用技能" />
      </DetailSection>
      <DetailSection title="MCP">
        {r.mcpServers.length
          ? r.mcpServers.map((s) => (
            <div key={s.name} className="flex items-center gap-2">
              <span className="text-ui-sm text-foreground">{s.name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-ui-xs text-foreground-subtlest">{mcpSummary(s)}</span>
              <Chip>待接入</Chip>
            </div>
          ))
          : <span className="text-ui-sm text-foreground-subtlest">无</span>}
      </DetailSection>
      <DetailSection title="右栏面板">
        {r.sidePanels.length
          ? r.sidePanels.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3">
              <span className="text-ui-sm text-foreground">{p.label}</span>
              <span className="font-mono text-ui-xs text-foreground-subtlest">{p.id}</span>
            </div>
          ))
          : <span className="text-ui-sm text-foreground-subtlest">无（仅内置 Git / 任务 / 计划）</span>}
      </DetailSection>
      <DetailSection title="新建项目">
        <InfoRow label="脚手架">
          {mode.scaffold ? <span className="font-mono text-ui-xs">{mode.scaffold}</span> : '无（打开已有目录）'}
        </InfoRow>
        {mode.projectFields.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2">
            <span className="text-ui-sm font-medium text-foreground">{f.label}</span>
            <Chip>{f.type}</Chip>
            {f.required ? <Chip>必填</Chip> : null}
            {f.placeholder && (
              <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtlest">{f.placeholder}</span>
            )}
          </div>
        ))}
      </DetailSection>
    </DetailFrame>
  );
}

/** 模式分区：清单 ↔ 详情两级（点行进入详情）。 */
function ModesTab({ defaultMode, onSetDefault }: { defaultMode: string; onSetDefault(id: string): void }) {
  const { items, body, loading, error, refresh } = useEngineList<ModeDecl>('/modes', true);
  const { project, projectMode } = useApp();
  const toolsetsDetail = (body?.toolsets ?? undefined) as ToolsetsDetail | undefined;
  const [selId, setSelId] = useState<string | null>(null);
  const sel = items.find((m) => m.id === selId) ?? null;
  if (error) return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">{error}</div>;
  if (sel) {
    return <ModeDetail mode={sel} isDefault={sel.id === defaultMode} onSetDefault={onSetDefault}
      onBack={() => setSelId(null)} toolsetsDetail={toolsetsDetail} />;
  }
  return (
    <div className="space-y-4">
      <GroupHeader
        title="模式包"
        count={items.length}
        actions={
          <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新" onClick={refresh}
            className="text-foreground-subtle hover:bg-hover hover:text-foreground">
            <RotateCwIcon className="size-3.5" />
          </Button>
        }
      />
      {loading && items.length === 0 ? (
        <div className="px-1 py-6 text-ui-sm text-foreground-subtlest">加载中…</div>
      ) : (
        <ResourceList>
          {items.map((m) => (
            <ResourceRow
              key={m.id}
              icon={<ShapesIcon className="size-4" />}
              name={m.name}
              desc={m.description}
              onClick={() => setSelId(m.id)}
              right={
                <>
                  {project && m.id === projectMode && <Chip>当前项目</Chip>}
                  {m.id === defaultMode && (
                    <span className="inline-flex items-center rounded-full bg-brand/15 px-2 py-0.5 text-ui-2xs font-medium text-brand">
                      默认
                    </span>
                  )}
                </>
              }
            />
          ))}
        </ResourceList>
      )}
      <p className="text-ui-xs text-foreground-subtlest">
        模式 = 提示词组 + 插件组合，按项目生效：标题栏可随时切换当前项目的模式（不重启引擎）；默认模式只决定新建项目的预选。
      </p>
    </div>
  );
}

/** 插件详情：打包的能力（工具集 / 规范 / 技能 / 子代理 / MCP / 面板）+ 被哪些模式引用。 */
function PluginDetail({ plugin, onBack, toolsetsDetail }: {
  plugin: PluginItem;
  onBack(): void;
  toolsetsDetail?: ToolsetsDetail;
}) {
  const { items: skills } = useEngineList<SkillItem>('/skills', true);
  const pluginSkills = skills.filter((s) => s.origin === 'plugin' && s.plugin === plugin.id);
  return (
    <DetailFrame
      backLabel="插件"
      onBack={onBack}
      icon={<PuzzleIcon className="size-5" />}
      title={plugin.name}
      desc={plugin.description}>
      <DetailSection title="清单">
        <InfoRow label="id"><span className="font-mono text-ui-xs">{plugin.id}</span></InfoRow>
        <InfoRow label="目录"><span className="break-all font-mono text-ui-xs">{plugin.dir}</span></InfoRow>
        <InfoRow label="被模式引用">
          {plugin.usedBy.length
            ? <span className="flex flex-wrap gap-1.5">{plugin.usedBy.map((m) => <Chip key={m}>{m}</Chip>)}</span>
            : '未被任何模式引用'}
        </InfoRow>
      </DetailSection>
      <DetailSection title="工具集">
        {plugin.toolsets?.length
          ? plugin.toolsets.map((t) => (
            <div key={t} className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-full bg-brand/15 px-2 py-0.5 text-ui-2xs font-medium text-brand">{t}</span>
              {toolsetsDetail?.[t]?.tools?.map((tn) => <Chip key={tn}>{tn}</Chip>)}
            </div>
          ))
          : <span className="text-ui-sm text-foreground-subtlest">无（纯声明插件）</span>}
      </DetailSection>
      <DetailSection title={`技能（${pluginSkills.length}）`}>
        <SkillLines skills={pluginSkills} empty={plugin.skills ? '技能目录存在但没有发现技能' : '未声明技能目录'} />
      </DetailSection>
      <DetailSection title="声明">
        <InfoRow label="领域规范">
          {plugin.rules ? <span className="font-mono text-ui-xs">{plugin.rules}</span> : '无'}
        </InfoRow>
        <InfoRow label="子代理">
          {plugin.agents ? <span className="font-mono text-ui-xs">{plugin.agents} <Chip>待接入</Chip></span> : '无'}
        </InfoRow>
        <InfoRow label="MCP">
          {plugin.mcpServers?.length
            ? <span className="space-y-1.5">
              {plugin.mcpServers.map((s) => (
                <div key={s.name} className="break-all font-mono text-ui-xs">{s.name}: {mcpSummary(s)} <Chip>待接入</Chip></div>
              ))}
            </span>
            : '无'}
        </InfoRow>
        <InfoRow label="右栏面板">
          {plugin.sidePanels?.length
            ? <span className="flex flex-wrap gap-1.5">{plugin.sidePanels.map((p) => <Chip key={p.id}>{p.label}</Chip>)}</span>
            : '无'}
        </InfoRow>
      </DetailSection>
    </DetailFrame>
  );
}

/** 插件分区：清单 ↔ 详情两级。 */
function PluginsTab() {
  const { items, loading, error, refresh } = useEngineList<PluginItem>('/plugins', true);
  const { body: modesBody } = useEngineList<ModeDecl>('/modes', true);
  const toolsetsDetail = (modesBody?.toolsets ?? undefined) as ToolsetsDetail | undefined;
  const [selId, setSelId] = useState<string | null>(null);
  const sel = items.find((p) => p.id === selId) ?? null;
  if (error) return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">{error}</div>;
  if (sel) return <PluginDetail plugin={sel} onBack={() => setSelId(null)} toolsetsDetail={toolsetsDetail} />;
  return (
    <div className="space-y-4">
      <GroupHeader
        title="已安装插件"
        count={items.length}
        actions={
          <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新" onClick={refresh}
            className="text-foreground-subtle hover:bg-hover hover:text-foreground">
            <RotateCwIcon className="size-3.5" />
          </Button>
        }
      />
      {!loading && items.length === 0 ? (
        <EmptyHint
          icon={<PuzzleIcon className="size-8" />}
          title="还没有插件"
          desc="把能力包放进应用目录 plugins/<id>/（plugin.json 清单，规范见 plugins/README.md），再在模式的 plugins 里引用。"
        />
      ) : loading && items.length === 0 ? (
        <div className="px-1 py-6 text-ui-sm text-foreground-subtlest">加载中…</div>
      ) : (
        <ResourceList>
          {items.map((p) => (
            <ResourceRow
              key={p.id}
              icon={<PuzzleIcon className="size-4" />}
              name={p.name}
              desc={p.description || p.id}
              onClick={() => setSelId(p.id)}
              right={
                <>
                  {(p.toolsets?.length ?? 0) > 0 && <Chip>工具集 ×{p.toolsets!.length}</Chip>}
                  {p.rules && <Chip>规范</Chip>}
                  {p.skills && <Chip>技能</Chip>}
                  {p.agents && <Chip>子代理</Chip>}
                  {(p.mcpServers?.length ?? 0) > 0 && <Chip>MCP ×{p.mcpServers!.length}</Chip>}
                  {(p.sidePanels?.length ?? 0) > 0 && <Chip>面板 ×{p.sidePanels!.length}</Chip>}
                </>
              }
            />
          ))}
        </ResourceList>
      )}
    </div>
  );
}

/** 技能分区：搜索过滤 + 按来源分组（插件 / 全局）。项目级技能
 *  （<项目>/.yume/commands/）随会话加载，不在此列出。 */
function SkillsTab() {
  const { items, loading, error, refresh } = useEngineList<SkillItem>('/skills', true);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((s) => `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q))
    : items;
  const groups = [
    { key: 'plugin', title: '插件技能', rows: filtered.filter((s) => s.origin === 'plugin') },
    { key: 'global', title: '全局技能（所有模式可用）', rows: filtered.filter((s) => s.origin === 'global') },
  ].filter((g) => g.rows.length > 0);
  if (error) return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">{error}</div>;
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtlest" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索技能…"
            className="pl-8" />
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新" onClick={refresh}
          className="text-foreground-subtle hover:bg-hover hover:text-foreground">
          <RotateCwIcon className="size-3.5" />
        </Button>
      </div>
      {loading && items.length === 0 ? (
        <div className="px-1 py-6 text-ui-sm text-foreground-subtlest">加载中…</div>
      ) : groups.length === 0 ? (
        <EmptyHint
          icon={<SparklesIcon className="size-8" />}
          title={q ? '没有匹配的技能' : '还没有技能'}
          desc="技能来源（优先级从高到低）：<项目>/.yume/commands/、模式引用插件的 skills/、<应用根>/skills/。每项为 <name>/SKILL.md 或 <name>.md。"
        />
      ) : (
        groups.map((g) => (
          <div key={g.key} className="space-y-3">
            <GroupHeader title={g.title} count={g.rows.length} />
            <ResourceList>
              {g.rows.map((s) => (
                <ResourceRow
                  key={s.filePath || s.name}
                  icon={<SparklesIcon className="size-4" />}
                  name={s.name}
                  desc={s.description || s.whenToUse || '（无描述）'}
                  right={s.origin === 'plugin' ? <Chip>{s.plugin}</Chip> : <ScopeChip scope="user" />}
                />
              ))}
            </ResourceList>
          </div>
        ))
      )}
    </div>
  );
}

/** 工具集分区：引擎原生元能力清单（Go 代码实现，吃引擎内部状态/硬件特权）。
 *  模式与插件只能按词引用，不能创建——词表即 toolsetRegistry 的 key 集合。 */
function ToolsetsTab() {
  const { items: modes, body, loading, error, refresh } = useEngineList<ModeDecl>('/modes', true);
  const detail = (body?.toolsets ?? undefined) as ToolsetsDetail | undefined;
  const entries = Object.entries(detail ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const usedBy = (id: string): string[] => modes.filter((m) => m.resolved.toolsets.includes(id)).map((m) => m.id);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = selId ? entries.find(([id]) => id === selId) : null;
  if (error) return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">{error}</div>;
  if (sel) {
    const [id, d] = sel;
    return (
      <DetailFrame
        backLabel="工具集"
        onBack={() => setSelId(null)}
        icon={<BlocksIcon className="size-5" />}
        title={id}
        desc="原生工具集：引擎代码实现，由插件的 toolsets 按 id 打包、模式经插件引用；未启用该工具集的模式会话看不到这些工具。">
        <DetailSection title="启用它的模式">
          {usedBy(id).length
            ? <span className="flex flex-wrap gap-1.5">{usedBy(id).map((m) => <Chip key={m}>{m}</Chip>)}</span>
            : <span className="text-ui-sm text-foreground-subtlest">无（未被任何模式经插件引用，引擎不装配）</span>}
        </DetailSection>
        <DetailSection title={`注册工具（${d.tools?.length ?? 0}）`}>
          {(d.tools?.length ?? 0) === 0
            ? <span className="text-ui-sm text-foreground-subtlest">无独立工具（运行期机制型工具集）</span>
            : d.tools!.map((t) => (
              <div key={t} className="flex items-center gap-2">
                <span className="min-w-0 truncate font-mono text-ui-sm text-foreground">{t}</span>
              </div>
            ))}
        </DetailSection>
        <DetailSection title="运行期机制">
          {(d.notes?.length ?? 0) === 0
            ? <span className="text-ui-sm text-foreground-subtlest">无</span>
            : d.notes!.map((n, i) => (
              <div key={i} className="text-ui-xs text-foreground-subtle">· {n}</div>
            ))}
        </DetailSection>
      </DetailFrame>
    );
  }
  return (
    <div className="space-y-4">
      <GroupHeader
        title="原生工具集"
        count={entries.length}
        actions={
          <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新" onClick={refresh}
            className="text-foreground-subtle hover:bg-hover hover:text-foreground">
            <RotateCwIcon className="size-3.5" />
          </Button>
        }
      />
      {loading && entries.length === 0 ? (
        <div className="px-1 py-6 text-ui-sm text-foreground-subtlest">加载中…</div>
      ) : (
        <ResourceList>
          {entries.map(([id, d]) => (
            <ResourceRow
              key={id}
              icon={<BlocksIcon className="size-4" />}
              name={id}
              desc={(d.tools?.length ?? 0) > 0 ? `工具：${d.tools!.join('、')}` : '运行期机制（无独立工具）'}
              onClick={() => setSelId(id)}
              right={usedBy(id).length ? <Chip>{usedBy(id).join(' · ')}</Chip> : <Chip>未启用</Chip>}
            />
          ))}
        </ResourceList>
      )}
      <p className="text-ui-xs text-foreground-subtlest">
        能力分层：原生工具集（本页，引擎 Go 代码）→ 声明层（技能 / 规范 / MCP / 面板）→ 聚合层（插件）→ 组装层（模式 = 提示词组 + 插件）。上层只能引用下层。
      </p>
    </div>
  );
}

/** 提示词组分区：清单 ↔ 详情两级。组 = prompts/<name>/ 下的分段 .md 文件，
 *  模式经 mode.json 的 prompts 按名引用；未引用组的模式用内置通用 Agent 提示词。 */
function PromptsTab() {
  const { items, loading, error, refresh } = useEngineList<PromptGroupItem>('/prompts', true);
  const [selName, setSelName] = useState<string | null>(null);
  const sel = items.find((g) => g.name === selName) ?? null;
  if (error) return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">{error}</div>;
  if (sel) {
    return (
      <DetailFrame
        backLabel="提示词组"
        onBack={() => setSelName(null)}
        icon={<FileTextIcon className="size-5" />}
        title={sel.name}
        desc="组内每个文件覆盖同名的内置提示词段；没有覆盖的段沿用内置通用 Agent 提示词。">
        <DetailSection title="引用它的模式">
          {sel.usedBy.length
            ? <span className="flex flex-wrap gap-1.5">{sel.usedBy.map((m) => <Chip key={m}>{m}</Chip>)}</span>
            : <span className="text-ui-sm text-foreground-subtlest">无</span>}
        </DetailSection>
        <DetailSection title={`覆盖段（${sel.files?.length ?? 0}）`}>
          {(sel.files?.length ?? 0) === 0 ? (
            <span className="text-ui-sm text-foreground-subtlest">目录下没有 .md 分段文件（全部使用内置提示词）</span>
          ) : sel.files!.map((f) => (
            <div key={f} className="flex items-center gap-2">
              <FileTextIcon className="size-3.5 shrink-0 text-foreground-subtlest" />
              <span className="min-w-0 truncate font-mono text-ui-sm text-foreground">{f}</span>
            </div>
          ))}
        </DetailSection>
        <p className="text-ui-xs text-foreground-subtlest">
          文件位置：&lt;应用根&gt;/prompts/{sel.name}/。修改分段后重启引擎生效。
        </p>
      </DetailFrame>
    );
  }
  return (
    <div className="space-y-4">
      <GroupHeader
        title="提示词组"
        count={items.length}
        actions={
          <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新" onClick={refresh}
            className="text-foreground-subtle hover:bg-hover hover:text-foreground">
            <RotateCwIcon className="size-3.5" />
          </Button>
        }
      />
      {loading && items.length === 0 ? (
        <div className="px-1 py-6 text-ui-sm text-foreground-subtlest">加载中…</div>
      ) : (
        <ResourceList>
          {[
            <ResourceRow
              key="(builtin)"
              icon={<FileTextIcon className="size-4" />}
              name="内置通用 Agent"
              desc="引擎内置的完整提示词；未引用提示词组的模式直接使用"
              right={<ScopeChip scope="builtin" />}
            />,
            ...items.map((g) => (
              <ResourceRow
                key={g.name}
                icon={<FileTextIcon className="size-4" />}
                name={g.name}
                desc={(g.files?.length ?? 0) > 0 ? `覆盖 ${g.files!.length} 段` : '空组（等同内置）'}
                onClick={() => setSelName(g.name)}
                right={g.usedBy.length ? <Chip>{g.usedBy.join(' · ')}</Chip> : <Chip>未引用</Chip>}
              />
            )),
          ]}
        </ResourceList>
      )}
      <p className="text-ui-xs text-foreground-subtlest">
        系统提示词按段组装（身份 / 任务执行 / 工具使用 / 语气…）；提示词组只放要改写的段，模式在 mode.json 的 prompts 里按名引用。
      </p>
    </div>
  );
}

/** MCP 分区：引擎 MCP client 未接入前，展示插件清单里声明的 server（只读预告）。 */
function McpTab() {
  const { items } = useEngineList<PluginItem>('/plugins', true);
  const declared = items.flatMap((p) => (p.mcpServers ?? []).map((server) => ({ plugin: p.name, server })));
  return (
    <div className="space-y-4">
      {declared.length > 0 ? (
        <>
          <GroupHeader title="插件声明的 MCP server" count={declared.length} />
          <ResourceList>
            {declared.map((d) => (
              <ResourceRow
                key={`${d.plugin}:${d.server.name}`}
                icon={<CableIcon className="size-4" />}
                name={d.server.name}
                desc={`来源插件：${d.plugin} · ${mcpSummary(d.server)}`}
                right={<Chip>待接入</Chip>}
              />
            ))}
          </ResourceList>
        </>
      ) : (
        <EmptyHint
          icon={<CableIcon className="size-8" />}
          title="尚未接入 MCP"
          desc="在插件清单（plugin.json）的 mcpServers 里声明 server（name + command 或 url）后会显示在这里。引擎 MCP client 接入后，这些 server 的工具只对引用该插件的模式可见。"
        />
      )}
    </div>
  );
}

export function SettingsPage() {
  const { settingsOpen, setSettingsOpen, engineStatus, defaultMode, saveDefaultMode } = useApp();
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

  /** 默认模式：只写 config（模式按项目生效，会话级装配，不重启引擎）。 */
  const setDefault = async (id: string): Promise<void> => {
    await saveDefaultMode(id);
    setCfg((c) => (c ? { ...c, engine: { ...c.engine, mode: id } } : c));
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

            {tab === 'modes' && (
              <Section
                title="模式"
                desc="模式把提示词组与能力插件组合成一种 Agent 形态，按项目生效、切换不重启引擎。">
                <ModesTab defaultMode={defaultMode} onSetDefault={(id) => void setDefault(id)} />
              </Section>
            )}

            {tab === 'toolsets' && (
              <Section
                title="工具集"
                desc="引擎原生元能力（Go 代码实现），模式与插件只能按词引用；新增工具集需改引擎。">
                <ToolsetsTab />
              </Section>
            )}

            {tab === 'plugins' && (
              <Section
                title="插件"
                desc="能力包：打包原生工具集 + 领域规范 + 技能 + MCP + 右栏面板，供模式引用。清单在引擎启动时校验加载，技能内容 30s 内自动重扫。">
                <PluginsTab />
              </Section>
            )}

            {tab === 'skills' && (
              <Section
                title="技能"
                desc="模型可调用的操作知识：目录式 <name>/SKILL.md（可携带参考资产）或平铺 <name>.md。">
                <SkillsTab />
              </Section>
            )}

            {tab === 'prompts' && (
              <Section
                title="提示词组"
                desc="引擎系统提示词的分段组合，一个模式引用一组；缺段回退内置默认值，跟随引擎升级。">
                <PromptsTab />
              </Section>
            )}

            {tab === 'mcp' && (
              <Section
                title="MCP"
                desc="外部工具服务：引擎接入后，server 声明的工具会自动注册进对话。">
                <McpTab />
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
