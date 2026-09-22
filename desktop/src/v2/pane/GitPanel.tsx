// GitPanel — 右栏 Git 面板：分支概览 + 变更清单 + 辅助对话小会话。
// 辅助对话 = 独立引擎会话（<主会话>-git），经 session-map 扎根同一项目目录，
// AI 可自行跑 git 工具查 diff 后作答，不污染主时间线。
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpIcon, RefreshCwIcon } from 'lucide-react';
import { useApp } from '../app/appState';
import { useConversation, useSession } from '../conversation/store';
import { engine } from '../protocol';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';

interface GitChange { x: string; y: string; path: string; orig?: string }
interface GitStatus {
  ok: boolean; error?: string;
  branch?: string | null; upstream?: string | null;
  ahead?: number; behind?: number;
  head?: string | null; commits?: number; dirty?: boolean;
  changes?: GitChange[];
  log?: Array<{ sha?: string; subject?: string; when?: string }>;
}

/** 变更状态字母 → 语义色（M 改 / A 增 / D 删 / R 移 / 其余未跟踪类）。 */
const changeCls = (c: GitChange): string => {
  const x = c.x === ' ' || c.x === '?' ? c.y : c.x;
  if (x === 'D') return 'bg-destructive/15 text-destructive';
  if (x === 'A') return 'bg-success/15 text-success';
  if (x === 'M') return 'bg-warning/15 text-warning';
  if (x === 'R') return 'bg-info/15 text-info';
  return 'bg-neutral-500/15 text-foreground-subtle';
};
const changeLetter = (c: GitChange): string =>
  c.x === ' ' || c.x === '?' ? '?' : (c.orig ? 'R' : c.x);

/** 辅助对话小会话：rows 只取用户气泡 / 助手正文 / 通知三类做轻量渲染。 */
function HelperChat({ gitSid }: { gitSid: string }) {
  const send = useConversation((s) => s.send);
  const session = useSession(gitSid);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = session.rows.filter(
    (r) => r.kind === 'user' || r.kind === 'assistant_text' || r.kind === 'notice',
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [rows.length, session.rows[rows.length - 1]]);

  const submit = (): void => {
    const text = draft.trim();
    if (!text || session.busy) return;
    setDraft('');
    void send(gitSid, text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border/50">
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <span className="text-ui-2xs font-medium uppercase tracking-wider text-foreground-subtlest">辅助对话</span>
        {session.busy && <span className="text-ui-2xs text-brand">思考中…</span>}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {rows.length === 0 ? (
          <div className="py-4 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
            问问 AI 当前改动：例如<br />「这次改动有什么问题？」
          </div>
        ) : (
          rows.map((r) => {
            if (r.kind === 'user') {
              return (
                <div key={r.id} className="mb-2 ml-4 rounded-xl rounded-br-sm bg-selected px-2.5 py-1.5 text-ui-xs text-foreground">
                  {r.text}
                </div>
              );
            }
            if (r.kind === 'assistant_text') {
              return (
                <div key={r.id} className="mb-2 whitespace-pre-wrap text-ui-xs leading-relaxed text-foreground-subtle">
                  {r.text}
                </div>
              );
            }
            return (
              <div key={r.id} className="mb-2 rounded-lg border border-border bg-card px-2 py-1 text-ui-2xs text-foreground-subtlest">
                {r.text}
              </div>
            );
          })
        )}
      </div>
      <div className="flex items-center gap-1.5 p-2 pt-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          }}
          placeholder={session.busy ? '执行中…' : '就当前改动提问'}
          disabled={session.busy}
          className="h-7 min-w-0 flex-1 rounded-md border border-input-border bg-input px-2 text-ui-xs text-foreground outline-none transition-colors placeholder:text-foreground-subtlest hover:border-input-border-hover focus-visible:border-input-border-focused focus-visible:bg-input-focused disabled:opacity-50"
        />
        <Button type="button" size="icon-sm" aria-label="发送" disabled={!draft.trim() || session.busy}
          onClick={submit}>
          <ArrowUpIcon />
        </Button>
      </div>
    </div>
  );
}

export function GitPanel() {
  const { sid, project } = useApp();
  const [st, setSt] = useState<GitStatus | null>(null);
  const dir = project?.dir || '';

  const load = useCallback(async (): Promise<void> => {
    if (!dir) return;
    try { setSt(await window.amc.git.status(dir) as GitStatus); } catch { /* git 不可用 */ }
  }, [dir]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);

  // 辅助会话扎根项目目录 + 回放历史（引擎侧按会话持久）
  const gitSid = sid ? `${sid}-git` : null;
  const restore = useConversation((s) => s.restore);
  useEffect(() => {
    if (gitSid && dir) {
      void engine.bindProject(gitSid, dir).catch(() => {});
      void restore(gitSid);
    }
  }, [gitSid, dir, restore]);

  if (!project) {
    return <div className="p-6 text-center text-ui-xs text-foreground-subtlest">选择项目后查看 Git 状态</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-2">
        {!st ? (
          <div className="py-4 text-center text-ui-xs text-foreground-subtlest">读取中…</div>
        ) : !st.ok ? (
          <div className="py-4 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
            Git 不可用<br />{st.error}
          </div>
        ) : (
          <>
            {/* 分支概览 */}
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-card px-2.5 py-2 text-ui-xs">
              <span className="truncate font-medium text-foreground">{st.branch || '—'}</span>
              {(st.ahead || 0) > 0 && <span className="shrink-0 text-info">↑{st.ahead}</span>}
              {(st.behind || 0) > 0 && <span className="shrink-0 text-warning">↓{st.behind}</span>}
              <span className="ml-auto shrink-0 font-mono text-foreground-subtlest">{st.head}</span>
              <button type="button" aria-label="刷新"
                className="shrink-0 text-foreground-subtlest hover:text-foreground"
                onClick={() => void load()}>
                <RefreshCwIcon className="size-3" />
              </button>
            </div>

            {/* 变更清单 */}
            <div className="mb-1 flex items-center justify-between">
              <span className="text-ui-2xs font-medium uppercase tracking-wider text-foreground-subtlest">
                变更 {st.changes?.length ?? 0}
              </span>
            </div>
            {(st.changes?.length ?? 0) === 0 ? (
              <div className="py-3 text-center text-ui-xs text-foreground-subtlest">工作区干净</div>
            ) : (
              <div className="grid gap-0.5">
                {st.changes!.map((c) => (
                  <div key={`${c.x}${c.y}${c.path}`} className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-hover/50">
                    <span className={cn('shrink-0 rounded px-1 font-mono text-ui-2xs leading-4', changeCls(c))}>
                      {changeLetter(c)}
                    </span>
                    <span className="min-w-0 truncate font-mono text-ui-2xs text-foreground-subtle" title={c.path}>
                      {c.path}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 最近提交 */}
            {st.log && st.log.length > 0 && (
              <>
                <div className="mb-1 mt-3 text-ui-2xs font-medium uppercase tracking-wider text-foreground-subtlest">最近提交</div>
                <div className="grid gap-1">
                  {st.log.slice(0, 5).map((c, i) => (
                    <div key={c.sha || i} className="flex min-w-0 items-baseline gap-2">
                      <span className="shrink-0 font-mono text-ui-2xs text-brand">{c.sha}</span>
                      <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtle" title={c.subject}>{c.subject}</span>
                      <span className="shrink-0 text-ui-2xs text-foreground-subtlest">{c.when}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      {gitSid && <HelperChat gitSid={gitSid} />}
    </div>
  );
}
