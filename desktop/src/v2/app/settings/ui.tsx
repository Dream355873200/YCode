// 能力目录共享 UI：资源清单（组头 / 圆角列表 / 行）、详情页骨架、
// 可跳转卡片（LinkCard + CardSection）、状态徽标与文件预览。
// 节奏对齐成熟 IDE 设置页：组头（标题+计数+操作）→ 圆角容器 → 行 / 卡片。
import { Children, useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, RotateCwIcon, WrenchIcon } from 'lucide-react';
import type { MCPServerDecl, MCPServerStatus } from '../modeRegistry';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/lib/utils';
import { useCatalog, skillKey, type Catalog } from './catalog';
import { BASE_TOOLSET_ID, BUILTIN_PROMPT_ID, NEW_ID, tabLabel, useNav, type Route } from './nav';

/** 路径末两段（规范文件等只显示短名，完整路径放 title）。 */
export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).slice(-2).join('/');

/** MCP 声明的一行摘要（stdio 命令行或远程 url）。 */
export const mcpSummary = (s: MCPServerDecl): string =>
  s.url || [s.command, ...(s.args ?? [])].filter(Boolean).join(' ');

/** 路由的显示名（返回按钮文案）。 */
export function routeTitle(c: Catalog, r: Route): string {
  if (!r.id) return tabLabel(r.tab);
  if (r.id === NEW_ID) return '新建';
  switch (r.tab) {
    case 'modes': return c.modes.find((m) => m.id === r.id)?.name ?? r.id;
    case 'plugins': return c.plugins.find((p) => p.id === r.id)?.name ?? r.id;
    case 'toolsets': return r.id === BASE_TOOLSET_ID ? '基础工具' : r.id;
    case 'skills': return c.skills.find((s) => skillKey(s) === r.id)?.name ?? r.id;
    case 'prompts':
      if (r.id === BUILTIN_PROMPT_ID) return '内置通用 Agent';
      if (r.id.startsWith('rule:')) return `${r.id.slice(5)} 规范`;
      return r.id;
    default: return r.id;
  }
}

export function RefreshButton() {
  const { refresh, loading } = useCatalog();
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新" onClick={refresh}
      className="text-foreground-subtle hover:bg-hover hover:text-foreground">
      <RotateCwIcon className={cn('size-3.5', loading && 'animate-spin')} />
    </Button>
  );
}

/** 资源组头：标题 + 计数 + 右侧操作。 */
export function GroupHeader({ title, count, actions }: {
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

/** 资源列表容器：圆角面 + 行间细分隔线。 */
export function ResourceList({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children);
  return (
    <div className="overflow-hidden rounded-xl border border-border/50 bg-surface">
      {items.map((child, i) => (
        <div key={i}>
          {i > 0 && <div className="h-px bg-border/50" aria-hidden="true" />}
          {child}
        </div>
      ))}
    </div>
  );
}

/** 资源行：图标块 | 名称+描述 | 右侧内容。 */
export function ResourceRow({ icon, name, desc, right, onClick }: {
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

/** 小徽标（计数 / 来源 / 状态文字）。 */
export function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'brand' }) {
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-ui-2xs',
      tone === 'brand'
        ? 'bg-brand/15 font-medium text-brand'
        : 'border border-border bg-surface text-foreground-subtlest',
    )}>
      {children}
    </span>
  );
}

const MCP_STATUS = {
  connected: { label: '已连接', dot: 'bg-success' },
  connecting: { label: '连接中', dot: 'bg-warning animate-pulse' },
  error: { label: '连接失败', dot: 'bg-destructive' },
} as const;

/** MCP 连接状态徽标（圆点 + 文案）。无状态 = 插件未被任何模式引用，引擎不连接。 */
export function McpStatusBadge({ status }: { status?: MCPServerStatus }) {
  const s = status ? MCP_STATUS[status.status] : { label: '未启用', dot: 'bg-foreground-subtlest' };
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-ui-2xs text-foreground-subtle">
      <span className={cn('size-1.5 rounded-full', s.dot)} aria-hidden="true" />
      {s.label}
      {status?.status === 'connected' && <span className="text-foreground-subtlest">· {status.tools.length} 工具</span>}
    </span>
  );
}

/** 工具名胶囊（等宽小字）。 */
export function ToolPill({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background px-1.5 py-0.5 font-mono text-ui-2xs text-foreground-subtle">
      <WrenchIcon className="size-3" />{name}
    </span>
  );
}

/** 分区空态（居中提示卡）。 */
export function EmptyHint({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="text-foreground-subtlest">{icon}</span>
      <div className="text-ui-sm font-medium text-foreground-subtle">{title}</div>
      <div className="max-w-md text-ui-xs text-foreground-subtlest">{desc}</div>
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">{message}</div>;
}

export function Loading() {
  return <div className="px-1 py-6 text-ui-sm text-foreground-subtlest">加载中…</div>;
}

/** 键值信息行（详情页 definition list）。 */
export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3">
      <span className="text-ui-xs text-foreground-subtlest">{label}</span>
      <div className="min-w-0 text-ui-sm text-foreground">{children}</div>
    </div>
  );
}

/** 详情页骨架：返回（上一级路由名）+ 图标标题 + 描述 + 右侧操作 + 分区。 */
export function DetailFrame({ icon, title, desc, actions, children }: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const nav = useNav();
  const catalog = useCatalog();
  const backTo = nav.prev ?? { tab: nav.route.tab };
  return (
    <div className="space-y-6">
      <Button type="button" variant="ghost" size="sm"
        className="-ml-2 gap-1 text-foreground-subtle hover:bg-hover hover:text-foreground"
        onClick={nav.back}>
        <ChevronLeftIcon className="size-3.5" />
        {routeTitle(catalog, backTo)}
      </Button>
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-foreground-subtle">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-ui-base font-semibold text-foreground">{title}</div>
          {desc && <div className="mt-0.5 line-clamp-3 text-ui-xs text-foreground-subtlest">{desc}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** 详情页信息分区（InfoRow 行 / 自由内容，圆角面承载）。 */
export function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-ui-sm font-medium text-foreground">{title}</h3>
      <div className="space-y-2 rounded-xl border border-border/50 bg-surface px-4 py-3">{children}</div>
    </section>
  );
}

/** 卡片分区：标题 + 计数 + 两列卡片网格；无卡片时显示空态文案。 */
export function CardSection({ title, count, empty = '无', hint, actions, children }: {
  title: string;
  count?: number;
  empty?: string;
  hint?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const items = Children.toArray(children);
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-1.5 text-ui-sm font-medium text-foreground">
        {title}
        {count !== undefined && <span className="font-normal text-foreground-subtlest">{count}</span>}
        {actions && <span className="ml-auto flex items-center gap-1">{actions}</span>}
      </h3>
      {items.length
        ? <div className="grid grid-cols-1 gap-2 md:grid-cols-2">{items}</div>
        : <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-ui-sm text-foreground-subtlest">{empty}</div>}
      {hint && <p className="text-ui-xs text-foreground-subtlest">{hint}</p>}
    </section>
  );
}

/** 可跳转卡片：图标块 | 标题（+徽标）+ 描述 | hover 箭头。无 onClick 时为静态卡。 */
export function LinkCard({ icon, title, desc, badge, mono, onClick }: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  badge?: React.ReactNode;
  mono?: boolean;
  onClick?(): void;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={cn(
        'group flex min-w-0 items-start gap-3 rounded-xl border border-border/50 bg-surface px-3 py-2.5 text-left transition-colors',
        onClick && 'cursor-pointer outline-none hover:border-border hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-foreground-subtle">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('truncate text-ui-sm font-medium text-foreground', mono && 'font-mono')}>{title}</span>
          {badge}
        </span>
        {desc && <span className="mt-0.5 line-clamp-2 block text-ui-xs text-foreground-subtlest">{desc}</span>}
      </span>
      {onClick && (
        <ChevronRightIcon className="mt-2 size-3.5 shrink-0 text-foreground-subtlest opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </div>
  );
}

type FsBridge = { readFile(p: string): Promise<{ ok: boolean; content?: string; error?: string }> };

/** 文件内容预览（只读；规范 / 技能 / 子代理定义 / 提示词分段）。 */
export function FilePreview({ path }: { path: string }) {
  const [state, setState] = useState<{ content?: string; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    (window.amc.fs as unknown as FsBridge).readFile(path)
      .then((r) => { if (alive) setState(r.ok ? { content: r.content ?? '' } : { error: r.error || '读取失败' }); })
      .catch((e: unknown) => { if (alive) setState({ error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [path]);
  if (!state) return <div className="text-ui-xs text-foreground-subtlest">读取中…</div>;
  if (state.error) return <div className="break-all text-ui-xs text-destructive">{state.error}</div>;
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 font-mono text-ui-xs leading-relaxed text-foreground-subtle">
      {state.content || '（空文件）'}
    </pre>
  );
}

/** 内容分区：标题 + 文件路径 + 预览（可折叠，默认展开）。 */
export function FileSection({ title, path, defaultOpen = true }: { title: string; path: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-2.5">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-left text-ui-sm font-medium text-foreground">
        {open ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        {title}
        <span className="min-w-0 flex-1 truncate text-right font-mono text-ui-2xs font-normal text-foreground-subtlest" title={path}>
          {baseName(path)}
        </span>
      </button>
      {open && <FilePreview path={path} />}
    </section>
  );
}
