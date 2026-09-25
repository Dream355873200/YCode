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
  ArrowLeftIcon, BotIcon, CheckIcon, CrownIcon, PlusIcon, SendIcon, UserIcon, XIcon,
} from 'lucide-react';
import { engine } from '../protocol';
import { useApp } from '../app/appState';
import { cn } from '../components/lib/utils';

interface TeamMemberInfo {
  name: string; role: string; toolsets: string[];
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
            <button key={m.name} type="button"
              className={cn('flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-ui-2xs transition-colors',
                m.status === 'running' ? 'border-brand/50 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover hover:text-foreground')}
              onClick={() => onOpenMember(m)}
              title={`${m.role}${m.activity ? `\n${m.activity}` : ''}`}>
              <StatusDot status={m.status} />
              {m.isLeader && <CrownIcon className="size-2.5 text-amber-500" />}
              {m.name}
            </button>
          ))}
        </div>
      </div>
      {/* 消息流 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <div className="grid gap-2">
          {msgs.map((m, i) => <ChatBubble key={i} m={m} members={members} />)}
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

function ChatBubble({ m, members }: { m: ChatMsg; members: TeamMemberInfo[] }) {
  const { post } = engine;
  const [settled, setSettled] = useState(false);
  const sender = members.find((x) => x.name === m.from);

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
        <div className="mt-0.5 whitespace-pre-wrap break-words text-ui-xs leading-relaxed text-foreground">{m.text}</div>
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

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/50 px-2 py-1.5">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="返回群聊" className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground" onClick={onBack}>
            <ArrowLeftIcon className="size-3.5" />
          </button>
          <StatusDot status={live.status} />
          <span className="text-ui-xs font-medium text-foreground">{member.name}</span>
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

// ---------- 创建团队 ----------

function CreateTeamForm({ dir, onDone, onCancel }: { dir: string; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [leaderRole, setLeaderRole] = useState('');
  const [leaderMode, setLeaderMode] = useState('accept_edits');
  const [members, setMembers] = useState<Array<{ name: string; role: string; toolsets: string[] }>>([
    { name: '', role: '', toolsets: [] },
  ]);
  const [toolsets, setToolsets] = useState<Array<{ id: string; notes: string }>>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await api<{ toolsets: Record<string, { tools: string[]; notes: string[] }> }>(engine.get('/modes'));
      if (r?.toolsets) {
        setToolsets(Object.entries(r.toolsets)
          .filter(([id]) => id !== 'team')
          .map(([id, v]) => ({ id, notes: (v.notes || []).join('；') })));
      }
    })();
  }, []);

  const submit = async (): Promise<void> => {
    setErr('');
    setBusy(true);
    try {
      const d = await api<TeamDetail>(engine.post('/teams', {
        dir, name, goal, leaderMode,
        leader: { role: leaderRole, toolsets: [] },
        members: members.filter((m) => m.name.trim() && m.role.trim()).map((m) => ({ ...m, name: m.name.trim() })),
      }));
      if (d) onDone();
      else setErr('创建失败（名称冲突或校验未过）');
    } finally {
      setBusy(false);
    }
  };

  const toggleTs = (mi: number, id: string): void => {
    setMembers((ms) => ms.map((m, i) => i === mi
      ? { ...m, toolsets: m.toolsets.includes(id) ? m.toolsets.filter((t) => t !== id) : [...m.toolsets, id] }
      : m));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <button type="button" aria-label="取消" className="rounded p-0.5 text-foreground-subtle hover:bg-hover hover:text-foreground" onClick={onCancel}>
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="text-ui-xs font-medium text-foreground">新建团队</span>
      </div>
      <div className="grid gap-2.5">
        <Field label="团队名（小写英文）">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="qa-team"
            className={inputCls} />
        </Field>
        <Field label="团队目标">
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder="负责本项目的测试与验收…"
            className={cn(inputCls, 'resize-none')} />
        </Field>
        <Field label="队长角色卡">
          <textarea value={leaderRole} onChange={(e) => setLeaderRole(e.target.value)} rows={2} placeholder="拆解需求、分派任务、验收产出…"
            className={cn(inputCls, 'resize-none')} />
        </Field>
        <Field label="队长权限模式">
          <div className="flex gap-1">
            {['accept_edits', 'default', 'bypass'].map((m) => (
              <RouteChip key={m} label={m} active={leaderMode === m} onClick={() => setLeaderMode(m)} />
            ))}
          </div>
        </Field>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-ui-2xs font-medium text-foreground-subtle">成员（角色卡 = 身份与能力面，权限统一 auto）</span>
            <button type="button" className="flex items-center gap-0.5 text-ui-2xs text-brand hover:underline"
              onClick={() => setMembers((ms) => [...ms, { name: '', role: '', toolsets: [] }])}>
              <PlusIcon className="size-3" /> 加成员
            </button>
          </div>
          <div className="grid gap-2">
            {members.map((m, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-2">
                <div className="flex gap-1.5">
                  <input value={m.name} onChange={(e) => setMembers((ms) => ms.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    placeholder="tester" className={cn(inputCls, 'w-24 shrink-0')} />
                  <input value={m.role} onChange={(e) => setMembers((ms) => ms.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}
                    placeholder="角色卡：职责与产出规范" className={inputCls} />
                  <button type="button" aria-label="移除成员"
                    className="shrink-0 rounded p-1 text-foreground-subtlest hover:bg-hover hover:text-destructive"
                    onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>
                    <XIcon className="size-3" />
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {toolsets.map((t) => (
                    <button key={t.id} type="button" title={t.notes}
                      className={cn('rounded-full border px-1.5 py-0.5 text-ui-2xs transition-colors',
                        m.toolsets.includes(t.id) ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}
                      onClick={() => toggleTs(i, t.id)}>
                      {t.id}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        {err && <div className="text-ui-2xs text-destructive">{err}</div>}
        <button type="button" disabled={busy || !name.trim() || !leaderRole.trim()}
          className="rounded-lg bg-brand px-3 py-2 text-ui-xs font-medium text-white disabled:opacity-40"
          onClick={() => void submit()}>
          {busy ? '创建中…' : '创建团队'}
        </button>
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
