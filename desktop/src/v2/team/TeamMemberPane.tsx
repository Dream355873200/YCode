// TeamMemberPane — 右栏团队成员时间线：成员持久会话的历史（与主对话同一套投影与
// 行渲染）+ 运行中的实时活动 + 插话框（忙时即时注入，闲时作为新任务）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SendIcon } from 'lucide-react';
import { useApp } from '../app/appState';
import { engine } from '../protocol';
import { historyToRows } from '../conversation/projection/historyToRows';
import type { Row } from '../conversation/projection/rows';
import { RowView, foldReads, ReadGroup, type ReadGroupUnit } from '../conversation/RowView';
import { teamApi, type TeamMemberInfo } from './teamApi';

export function TeamMemberPane({ team, member }: { team: string; member: string }) {
  const { project } = useApp();
  const dir = project?.dir ?? '';
  const [info, setInfo] = useState<TeamMemberInfo | null>(null);
  const [msgs, setMsgs] = useState<unknown[]>([]);
  const [live, setLive] = useState<{ status: string; activity: string }>({ status: 'idle', activity: '' });
  const [draft, setDraft] = useState('');

  const load = useCallback(async (): Promise<void> => {
    if (!dir) return;
    const d = await teamApi.detail(dir, team);
    const m = d.data?.members.find((x) => x.name === member) ?? null;
    setInfo(m);
    const l = await teamApi.live(dir, team, member);
    if (l.ok && l.data) setLive({ status: l.data.status, activity: l.data.activity });
    if (m) {
      const h = await engine.get(`/sessions/${encodeURIComponent(m.sessionId)}/messages`).catch(() => null);
      if (Array.isArray(h?.body)) setMsgs(h!.body as unknown[]);
    }
  }, [dir, team, member]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(() => foldReads(historyToRows(msgs as never)), [msgs]);
  const steer = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || !dir) return;
    setDraft('');
    await teamApi.say(dir, team, text, member === 'leader' ? '' : member);
    void load();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className={live.status === 'running' ? 'size-2 animate-pulse rounded-full bg-brand' : 'size-2 rounded-full bg-foreground-subtlest'} />
          <span className="text-ui-sm font-medium text-foreground">{member === 'leader' ? '队长' : member}</span>
          <span className="ml-auto truncate text-ui-xs text-foreground-subtlest">{live.activity || (live.status === 'running' ? '工作中' : '空闲')}</span>
        </div>
        {info?.role && <div className="mt-1 line-clamp-2 text-ui-xs text-foreground-subtle" title={info.role}>{info.role}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {rows.length === 0 && <div className="py-8 text-center text-ui-xs text-foreground-subtlest">还没有会话历史</div>}
        {rows.map((r) => ((r as { kind: string }).kind === 'readgroup'
          ? <ReadGroup key={r.id} group={r as ReadGroupUnit} />
          : <RowView key={(r as Row).id} row={r as Row} sid={info?.sessionId ?? ''} />))}
      </div>
      <div className="flex shrink-0 items-end gap-1.5 border-t border-border/50 p-2">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={1}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void steer(); } }}
          placeholder={`对 ${member === 'leader' ? '队长' : member} 说…`}
          className="min-h-0 flex-1 resize-none rounded-lg border border-input-border bg-input px-2 py-1.5 text-ui-sm text-foreground outline-none placeholder:text-foreground-subtlest focus:border-input-border-focused" />
        <button type="button" aria-label="发送" disabled={!draft.trim()} onClick={() => void steer()}
          className="flex size-8 items-center justify-center rounded-lg bg-brand text-foreground-inverse disabled:opacity-40">
          <SendIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
