// v2 应用壳：融合式顶栏（Header 即标题栏，窗控内联右端）+ 三帧工作区
// （会话侧栏 + 会话帧 + Side Pane）。空会话 = 欢迎态（时段问候 +
// 居中大输入卡 + 快捷 chips）；首条消息后切换为时间线 + 底部 composer。
import { useEffect, useMemo, useState } from 'react';
import { AppProvider, useApp } from './appState';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import { NewProjectDialog } from './NewProjectDialog';
import { SettingsPage } from './SettingsPage';
import { SidePane } from '../pane/SidePane';
import { Timeline } from '../conversation/Timeline';
import { Composer } from '../conversation/Composer';
import { QueuePanel } from '../conversation/QueuePanel';
import { QuestionPanel } from '../conversation/QuestionPanel';
import { useConversation, useSession } from '../conversation/store';

const greeting = (): string => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
};

/** 快捷开始 chips：填充草稿，不直接发送（内容用户可见可改）。 */
const CHIPS: Array<{ icon: string; label: string; seed: string }> = [
  { icon: '📱', label: '从想法建 App', seed: '我想做一个 App：' },
  { icon: '✨', label: '加一个新功能', seed: '给当前 App 加一个新功能：' },
  { icon: '🐛', label: '修复问题', seed: '当前 App 有一个问题需要修复：' },
  { icon: '🧪', label: '设备测试', seed: '把 App 部署到手机跑一遍测试，并给我一份测试报告' },
];

function Hero({ sid }: { sid: string }) {
  const [seed, setSeed] = useState('');
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-16">
      <div className="text-ui-xl font-semibold text-foreground">{greeting()}</div>
      <div className="mb-6 mt-1 text-ui-sm text-foreground-subtlest">描述想法，AI 自动开发、自动上真机测试</div>
      <Composer sid={sid} variant="hero" seed={seed} />
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {CHIPS.map((c) => (
          <button key={c.label} type="button" onClick={() => setSeed(`${c.seed} `)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-ui-sm text-foreground-subtle transition-colors hover:bg-hover hover:text-foreground">
            <span>{c.icon}</span>{c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SessionFrame() {
  const { project, sid } = useApp();
  const session = useSession(sid || '');
  const restore = useConversation((s) => s.restore);

  useEffect(() => {
    if (sid) restore(sid);
  }, [sid, restore]);

  // 待回答的提问：阻塞式接管 composer 槽位（对齐 ZCode——问题出现期间
  // 不能自由输入，答完自动恢复输入框）
  const pendingAsk = useMemo(
    () => session.rows.findLast((r): r is Extract<typeof session.rows[number], { kind: 'confirm' | 'ask' }> =>
      (r.kind === 'confirm' || r.kind === 'ask') && !r.resolved),
    [session.rows],
  );

  return (
    <main className="relative flex min-w-0 flex-1 flex-col bg-background">
      {!sid || !project
        ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-foreground-subtlest">
            <div className="text-ui-xl font-semibold text-foreground-subtle">从想法开始</div>
            <div className="text-ui-sm">选择左侧项目继续，或创建一个新项目</div>
            <CreateButton />
          </div>
        )
        : session.rows.length === 0
          ? <Hero sid={sid} />
          : (
            <>
              <Timeline rows={session.rows} sid={sid} />
              <div className="shrink-0 px-4 pb-3">
                <QueuePanel sid={sid} />
                {pendingAsk
                  ? <QuestionPanel row={pendingAsk} sid={sid} />
                  : <Composer sid={sid} />}
              </div>
            </>
          )}
    </main>
  );
}

function CreateButton() {
  const { setCreateDialogOpen } = useApp();
  return (
    <button type="button" onClick={() => setCreateDialogOpen(true)}
      className="mt-2 rounded-lg bg-primary px-4 py-2 text-ui-sm text-primary-foreground">
      ＋ 新建项目
    </button>
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
  const { setCreateDialogOpen, sidePaneOpen } = useApp();
  // Ctrl+N 新建项目
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setCreateDialogOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setCreateDialogOpen]);

  return (
    <div className="flex h-full bg-background text-foreground">
      <Sidebar />
      {/* Header 以下才是工作区：Header 横跨主列，窗控在其右端 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <SessionFrame />
          {/* Side Pane（tab 化：Git 辅助对话 / 任务 / 计划；标题栏右端钮开合）。
              常驻挂载收 open 做宽度动画，内容在组件内部按 open 延迟挂卸 */}
          <SidePane open={sidePaneOpen} />
        </div>
      </div>
      <NewProjectDialog />
      <SettingsPage />
    </div>
  );
}
