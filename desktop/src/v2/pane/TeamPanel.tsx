// TeamPanel — 右栏团队面板（Teams v3）：群聊消息总线视图 + 成员时间线
// + 插话入口 + 创建团队表单。
//
// 三层视图：
//   1. 团队列表 / 创建表单（无团队或点「新建团队」）
//   2. 群聊视图：chat.jsonl 的渲染（用户/leader/成员/系统/审批卡），
//      composer 带 @路由（无 @ = leader 插话）
//   3. 成员视图：点成员进入其持久会话时间线 + 插话框
//
// 数据全部来自引擎 /teams* 轮询（成员运行中的细粒度事件不进群聊，
// 设计如此——点成员才看时间线）。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeftIcon, BotIcon, CheckIcon, CrownIcon, MessageCircleQuestionIcon, PencilIcon, PlusIcon, SaveIcon, SendIcon, SquareIcon, UserIcon, XIcon,
} from 'lucide-react';
import { renderMD } from '../../lib/markdown';
import { engine } from '../protocol';
import { useApp } from '../app/appState';
import { cn } from '../components/lib/utils';

interface TeamMemberInfo {
  name: string; role: string; mode?: string; toolsets: string[];
  isLeader: boolean; sessionId: string; status: string; activity: string;
}
interface TeamDetail {
  name: string; dir: string; goal: string; leaderMode: string; members: TeamMemberInfo[];
}
interface ChatMsg {
  ts: string; from: string; to?: string; type: string; text: string; request_id?: string;
}

type View = { kind: 'home' } | { kind: 'chat'; team: TeamDetail } | { kind: 'member'; team: TeamDetail; member: TeamMemberInfo };

async function api<T>(p: Promise<{ body?: unknown }>): Promise<T | null> {
  try {
    const r = await p;
    return (r.body ?? null) as T | null;
  } catch {
    return null;
  }
}

export function TeamPanel() {
  const { project } = useApp();
  const dir = project?.dir ?? '';
  const [view, setView] = useState<View>({ kind: 'home' });
  const [teams, setTeams] = useState<Array<{ name: string; goal: string; members: number }>>([]);
  const [creating, setCreating] = useState(false);

  const loadTeams = useCallback(async (): Promise<void> => {
    if (!dir) return;
    const r = await api<{ teams: typeof teams }>(engine.get(`/teams?dir=${encodeURIComponent(dir)}`));
    if (r) setTeams(r.teams || []);
  }, [dir]);

  useEffect(() => {
    void loadTeams();
    setView({ kind: 'home' });
  }, [loadTeams]);

  if (!dir) {
    return <div className="p-6 text-center text-ui-xs text-foreground-subtlest">选择项目后使用团队</div>;
  }
  if (creating) {
    return <CreateTeamForm dir={dir} onDone={() => { setCreating(false); void loadTeams(); }} onCancel={() => setCreating(false)} />;
  }
  if (view.kind === 'chat') {
    return <GroupChat view={view} dir={dir} onBack={() => { setView({ kind: 'home' }); void loadTeams(); }} onOpenMember={(m) => setView({ kind: 'member', team: view.team, member: m })} />;
  }
  if (view.kind === 'member') {
    return <MemberView view={view} dir={dir} onBack={() => setView({ kind: 'chat', team: view.team })} />;
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-ui-xs font-medium text-foreground">团队</div>
        <button type="button"
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-ui-2xs text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => setCreating(true)}>
          <PlusIcon className="size-3" /> 新建团队
        </button>
      </div>
      {teams.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center text-ui-xs leading-relaxed text-foreground-subtlest">
          <BotIcon className="size-6 text-foreground-subtlest" />
          本项目还没有团队<br />
          团队由你创建：队长拆解分派，成员持久协作<br />
          群聊里你可以随时插话指挥
        </div>
      ) : (
        <div className="grid gap-1.5">
          {teams.map((t) => (
            <button key={t.name} type="button"
              className="rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-brand/50 hover:bg-hover"
              onClick={async () => {
                const d = await api<TeamDetail>(engine.get(`/teams/${t.name}?dir=${encodeURIComponent(dir)}`));
                if (d) setView({ kind: 'chat', team: d });
              }}>
              <div className="text-ui-xs font-medium text-foreground">{t.name}</div>
              <div className="mt-0.5 line-clamp-2 text-ui-2xs text-foreground-subtlest">{t.goal}</div>
              <div className="mt-1 text-ui-2xs text-foreground-subtlest">{t.members} 名成员</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- 群聊视图 ----------

function GroupChat({ view, dir, onBack, onOpenMember }: {
  view: Extract<View, { kind: 'chat' }>; dir: string;
  onBack: () => void; onOpenMember: (m: TeamMemberInfo) => void;
}) {
  const { team } = view;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [at, setAt] = useState('');
  const [total, setTotal] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef(team);
  detailRef.current = team;

  const load = useCallback(async (): Promise<void> => {
    const t = detailRef.current;
    const after = t ? total : 0;
    const r = await api<{ messages: ChatMsg[]; total: number }>(
      engine.get(`/teams/${t.name}/chat?dir=${encodeURIComponent(dir)}&after=${Math.max(0, after - 20)}`));
    if (!r) return;
    setTotal(r.total || 0);
    // 详情轮询带状态刷新
    const d = await api<TeamDetail>(engine.get(`/teams/${t.name}?dir=${encodeURIComponent(dir)}`));
    if (d) detailRef.current = d;
    setMsgs(r.messages || []);
  }, [dir, total]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  const members = detailRef.current.members;
  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await engine.post(`/teams/${team.name}/chat?dir=${encodeURIComponent(dir)}`, { text, at });
    setAt('');
    void load();
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 头：队名 + 成员 chips（点成员进时间线） */}
      <div className="shrink-0 border-b border-border/50 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="返回" className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground" onClick={onBack}>
            <ArrowLeftIcon className="size-3.5" />
          </button>
          <span className="text-ui-xs font-medium text-foreground">{team.name}</span>
          <span className="ml-auto text-ui-2xs text-foreground-subtlest">{team.goal}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {members.map((m) => (
            <span key={m.name}
              className={cn('flex items-center rounded-full border text-ui-2xs transition-colors',
                m.status === 'running' ? 'border-brand/50 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover hover:text-foreground')}>
              <button type="button" className="flex items-center gap-1 py-0.5 pl-1.5 pr-1.5"
                onClick={() => onOpenMember(m)}
                title={m.activity ? `${m.role}（正在：${m.activity}）` : m.role}>
                <StatusDot status={m.status} />
                {m.isLeader && <CrownIcon className="size-2.5 text-amber-500" />}
                {m.name}
              </button>
              {m.status === 'running' && (
                <button type="button" aria-label={`停止 ${m.name}`} title={`停止 ${m.name} 当前的运行`}
                  className="mr-1 rounded-full p-0.5 text-foreground-subtlest hover:bg-destructive/15 hover:text-destructive"
                  onClick={() => void engine.post('/interrupt', { session_id: m.sessionId, reason: '用户在团队面板停止' })}>
                  <SquareIcon className="size-2" />
                </button>
              )}
            </span>
          ))}
        </div>
      </div>
      {/* 消息流 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="grid gap-2">
          {msgs.map((m, i) => <ChatBubble key={i} m={m} members={members} onReply={(who) => setAt(who === 'leader' ? '' : who)} />)}
        </div>
        <div ref={bottomRef} />
      </div>
      {/* composer：@路由选择 + 输入 */}
      <div className="shrink-0 border-t border-border/50 p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          <span className="text-ui-2xs text-foreground-subtlest">发给</span>
          <RouteChip label="leader（队长）" active={!at} onClick={() => setAt('')} />
          {members.filter((m) => !m.isLeader).map((m) => (
            <RouteChip key={m.name} label={`@${m.name}`} active={at === m.name} onClick={() => setAt(m.name)} />
          ))}
        </div>
        <div className="flex items-end gap-1.5">
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={2} placeholder={at ? `@${at} …` : '向队长下达目标 / 插话…'}
            className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-input px-2 py-1.5 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest focus:border-brand/60" />
          <button type="button" aria-label="发送" disabled={!draft.trim()}
            className="flex size-8 items-center justify-center rounded-lg bg-brand text-white disabled:opacity-40"
            onClick={() => void send()}>
            <SendIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function RouteChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button"
      className={cn('rounded-full border px-1.5 py-0.5 text-ui-2xs transition-colors',
        active ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover hover:text-foreground')}
      onClick={onClick}>
      {label}
    </button>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-block size-1.5 shrink-0 rounded-full',
      status === 'running' ? 'animate-pulse bg-brand' : 'bg-neutral-500/50',
    )} />
  );
}

function ChatBubble({ m, members, onReply }: { m: ChatMsg; members: TeamMemberInfo[]; onReply: (who: string) => void }) {
  const { post } = engine;
  const [settled, setSettled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const sender = members.find((x) => x.name === m.from);

  // 提问：团队会话的 confirm/AskUser 转成群聊提问（不阻塞），回复经 composer
  // 路由回提问者——醒目卡片 + 一键「回复」切好 @ 目标
  if (m.type === 'question') {
    const toUser = m.to === 'user';
    return (
      <div className="rounded-xl border border-brand/40 bg-brand/5 px-3 py-2">
        <div className="flex items-center gap-1.5 text-ui-2xs font-medium text-brand">
          <MessageCircleQuestionIcon className="size-3" />
          {m.from} {toUser ? '向你提问' : '向队长提问'}
        </div>
        <div className="v2-md mt-1 text-ui-xs leading-relaxed text-foreground" dangerouslySetInnerHTML={{ __html: renderMD(m.text) }} />
        {toUser && (
          <button type="button"
            className="mt-2 rounded-md border border-brand/50 px-2 py-0.5 text-ui-2xs text-brand hover:bg-brand/10"
            onClick={() => onReply(m.from)}>
            回复 {m.from}
          </button>
        )}
      </div>
    );
  }

  if (m.type === 'permission' && m.request_id) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2">
        <div className="flex items-center gap-1.5 text-ui-2xs font-medium text-destructive">
          <XIcon className="size-3" /> 审批升级 · {m.from === 'system' ? (m.to || '成员') : m.from}
        </div>
        <div className="mt-1 text-ui-xs leading-relaxed text-foreground">{m.text}</div>
        {!settled && (
          <div className="mt-2 flex gap-1.5">
            <button type="button"
              className="flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-ui-2xs text-white"
              onClick={async () => { await post('/approve', { request_id: m.request_id, allow: true }); setSettled(true); }}>
              <CheckIcon className="size-3" /> 批准
            </button>
            <button type="button"
              className="rounded-md border border-border px-2 py-1 text-ui-2xs text-foreground-subtle hover:bg-hover"
              onClick={async () => { await post('/approve', { request_id: m.request_id, allow: false, reason: '用户拒绝' }); setSettled(true); }}>
              拒绝
            </button>
          </div>
        )}
        {settled && <div className="mt-1.5 text-ui-2xs text-foreground-subtlest">已处理</div>}
      </div>
    );
  }
  if (m.type === 'system' || m.type === 'steer') {
    return <div className="text-center text-ui-2xs text-foreground-subtlest">{m.text}</div>;
  }
  const isUser = m.from === 'user';
  return (
    <div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
      <div className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-card',
        isUser ? 'text-foreground-subtle' : 'text-brand')}>
        {isUser ? <UserIcon className="size-3" /> : <BotIcon className="size-3" />}
      </div>
      <div className={cn('max-w-[85%] rounded-xl px-2.5 py-1.5',
        isUser ? 'bg-brand/15' : 'bg-card border border-border')}>
        <div className="text-ui-2xs text-foreground-subtlest">
          {isUser ? '你' : (sender ? `${sender.isLeader ? '队长 · ' : ''}${m.from}` : m.from)}
          {m.type === 'dispatch' && ' · 分派'}
          {m.type === 'result' && ' · 产出'}
          {m.to && m.to !== m.from && <span> → {m.to}</span>}
        </div>
        <div className={cn('v2-md mt-0.5 break-words text-ui-xs leading-relaxed text-foreground',
          !expanded && m.text.length > 600 && 'max-h-48 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]')}
          dangerouslySetInnerHTML={{ __html: renderMD(m.text) }} />
        {m.text.length > 600 && (
          <button type="button" className="mt-1 text-ui-2xs text-brand hover:underline" onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : '展开全文'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- 成员视图 ----------

interface RawBlock { type: string; text?: string; name?: string; input?: unknown; thinking?: string }
interface RawMsg { role: string; content: RawBlock[] }

function MemberView({ view, dir, onBack }: {
  view: Extract<View, { kind: 'member' }>; dir: string; onBack: () => void;
}) {
  const { team, member } = view;
  const [msgs, setMsgs] = useState<RawMsg[]>([]);
  const [live, setLive] = useState<{ status: string; activity: string; events: Array<{ ts: string; type: string; text: string }> }>({ status: 'idle', activity: '', events: [] });
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [teamNow, setTeamNow] = useState(team);

  const load = useCallback(async (): Promise<void> => {
    const l = await api<{ status: string; activity: string; events: typeof live.events }>(
      engine.get(`/teams/${team.name}/members/${member.name}/live?dir=${encodeURIComponent(dir)}`));
    if (l) setLive(l);
    const hist = await api<RawMsg[]>(engine.get(`/sessions/${encodeURIComponent(member.sessionId)}/messages`));
    if (Array.isArray(hist)) setMsgs(hist);
  }, [team.name, member.name, member.sessionId, dir]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [load]);

  const steer = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await engine.post(`/teams/${team.name}/chat?dir=${encodeURIComponent(dir)}`, { text, at: member.name });
    void load();
  };

  if (editing) {
    return (
      <EditMemberForm
        team={teamNow} member={member} dir={dir}
        onSaved={(d) => { setTeamNow(d); setEditing(false); }}
        onCancel={() => setEditing(false)} />
    );
  }
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/50 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="返回群聊" className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground" onClick={onBack}>
            <ArrowLeftIcon className="size-3.5" />
          </button>
          <StatusDot status={live.status} />
          <span className="text-ui-xs font-medium text-foreground">{member.name}</span>
          <button type="button" aria-label="编辑角色卡" title="编辑角色卡与能力"
            className="rounded p-0.5 text-foreground-subtlest hover:bg-hover hover:text-foreground"
            onClick={() => setEditing(true)}>
            <PencilIcon className="size-3" />
          </button>
          <span className="ml-auto truncate text-ui-2xs text-foreground-subtlest">{live.activity || member.role}</span>
        </div>
      </div>
      {/* 会话时间线（持久历史 + 运行中事件尾） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="grid gap-2">
          {msgs.map((msg, i) => <MemberRow key={i} msg={msg} />)}
          {live.events.slice(-3).map((e, i) => (
            live.status === 'running' ? (
              <div key={`live-${i}`} className="flex items-center gap-1.5 text-ui-2xs text-foreground-subtlest">
                <span className="size-1 animate-pulse rounded-full bg-brand" />{e.text}
              </div>
            ) : null
          ))}
        </div>
        {msgs.length === 0 && live.status === 'idle' && (
          <div className="py-8 text-center text-ui-xs text-foreground-subtlest">该成员还没有会话历史</div>
        )}
      </div>
      {/* 插话框 */}
      <div className="flex shrink-0 items-end gap-1.5 border-t border-border/50 p-2">
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void steer(); } }}
          rows={1} placeholder={`向 ${member.name} 插话（运行中即时注入，空闲时作为新任务）…`}
          className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-input px-2 py-1.5 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest focus:border-brand/60" />
        <button type="button" aria-label="发送插话" disabled={!draft.trim()}
          className="flex size-8 items-center justify-center rounded-lg bg-brand text-white disabled:opacity-40"
          onClick={() => void steer()}>
          <SendIcon className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function MemberRow({ msg }: { msg: RawMsg }) {
  if (msg.role === 'user') {
    const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    return <div className="ml-auto max-w-[85%] rounded-xl bg-brand/15 px-2.5 py-1.5 text-ui-xs leading-relaxed text-foreground">{text}</div>;
  }
  if (msg.role !== 'assistant') return null;
  return (
    <div className="grid gap-1">
      {msg.content.map((c, i) => {
        if (c.type === 'text' && c.text) {
          return <div key={i} className="whitespace-pre-wrap break-words text-ui-xs leading-relaxed text-foreground">{c.text}</div>;
        }
        if (c.type === 'tool_use') {
          return (
            <div key={i} className="flex items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 py-0.5 text-ui-2xs text-foreground-subtle">
              <span className="rounded bg-neutral-500/15 px-1 font-mono">{c.name}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

// ---------- 编辑角色卡 ----------

/** 编辑成员/队长的角色卡与能力：PUT /teams/{name} 整体提交。
    成员持久会话按名复用——角色卡下一轮生效，跨任务记忆不丢。 */
function EditMemberForm({ team, member, dir, onSaved, onCancel }: {
  team: TeamDetail; member: TeamMemberInfo; dir: string;
  onSaved(team: TeamDetail): void; onCancel(): void;
}) {
  const [role, setRole] = useState(member.role);
  const [byMode, setByMode] = useState(!!member.mode);
  const [mode, setMode] = useState(member.mode || '');
  const [toolsets, setToolsets] = useState<string[]>(member.toolsets.filter((t) => t !== 'team'));
  const [leaderMode, setLeaderMode] = useState(team.leaderMode || 'accept_edits');
  const [toolsetCatalog, setToolsetCatalog] = useState<Array<{ id: string; notes: string }>>([]);
  const [modes, setModes] = useState<Array<{ id: string; name: string }>>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await api<{ toolsets: Record<string, { tools: string[]; notes: string[] }>; modes: Array<{ id: string; name: string }> }>(engine.get('/modes'));
      if (!r) return;
      if (r.toolsets) {
        setToolsetCatalog(Object.entries(r.toolsets)
          .filter(([id]) => id !== 'team')
          .map(([id, v]) => ({ id, notes: (v.notes || []).join('；') })));
      }
      if (r.modes) setModes(r.modes.map((m) => ({ id: m.id, name: m.name })));
    })();
  }, []);

  const save = async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      const leaderNow = team.members.find((m) => m.isLeader)!;
      const nextLeader = member.isLeader
        ? { role, mode: leaderMode, toolsets: [] }
        : { role: leaderNow.role, mode: team.leaderMode || 'accept_edits', toolsets: leaderNow.toolsets.filter((t) => t !== 'team') };
      const nextMembers = team.members
        .filter((m) => !m.isLeader)
        .map((m) => (m.name === member.name
          ? { name: m.name, role, mode: byMode ? mode : '', toolsets }
          : { name: m.name, role: m.role, mode: m.mode || '', toolsets: m.toolsets.filter((t) => t !== 'team') }));
      const d = await api<TeamDetail>(engine.post(`/teams/${team.name}/update?dir=${encodeURIComponent(dir)}`, {
        goal: team.goal, leader: nextLeader, leaderMode: nextLeader.mode, members: nextMembers,
      }));
      if (d) onSaved(d);
      else setErr('保存失败（校验未过或引擎不可达）');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-2">
        <button type="button" aria-label="取消" className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground" onClick={onCancel}>
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="text-ui-xs font-medium text-foreground">编辑 {member.isLeader ? '队长' : `成员 ${member.name}`}</span>
      </div>
      <div className="scroll-fine min-h-0 flex-1 overflow-y-auto p-3">
        <div className="rounded-xl border border-border bg-card p-2.5">
          <div className="mb-1.5 text-ui-2xs font-medium text-foreground-subtle">角色卡（身份与职责；下一轮生效，历史记忆不丢）</div>
          <textarea value={role} onChange={(e) => setRole(e.target.value)} rows={4}
            className={cn(inputCls, 'resize-none')} />
        </div>
        {member.isLeader ? (
          <div className="mt-3 rounded-xl border border-border bg-card p-2.5">
            <div className="mb-1.5 text-ui-2xs font-medium text-foreground-subtle">审批策略</div>
            <div className="flex flex-wrap gap-1">
              {PERM_MODES.map((m) => (
                <button key={m.id} type="button" title={m.hint}
                  className={cn('rounded-full border px-2 py-0.5 text-ui-2xs transition-colors',
                    leaderMode === m.id ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                  onClick={() => setLeaderMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="mt-3 rounded-xl border border-border bg-card p-2.5">
              <div className="mb-1.5 text-ui-2xs font-medium text-foreground-subtle">能力来源</div>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button"
                  className={cn('rounded-full border px-2 py-0.5 text-ui-2xs transition-colors', !byMode ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                  onClick={() => setByMode(false)}>按工具集</button>
                <button type="button"
                  className={cn('rounded-full border px-2 py-0.5 text-ui-2xs transition-colors', byMode ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                  onClick={() => setByMode(true)}>继承模式</button>
                {byMode && (
                  <select value={mode} onChange={(e) => setMode(e.target.value)}
                    className="rounded-md border border-border bg-input px-1 py-0.5 text-ui-2xs text-foreground outline-none">
                    <option value="">选择模式…</option>
                    {modes.map((md) => <option key={md.id} value={md.id}>{md.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            {!byMode && toolsetCatalog.length > 0 && (
              <div className="mt-3 rounded-xl border border-border bg-card p-2.5">
                <div className="mb-1.5 text-ui-2xs font-medium text-foreground-subtle">工具集</div>
                <div className="flex flex-wrap gap-1">
                  {toolsetCatalog.map((t) => (
                    <button key={t.id} type="button" title={t.notes || undefined}
                      className={cn('rounded-full border px-1.5 py-0.5 text-ui-2xs transition-colors',
                        toolsets.includes(t.id) ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                      onClick={() => setToolsets((ts) => ts.includes(t.id) ? ts.filter((x) => x !== t.id) : [...ts, t.id])}>
                      {t.id}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {err && (
          <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-ui-2xs text-destructive">{err}</div>
        )}
      </div>
      <div className="shrink-0 border-t border-border/50 p-3">
        <button type="button" disabled={busy || !role.trim()}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-ui-xs font-medium text-white transition-opacity disabled:opacity-40"
          onClick={() => void save()}>
          <SaveIcon className="size-3.5" /> {busy ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}

// ---------- 创建团队 ----------

/** 成员表单状态：能力来源 = 显式工具集白名单，或继承某个模式（引擎叠加生效）。 */
interface MemberDraft {
  name: string;
  role: string;
  byMode: boolean;
  mode: string;
  toolsets: string[];
}

/** 预设模板：把空白表单变成一次点选。 */
const TEMPLATES: Array<{ id: string; label: string; name: string; goal: string; leaderRole: string; members: MemberDraft[] }> = [
  {
    id: 'qa', label: '测试团队',
    name: 'qa-team', goal: '负责本项目的功能测试与验收',
    leaderRole: '拆解测试需求，把可测点分派给测试员，汇总验收结论。',
    members: [
      { name: 'tester', role: '测试工程师：执行功能测试，输出用例与结果清单。', byMode: false, mode: '', toolsets: ['test-report', 'device'] },
    ],
  },
  {
    id: 'research', label: '调研小组',
    name: 'research', goal: '围绕给定课题完成调研并产出结论报告',
    leaderRole: '拆解调研问题，分派检索与分析任务，汇总成报告。',
    members: [
      { name: 'scout', role: '调研员：多路检索与资料收集，输出要点清单。', byMode: false, mode: '', toolsets: [] },
    ],
  },
  {
    id: 'doc', label: '文档小组',
    name: 'docs', goal: '把项目素材整理成结构化文档',
    leaderRole: '规划文档结构，分派撰写与审校，交付成稿。',
    members: [
      { name: 'writer', role: '写手：按大纲撰写文档章节，产出 Markdown。', byMode: false, mode: '', toolsets: [] },
    ],
  },
];

const PERM_MODES: Array<{ id: string; label: string; hint: string }> = [
  { id: 'accept_edits', label: '自动编辑', hint: '写文件自动通过，危险操作仍需审批' },
  { id: 'default', label: '手动审批', hint: '每个写操作都弹卡确认' },
  { id: 'bypass', label: '全自动', hint: '全部放行（慎用）' },
];

function blankMember(): MemberDraft {
  return { name: '', role: '', byMode: false, mode: '', toolsets: [] };
}

function CreateTeamForm({ dir, onDone, onCancel }: { dir: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [leaderRole, setLeaderRole] = useState('');
  const [leaderMode, setLeaderMode] = useState('accept_edits');
  const [members, setMembers] = useState<MemberDraft[]>([blankMember()]);
  const [toolsets, setToolsets] = useState<Array<{ id: string; notes: string }>>([]);
  const [modes, setModes] = useState<Array<{ id: string; name: string }>>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await api<{ toolsets: Record<string, { tools: string[]; notes: string[] }>; modes: Array<{ id: string; name: string }> }>(engine.get('/modes'));
      if (!r) return;
      if (r.toolsets) {
        setToolsets(Object.entries(r.toolsets)
          .filter(([id]) => id !== 'team')
          .map(([id, v]) => ({ id, notes: (v.notes || []).join('；') })));
      }
      if (r.modes) setModes(r.modes.map((m) => ({ id: m.id, name: m.name })));
    })();
  }, []);

  const applyTemplate = (t: typeof TEMPLATES[number]): void => {
    setName(t.name);
    setGoal(t.goal);
    setLeaderRole(t.leaderRole);
    setMembers(t.members.map((m) => ({ ...m, toolsets: [...m.toolsets] })));
  };

  const patchMember = (i: number, patch: Partial<MemberDraft>): void => {
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  };

  const submit = async (): Promise<void> => {
    setErr('');
    const clean = members.filter((m) => m.name.trim() && m.role.trim());
    if (clean.length === 0) {
      setErr('至少需要一名填写了标识与角色卡的成员');
      return;
    }
    setBusy(true);
    try {
      const d = await api<TeamDetail>(engine.post('/teams', {
        dir, name: name.trim(), goal, leaderMode,
        leader: { role: leaderRole, toolsets: [] },
        members: clean.map((m) => ({
          name: m.name.trim(), role: m.role,
          mode: m.byMode ? m.mode : '',
          toolsets: m.toolsets,
        })),
      }));
      if (d) onDone();
      else setErr('创建失败：团队名冲突、成员标识不合法或工具集不存在');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border/50 px-3 py-2">
        <button type="button" aria-label="返回" className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground" onClick={onCancel}>
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="text-ui-xs font-medium text-foreground">新建团队</span>
        <span className="ml-auto text-ui-2xs text-foreground-subtlest">队长拆解分派 · 成员持久协作 · 群聊可插话</span>
      </div>
      <div className="scroll-fine min-h-0 flex-1 overflow-y-auto p-3">
        {/* 从模板开始 */}
        <div className="mb-3">
          <div className="mb-1.5 text-ui-2xs font-medium text-foreground-subtle">从模板开始（选后可改）</div>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button"
                className="rounded-full border border-border bg-card px-2.5 py-1 text-ui-2xs text-foreground-subtle transition-colors hover:border-brand/50 hover:bg-hover hover:text-foreground"
                onClick={() => applyTemplate(t)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 团队信息 */}
        <div className="mb-3 rounded-xl border border-border bg-card p-2.5">
          <div className="mb-2 text-ui-2xs font-medium text-foreground-subtle">团队信息</div>
          <div className="flex gap-2">
            <label className="w-28 shrink-0">
              <span className="mb-1 block text-ui-2xs text-foreground-subtlest">标识（小写英文）</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="qa-team" className={inputCls} />
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-ui-2xs text-foreground-subtlest">团队目标</span>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="这个团队负责什么" className={inputCls} />
            </label>
          </div>
        </div>

        {/* 队长 */}
        <div className="mb-3 rounded-xl border border-border bg-card p-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <CrownIcon className="size-3 text-amber-500" />
            <span className="text-ui-2xs font-medium text-foreground-subtle">队长（拆解目标 · 分派 · 汇总）</span>
          </div>
          <textarea value={leaderRole} onChange={(e) => setLeaderRole(e.target.value)} rows={2}
            placeholder="角色卡：队长怎么工作、怎么验收产出"
            className={cn(inputCls, 'resize-none')} />
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {PERM_MODES.map((m) => (
              <button key={m.id} type="button" title={m.hint}
                className={cn('rounded-full border px-2 py-0.5 text-ui-2xs transition-colors',
                  leaderMode === m.id ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                onClick={() => setLeaderMode(m.id)}>
                {m.label}
              </button>
            ))}
            <span className="text-ui-2xs text-foreground-subtlest">
              ← 队长的审批策略（{PERM_MODES.find((m) => m.id === leaderMode)?.hint}）
            </span>
          </div>
        </div>

        {/* 成员 */}
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-ui-2xs font-medium text-foreground-subtle">成员（权限统一自动编辑，危险操作升级给用户）</span>
            <button type="button"
              className="flex items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 text-ui-2xs text-foreground-subtle hover:bg-hover hover:text-foreground"
              onClick={() => setMembers((ms) => [...ms, blankMember()])}>
              <PlusIcon className="size-3" /> 加成员
            </button>
          </div>
          <div className="grid gap-2">
            {members.map((m, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-2.5">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded-full border border-border bg-surface">
                    <BotIcon className="size-3 text-brand" />
                  </span>
                  <span className="text-ui-2xs font-medium text-foreground-subtle">成员 {i + 1}</span>
                  {members.length > 1 && (
                    <button type="button" aria-label="移除成员"
                      className="ml-auto rounded p-1 text-foreground-subtlest hover:bg-hover hover:text-destructive"
                      onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>
                      <XIcon className="size-3" />
                    </button>
                  )}
                </div>
                <div className="grid gap-2">
                  <div className="flex gap-2">
                    <label className="w-24 shrink-0">
                      <span className="mb-1 block text-ui-2xs text-foreground-subtlest">标识</span>
                      <input value={m.name} onChange={(e) => patchMember(i, { name: e.target.value })}
                        placeholder="tester" className={inputCls} />
                    </label>
                    <label className="min-w-0 flex-1">
                      <span className="mb-1 block text-ui-2xs text-foreground-subtlest">角色卡（身份与职责）</span>
                      <input value={m.role} onChange={(e) => patchMember(i, { role: e.target.value })}
                        placeholder="例：测试工程师，执行用例并输出结果清单" className={inputCls} />
                    </label>
                  </div>
                  <div>
                    <span className="mb-1 block text-ui-2xs text-foreground-subtlest">能力来源</span>
                    <div className="flex flex-wrap items-center gap-1">
                      <button type="button"
                        className={cn('rounded-full border px-2 py-0.5 text-ui-2xs transition-colors',
                          !m.byMode ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                        onClick={() => patchMember(i, { byMode: false })}>
                        按工具集
                      </button>
                      <button type="button"
                        className={cn('rounded-full border px-2 py-0.5 text-ui-2xs transition-colors',
                          m.byMode ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                        onClick={() => patchMember(i, { byMode: true })}>
                        继承模式
                      </button>
                      {m.byMode ? (
                        <select value={m.mode} onChange={(e) => patchMember(i, { mode: e.target.value })}
                          className="rounded-md border border-border bg-input px-1 py-0.5 text-ui-2xs text-foreground outline-none">
                          <option value="">选择模式…</option>
                          {modes.map((md) => <option key={md.id} value={md.id}>{md.name}</option>)}
                        </select>
                      ) : (
                        <span className="text-ui-2xs text-foreground-subtlest">在下方勾选工具集（不选 = 纯对话 + 基础工具）</span>
                      )}
                    </div>
                  </div>
                  {!m.byMode && toolsets.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {toolsets.map((t) => (
                        <button key={t.id} type="button" title={t.notes || undefined}
                          className={cn('rounded-full border px-1.5 py-0.5 text-ui-2xs transition-colors',
                            m.toolsets.includes(t.id) ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                          onClick={() => patchMember(i, {
                            toolsets: m.toolsets.includes(t.id) ? m.toolsets.filter((x) => x !== t.id) : [...m.toolsets, t.id],
                          })}>
                          {t.id}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {err && (
          <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-ui-2xs text-destructive">{err}</div>
        )}
      </div>
      {/* 底部 CTA */}
      <div className="shrink-0 border-t border-border/50 p-3">
        <button type="button" disabled={busy || !name.trim() || !leaderRole.trim()}
          className="w-full rounded-lg bg-brand px-3 py-2 text-ui-xs font-medium text-white transition-opacity disabled:opacity-40"
          onClick={() => void submit()}>
          {busy ? '创建中…' : '创建团队'}
        </button>
        <div className="mt-1.5 text-center text-ui-2xs text-foreground-subtlest">
          创建后队长在群聊里等你下达第一个目标
        </div>
      </div>
    </div>
  );
}

const inputCls = 'min-w-0 rounded-lg border border-border bg-input px-2 py-1.5 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest focus:border-brand/60';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-ui-2xs font-medium text-foreground-subtle">{label}</span>
      {children}
    </label>
  );
}
