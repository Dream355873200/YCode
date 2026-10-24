// v2 应用壳：侧栏（项目 → 对话 / 团队）+ 顶栏 + 主区 + 右栏。
// 主区随选中项切换：
//   - 没有项目：欢迎页（添加项目）
//   - 草稿对话：智能体身份 + 大输入框 + 智能体声明的开场建议（发出第一条消息才建对话）
//   - 对话：时间线 + 状态面板（右上角胶囊）+ 输入框
//   - 团队：群聊（成员时间线在右栏）
import { useEffect, useMemo, useState } from 'react';
import { FolderOpenIcon, LayoutTemplateIcon, UsersIcon } from 'lucide-react';
import { AppProvider, useApp } from './appState';
import { AgentAvatar } from './agentIcon';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { NewProjectDialog } from './NewProjectDialog';
import { SettingsPage } from './SettingsPage';
import { CommandPalette } from './CommandPalette';
import { SidePane } from '../pane/SidePane';
import { Timeline } from '../conversation/Timeline';
import { Composer } from '../conversation/Composer';
import { QueuePanel } from '../conversation/QueuePanel';
import { QuestionPanel } from '../conversation/QuestionPanel';
import { StatusPanel } from '../conversation/status/StatusPanel';
import {
  STATUS_PANEL_OFFSET_CLASS, statusPanelLayout, useStatusPanelModel, useStatusPanelUi,
} from '../conversation/status/useStatusPanel';
import { useConversation, useSession } from '../conversation/store';
import { TeamView } from '../team/TeamView';
import { CreateTeamDialog } from '../team/TeamDialogs';
import { cn } from '../components/lib/utils';

const greeting = (): string => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
};

function Welcome() {
  const { setCreateDialogOpen } = useApp();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 pb-16">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-ui-xl font-bold text-primary-foreground">Y</span>
      <div className="text-center">
        <div className="text-ui-xl font-semibold text-foreground">{greeting()}，开始第一个项目</div>
        <div className="mt-1 text-ui-sm text-foreground-subtlest">项目就是一个文件夹；每个项目里可以开多段对话、组建智能体团队</div>
      </div>
      <div className="grid w-full max-w-md grid-cols-2 gap-3">
        <button type="button" onClick={() => setCreateDialogOpen(true)}
          className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-brand/50 hover:bg-hover">
          <FolderOpenIcon className="size-5 text-brand" />
          <span className="text-ui-sm font-medium text-foreground">打开文件夹</span>
          <span className="text-ui-xs text-foreground-subtlest">在已有的代码或资料目录里开工</span>
        </button>
        <button type="button" onClick={() => setCreateDialogOpen(true)}
          className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-brand/50 hover:bg-hover">
          <LayoutTemplateIcon className="size-5 text-brand" />
          <span className="text-ui-sm font-medium text-foreground">用模板新建</span>
          <span className="text-ui-xs text-foreground-subtlest">按智能体模板生成工程，例如 Flutter 应用</span>
        </button>
      </div>
    </div>
  );
}

/** 草稿对话：智能体身份 + 输入框 + 开场建议 + 组建团队入口。 */
function DraftHero({ dir }: { dir: string }) {
  const { modes, projectMode, setTeamDialogDir } = useApp();
  const agent = modes.find((m) => m.id === projectMode);
  const [seed, setSeed] = useState({ text: '', tick: 0 });
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-16">
      <div className="flex w-full max-w-2xl flex-col items-center">
        <AgentAvatar icon={agent?.icon} size="lg" />
        <div className="mt-3 text-ui-xl font-semibold text-foreground">{agent?.name ?? '智能体'}</div>
        {agent?.description && (
          <div className="mb-6 mt-1 max-w-md text-center text-ui-sm leading-relaxed text-foreground-subtlest">{agent.description}</div>
        )}
        <div className="w-full"><Composer sid={null} variant="hero" seed={seed} /></div>
        {!!agent?.starters?.length && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {agent.starters.map((s) => (
              <button key={s.label} type="button" onClick={() => setSeed((x) => ({ text: s.prompt, tick: x.tick + 1 }))}
                title={s.prompt}
                className="rounded-full border border-border bg-card px-3.5 py-1.5 text-ui-sm text-foreground-subtle transition-colors hover:border-border-hover hover:bg-hover hover:text-foreground">
                {s.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setTeamDialogDir(dir)}
          className="mt-6 flex items-center gap-1.5 text-ui-xs text-foreground-subtlest transition-colors hover:text-foreground-subtle">
          <UsersIcon className="size-3.5" />
          这件事需要几个智能体配合？组建一个团队
        </button>
      </div>
    </div>
  );
}

/** 对话：时间线 + 状态面板 + 输入区（状态面板并排展开时整列左移让位）。 */
function ThreadView({ sid, dir }: { sid: string; dir: string }) {
  const session = useSession(sid);
  const restore = useConversation((s) => s.restore);
  useEffect(() => { restore(sid); }, [sid, restore]);
  const model = useStatusPanelModel(sid);
  const variant = useStatusPanelUi((s) => s.variant);
  const offset = statusPanelLayout(!!model?.hasContent, variant) === 'none' ? undefined : STATUS_PANEL_OFFSET_CLASS;

  // 待回答的提问：阻塞式接管输入区（答完自动恢复输入框）
  const pendingAsk = useMemo(
    () => session.rows.findLast((r): r is Extract<typeof session.rows[number], { kind: 'confirm' | 'ask' }> =>
      (r.kind === 'confirm' || r.kind === 'ask') && !r.resolved),
    [session.rows],
  );

  return (
    <>
      {model && <StatusPanel sid={sid} dir={dir} model={model} />}
      <Timeline rows={session.rows} sid={sid} columnClassName={offset} />
      <div className="shrink-0 px-4 pb-3">
        <div className={cn('mx-auto max-w-3xl transition-transform duration-300', offset)}>
          <QueuePanel sid={sid} />
          {pendingAsk ? <QuestionPanel row={pendingAsk} sid={sid} /> : <Composer sid={sid} />}
        </div>
      </div>
    </>
  );
}

function SessionFrame() {
  const { projects, selection, project } = useApp();
  return (
    <main className="@container/conversation relative flex min-w-0 flex-1 flex-col bg-background">
      {!projects.length ? <Welcome />
        : !selection || !project ? <div className="flex-1" />
          : selection.kind === 'team' ? <TeamView key={`${selection.dir}:${selection.name}`} dir={selection.dir} name={selection.name} />
            : selection.kind === 'draft' ? <DraftHero key={selection.dir} dir={selection.dir} />
              : <ThreadView key={selection.id} sid={selection.id} dir={selection.dir} />}
    </main>
  );
}

export function App() {
  // Provider 外壳：App 自身不消费 context（否则 useApp 取不到直接崩）
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { newThread, setPaletteOpen, paletteOpen, sidePaneOpen, setSidebarOpen, sidebarOpen } = useApp();
  // 全局快捷键：Ctrl+N 新对话 · Ctrl+K 命令面板 · Ctrl+B 侧栏
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'n' && !e.shiftKey) { e.preventDefault(); newThread(); }
      else if (k === 'k') { e.preventDefault(); setPaletteOpen(!paletteOpen); }
      else if (k === 'b') { e.preventDefault(); setSidebarOpen(!sidebarOpen); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [newThread, setPaletteOpen, paletteOpen, setSidebarOpen, sidebarOpen]);

  return (
    <div className="flex h-full bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <SessionFrame />
          <SidePane open={sidePaneOpen} />
        </div>
      </div>
      <NewProjectDialog />
      <CreateTeamDialog />
      <CommandPalette />
      <SettingsPage />
    </div>
  );
}
