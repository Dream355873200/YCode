// TeamView — 团队对话（主区）：团队是一种对话。顶部成员条（状态 / 正在做什么，
// 点成员在右栏看其时间线），中间群聊，底部带 @路由的输入框（不 @ = 交给队长）。
// 数据来自引擎 /teams* 轮询（成员运行在引擎侧，没有直播流）。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckIcon, CrownIcon, EllipsisIcon, MessageCircleQuestionIcon, PencilIcon, SendIcon, ShieldAlertIcon,
  SquareIcon, Trash2Icon, UserIcon, UsersIcon, XIcon,
} from 'lucide-react';
import { renderMD } from '../../lib/markdown';
import { useApp } from '../app/appState';
import { AgentAvatar } from '../app/agentIcon';
import { useWorkspace } from '../app/workspace';
import { Button } from '../components/ui/button';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { cn } from '../components/lib/utils';
import { clock } from '../lib/time';
import { EditTeamDialog } from './TeamDialogs';
import { memberTabId, teamApi, type TeamChatMsg, type TeamDetail, type TeamMemberInfo } from './teamApi';

const POLL_MS = 2500;

function MemberChip({ m, onOpen, onStop }: { m: TeamMemberInfo; onOpen(): void; onStop(): void }) {
  const { modes } = useApp();
  const agent = modes.find((x) => x.id === m.agent);
  const running = m.status === 'running';
  return (
    <span className={cn(
      'group flex h-7 max-w-56 shrink-0 items-center gap-1.5 rounded-full border pl-1 pr-1.5 text-ui-xs transition-colors',
      running ? 'border-brand/50 bg-brand/8 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover hover:text-foreground',
    )}>
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-1.5" title={m.activity ? `正在：${m.activity}` : m.role}>
        <AgentAvatar icon={agent?.icon} size="sm" className="rounded-full" />
        {m.isLeader && <CrownIcon className="size-3 shrink-0 text-warning" />}
        <span className="shrink-0 font-medium">{m.isLeader ? '队长' : m.name}</span>
        {running && <span className="min-w-0 truncate text-foreground-subtlest">{m.activity || '工作中'}</span>}
      </button>
      {running && (
        <button type="button" aria-label={`停止 ${m.name}`} title={`停止 ${m.name} 当前的运行`} onClick={onStop}
          className="rounded-full p-0.5 text-foreground-subtlest hover:bg-destructive/15 hover:text-destructive">
          <SquareIcon className="size-2.5 fill-current" />
        </button>
      )}
    </span>
  );
}

function Bubble({ m, team, onReply }: { m: TeamChatMsg; team: TeamDetail; onReply(who: string): void }) {
  const { modes } = useApp();
  const [settled, setSettled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const sender = team.members.find((x) => x.name === m.from);
  const time = Date.parse(m.ts);

  if (m.type === 'question') {
    const toUser = m.to === 'user';
    return (
      <div className="rounded-2xl border border-brand/40 bg-brand/5 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-ui-xs font-medium text-brand">
          <MessageCircleQuestionIcon className="size-3.5" />
          {m.from === 'leader' ? '队长' : m.from} {toUser ? '向你提问' : '向队长提问'}
        </div>
        <div className="v2-md mt-1 text-ui-sm leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: renderMD(m.text) }} />
        {toUser && (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => onReply(m.from)}>回复</Button>
        )}
      </div>
    );
  }
  if (m.type === 'permission' && m.request_id) {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/5 px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-ui-xs font-medium text-warning">
          <ShieldAlertIcon className="size-3.5" />需要你批准 · {m.to || m.from}
        </div>
        <div className="mt-1 text-ui-sm leading-relaxed text-foreground">{m.text}</div>
        {settled ? <div className="mt-1.5 text-ui-xs text-foreground-subtlest">已处理</div> : (
          <div className="mt-2 flex gap-1.5">
            <Button size="sm" onClick={async () => { await teamApi.approve(m.request_id!, true); setSettled(true); }}>
              <CheckIcon />批准
            </Button>
            <Button size="sm" variant="outline" onClick={async () => { await teamApi.approve(m.request_id!, false); setSettled(true); }}>
              <XIcon />拒绝
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (m.type === 'system' || m.type === 'steer') {
    return <div className="text-center text-ui-xs text-foreground-subtlest">{m.text}</div>;
  }
  const isUser = m.from === 'user';
  const agent = modes.find((x) => x.id === sender?.agent);
  const long = m.text.length > 600;
  return (
    <div className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
      {isUser
        ? <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground-subtle"><UserIcon className="size-3.5" /></span>
        : <AgentAvatar icon={agent?.icon} size="md" className="size-7 rounded-full" />}
      <div className={cn('min-w-0 max-w-[85%]', isUser && 'flex flex-col items-end')}>
        <div className="mb-0.5 flex items-center gap-1.5 text-ui-2xs text-foreground-subtlest">
          <span className="font-medium text-foreground-subtle">{isUser ? '你' : sender?.isLeader ? '队长' : m.from}</span>
          {m.type === 'dispatch' && <span className="rounded bg-info/12 px-1 text-info">分派</span>}
          {m.type === 'result' && <span className="rounded bg-success/12 px-1 text-success">产出</span>}
          {m.to && m.to !== m.from && m.to !== 'user' && <span>给 {m.to === 'leader' ? '队长' : m.to}</span>}
          {Number.isFinite(time) && <span>{clock(time)}</span>}
        </div>
        <div className={cn('rounded-2xl px-3 py-2', isUser ? 'rounded-tr-sm bg-selected' : 'rounded-tl-sm border border-border bg-card')}>
          <div className={cn('v2-md break-words text-ui-sm leading-relaxed text-foreground',
            !expanded && long && 'max-h-56 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]')}
            dangerouslySetInnerHTML={{ __html: renderMD(m.text) }} />
          {long && (
            <button type="button" className="mt-1 text-ui-xs text-brand hover:underline" onClick={() => setExpanded(!expanded)}>
              {expanded ? '收起' : '展开全文'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function TeamView({ dir, name }: { dir: string; name: string }) {
  const { openPaneTab } = useApp();
  const refreshTeams = useWorkspace((s) => s.refreshTeams);
  const openProject = useWorkspace((s) => s.openProject);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [msgs, setMsgs] = useState<TeamChatMsg[]>([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [at, setAt] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const countRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const [d, c] = await Promise.all([teamApi.detail(dir, name), teamApi.chat(dir, name)]);
    if (d.ok && d.data) { setTeam(d.data); setError(''); } else if (!d.ok) setError(d.error || '团队不存在');
    if (c.ok && c.data) setMsgs(c.data.messages || []);
  }, [dir, name]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // 新消息到达且贴近底部时滚到底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || msgs.length === countRef.current) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160 || countRef.current === 0;
    countRef.current = msgs.length;
    if (near) el.scrollTo({ top: el.scrollHeight });
  }, [msgs.length]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const r = await teamApi.say(dir, name, text, at);
    if (!r.ok) { setDraft(text); setError(r.error || '发送失败'); return; }
    setAt('');
    void load();
  };

  const openMember = (m: TeamMemberInfo): void => {
    openPaneTab({ id: memberTabId(name, m.name), kind: 'teamMember', label: m.isLeader ? '队长' : m.name });
  };

  if (!team) {
    return (
      <div className="flex flex-1 items-center justify-center text-ui-sm text-foreground-subtlest">
        {error || '读取团队…'}
      </div>
    );
  }
  const others = team.members.filter((m) => !m.isLeader);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 成员条 */}
      <div className="shrink-0 border-b border-border/50 px-4 py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand"><UsersIcon className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-ui-sm font-medium text-foreground">{team.name}</div>
            {team.goal && <div className="truncate text-ui-xs text-foreground-subtlest" title={team.goal}>{team.goal}</div>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="团队操作" className="rounded-md p-1 text-foreground-subtle hover:bg-hover hover:text-foreground">
                <EllipsisIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing('leader')}><PencilIcon />编辑团队</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="destructive" onSelect={() => setConfirmDelete(true)}><Trash2Icon />删除团队</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mx-auto mt-2 flex max-w-3xl gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {team.members.map((m) => (
            <span key={m.name} className="group/chip relative flex shrink-0 items-center">
              <MemberChip m={m} onOpen={() => openMember(m)} onStop={() => void teamApi.stop(m.sessionId).then(load)} />
              <button type="button" aria-label={`编辑 ${m.name}`} title="编辑身份与能力" onClick={() => setEditing(m.name)}
                className="ml-0.5 hidden rounded-full p-1 text-foreground-subtlest hover:bg-hover hover:text-foreground group-hover/chip:flex">
                <PencilIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* 群聊 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-3 px-6 py-4">
          {msgs.length === 0 && (
            <div className="py-10 text-center text-ui-sm text-foreground-subtlest">
              给队长一个目标，队长会拆解任务、分派给成员，成员的产出会回到这里
            </div>
          )}
          {msgs.map((m, i) => (
            <Bubble key={`${m.ts}-${i}`} m={m} team={team} onReply={(who) => { setAt(who === 'leader' ? '' : who); inputRef.current?.focus(); }} />
          ))}
        </div>
      </div>

      {/* 输入：@路由 */}
      <div className="shrink-0 px-4 pb-3">
        <div className="mx-auto max-w-3xl rounded-2xl border border-input-border bg-input p-3 focus-within:border-input-border-focused">
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className="mr-0.5 text-ui-xs text-foreground-subtlest">发给</span>
            {[{ key: '', label: '队长' }, ...others.map((m) => ({ key: m.name, label: `@${m.name}` }))].map((r) => (
              <button key={r.key || 'leader'} type="button" onClick={() => setAt(r.key)}
                className={cn('rounded-full border px-2 py-0.5 text-ui-xs transition-colors',
                  at === r.key ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover hover:text-foreground')}>
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <textarea ref={inputRef} value={draft} rows={1}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
              placeholder={at ? `对 @${at} 说…（忙时插话，闲时作为新任务）` : '给队长下达目标或插话…'}
              className="min-h-0 flex-1 resize-none bg-transparent px-1 py-1 text-ui-base text-foreground outline-none placeholder:text-foreground-subtlest" />
            <Button type="button" size="icon-md" disabled={!draft.trim()} aria-label="发送"
              className="rounded-lg bg-brand text-foreground-inverse hover:bg-brand/80" onClick={() => void send()}>
              <SendIcon className="size-4" />
            </Button>
          </div>
          {error && <div className="mt-1.5 text-ui-xs text-destructive">{error}</div>}
        </div>
      </div>

      {editing && (
        <EditTeamDialog team={team} focus={editing} onClose={(changed) => { setEditing(null); if (changed) void load(); }} />
      )}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete}
        title={`删除团队「${team.name}」？`}
        description="成员的会话历史与群聊记录会一并删除，无法恢复。"
        confirmLabel="删除"
        onConfirm={async () => {
          await teamApi.remove(dir, name);
          await refreshTeams(dir);
          openProject(dir);
        }} />
    </div>
  );
}
