// CommandPalette — Ctrl+K 命令面板：跨项目找对话、找当前项目的文件、执行操作。
// 范围：全部 / 操作 / 对话 / 文件；前缀 > 只搜操作、# 只搜对话、@ 只搜文件。
// 空查询时：最近对话 + 常用操作。↑↓ 选择、Enter 执行、Esc 关闭。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  FileDiffIcon, FileTextIcon, FolderPlusIcon, GlobeIcon, MessageSquareIcon, MoonIcon, PanelLeftIcon,
  PanelRightIcon, SearchIcon, Settings2Icon, SquarePenIcon, SunIcon, UserRoundPlusIcon, UsersIcon,
} from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useApp } from './appState';
import { AgentAvatar } from './agentIcon';
import { sameDir, useWorkspace } from './workspace';
import { cn } from '../components/lib/utils';
import { relTime } from '../lib/time';

type Scope = 'all' | 'action' | 'thread' | 'file';

interface Item {
  id: string;
  group: string;
  icon: ReactNode;
  title: string;
  hint?: string;
  run(): void;
}

interface TreeNode { type: 'dir' | 'file'; name: string; path: string; children?: TreeNode[] }

function flatten(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n.path);
    else if (n.children) flatten(n.children, out);
    if (out.length > 5000) break;
  }
  return out;
}

const match = (q: string, ...texts: Array<string | undefined>): boolean => {
  const s = q.toLowerCase();
  return texts.some((t) => !!t && t.toLowerCase().includes(s));
};

export function CommandPalette() {
  const app = useApp();
  const { paletteOpen, setPaletteOpen, project, projects, modes } = app;
  const threads = useWorkspace((s) => s.threads);
  const teams = useWorkspace((s) => s.teams);
  const select = useWorkspace((s) => s.select);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!paletteOpen) return;
    setQuery('');
    setScope('all');
    setActive(0);
    if (project?.dir) {
      void (window.amc.projects.filetree(project.dir) as Promise<TreeNode[]>)
        .then((t) => setFiles(Array.isArray(t) ? flatten(t) : []))
        .catch(() => setFiles([]));
    }
  }, [paletteOpen, project?.dir]);

  const close = (): void => setPaletteOpen(false);
  const run = (fn: () => void) => () => { close(); fn(); };

  // 前缀收窄范围
  const prefix = query.startsWith('>') ? 'action' : query.startsWith('#') ? 'thread' : query.startsWith('@') ? 'file' : null;
  const effScope: Scope = prefix ?? scope;
  const q = (prefix ? query.slice(1) : query).trim();

  const items = useMemo<Item[]>(() => {
    const dark = document.documentElement.classList.contains('dark');
    const actions: Item[] = [
      { id: 'a:new', group: '操作', icon: <SquarePenIcon />, title: '新对话', hint: 'Ctrl+N', run: run(() => app.newThread()) },
      ...(project ? [{ id: 'a:team', group: '操作', icon: <UserRoundPlusIcon />, title: '组建团队', hint: project.name, run: run(() => app.setTeamDialogDir(project.dir)) }] : []),
      { id: 'a:project', group: '操作', icon: <FolderPlusIcon />, title: '添加项目', run: run(() => app.setCreateDialogOpen(true)) },
      ...modes.map((m) => ({
        id: `a:agent:${m.id}`, group: '切换智能体', icon: <AgentAvatar icon={m.icon} size="sm" />,
        title: `交给「${m.name}」`, hint: m.id === app.projectMode ? '当前' : m.description, run: run(() => void app.setProjectMode(m.id)),
      })),
      { id: 'a:review', group: '面板', icon: <FileDiffIcon />, title: '打开变更审查', run: run(() => app.openPaneTab({ id: 'git', kind: 'git', label: '变更' })) },
      { id: 'a:browser', group: '面板', icon: <GlobeIcon />, title: '打开内置浏览器', run: run(() => void window.amc.browser.open('about:blank')) },
      { id: 'a:sidebar', group: '面板', icon: <PanelLeftIcon />, title: app.sidebarOpen ? '收起侧栏' : '展开侧栏', hint: 'Ctrl+B', run: run(() => app.setSidebarOpen(!app.sidebarOpen)) },
      { id: 'a:pane', group: '面板', icon: <PanelRightIcon />, title: app.sidePaneOpen ? '收起右栏' : '展开右栏', run: run(() => app.setSidePaneOpen(!app.sidePaneOpen)) },
      {
        id: 'a:theme', group: '设置', icon: dark ? <SunIcon /> : <MoonIcon />, title: dark ? '切换到浅色主题' : '切换到深色主题',
        run: run(() => {
          const next = dark ? 'light' : 'dark';
          document.documentElement.classList.toggle('dark', next === 'dark');
          void window.amc.config.get().then((c) => window.amc.config.save({ ...c, theme: next }));
        }),
      },
      { id: 'a:settings', group: '设置', icon: <Settings2Icon />, title: '打开设置', run: run(() => app.openSettings()) },
      { id: 'a:agents', group: '设置', icon: <Settings2Icon />, title: '管理智能体与插件', run: run(() => app.openSettings('modes')) },
    ];
    const projectName = (dir: string): string => projects.find((p) => sameDir(p.dir, dir))?.name ?? dir.split(/[\\/]/).pop() ?? dir;
    const threadItems: Item[] = threads.filter((t) => !t.archived).map((t) => ({
      id: `t:${t.id}`, group: '对话', icon: <MessageSquareIcon />, title: t.title,
      hint: `${projectName(t.dir)} · ${relTime(t.updatedAt)}`,
      run: run(() => select({ kind: 'thread', id: t.id, dir: t.dir })),
    }));
    const teamItems: Item[] = Object.values(teams).flat().map((t) => ({
      id: `team:${t.dir}:${t.name}`, group: '对话', icon: <UsersIcon />, title: t.name, hint: `${projectName(t.dir)} · 团队`,
      run: run(() => select({ kind: 'team', dir: t.dir, name: t.name })),
    }));
    const fileItems: Item[] = project ? files.map((f) => ({
      id: `f:${f}`, group: '文件', icon: <FileTextIcon />, title: f.split('/').pop() ?? f, hint: f,
      run: run(() => app.openViewerFile(`${project.dir.replace(/[\\/]+$/, '')}/${f}`)),
    })) : [];

    if (!q) {
      if (effScope === 'action') return actions;
      if (effScope === 'thread') return [...threadItems, ...teamItems].slice(0, 40);
      if (effScope === 'file') return fileItems.slice(0, 40);
      return [...threadItems.slice(0, 5), ...actions.filter((a) => !a.id.startsWith('a:agent:'))];
    }
    const pick = (list: Item[], cap: number): Item[] => list.filter((i) => match(q, i.title, i.hint)).slice(0, cap);
    if (effScope === 'action') return pick(actions, 60);
    if (effScope === 'thread') return pick([...threadItems, ...teamItems], 60);
    if (effScope === 'file') return pick(fileItems, 60);
    return [...pick(threadItems.concat(teamItems), 20), ...pick(actions, 20), ...pick(fileItems, 30)];
    // run/app 每次渲染新建，依赖用数据本身
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, effScope, threads, teams, files, project, projects, modes, app.projectMode, app.sidebarOpen, app.sidePaneOpen]);

  useEffect(() => { setActive(0); }, [q, effScope]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (items.length ? (a + 1) % items.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0)); }
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); items[active]?.run(); }
  };

  let lastGroup = '';
  return (
    <DialogPrimitive.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content aria-describedby={undefined}
          className="no-drag fixed left-1/2 top-16 z-50 flex max-h-[min(70vh,34rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-popover-border bg-popover shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">命令面板</DialogPrimitive.Title>
          <div className="flex items-center gap-2 border-b border-border/60 p-2.5">
            <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-input-border bg-input px-3">
              <SearchIcon className="size-4 shrink-0 text-foreground-subtlest" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
                placeholder="搜索对话、操作或文件（> 操作 · # 对话 · @ 文件）"
                className="min-w-0 flex-1 bg-transparent text-ui-sm text-foreground outline-none placeholder:text-foreground-subtlest" />
            </div>
          </div>
          <div className="flex gap-1 px-2.5 pt-2">
            {([['all', '全部'], ['action', '操作'], ['thread', '对话'], ['file', '文件']] as Array<[Scope, string]>).map(([id, label]) => (
              <button key={id} type="button" onClick={() => setScope(id)}
                className={cn('h-6 rounded-full border px-2.5 text-ui-xs font-medium transition-colors',
                  effScope === id ? 'border-border bg-selected text-foreground' : 'border-transparent text-foreground-subtle hover:bg-hover')}>
                {label}
              </button>
            ))}
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {items.length === 0 && <div className="px-3 py-8 text-center text-ui-sm text-foreground-subtlest">没有相关结果</div>}
            {items.map((it, i) => {
              const header = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              return (
                <div key={it.id}>
                  {header && <div className="px-2.5 pb-1 pt-2 text-ui-2xs font-medium text-foreground-subtlest">{header}</div>}
                  <button type="button" data-idx={i} onMouseMove={() => setActive(i)} onClick={() => it.run()}
                    className={cn('flex min-h-8 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-ui-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-foreground-subtle',
                      i === active ? 'bg-hover text-foreground' : 'text-foreground-subtle')}>
                    {it.icon}
                    <span className="min-w-0 flex-1 truncate text-foreground">{it.title}</span>
                    {it.hint && <span className="max-w-56 shrink-0 truncate text-ui-xs text-foreground-subtlest">{it.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
