// TeamDialogs — 组建 / 编辑团队。团队成员 = 智能体（能力）+ 身份（角色卡）：
// 先选智能体，再写一句身份；工具集白名单折叠为「更多能力」高级项。
// 队长额外有审批策略（成员统一自动编辑，危险操作升级给你）。
import { useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon, CrownIcon, PlusIcon, XIcon } from 'lucide-react';
import { useApp } from '../app/appState';
import { AgentAvatar } from '../app/agentIcon';
import { useWorkspace } from '../app/workspace';
import { engine } from '../protocol';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../components/lib/utils';
import { draftFromTeam, teamApi, type MemberDraft, type TeamDetail, type TeamDraft } from './teamApi';

const PERMS: Array<{ id: string; label: string; hint: string }> = [
  { id: 'accept_edits', label: '自动编辑', hint: '写文件自动通过，危险操作仍需你批准' },
  { id: 'default', label: '逐项审批', hint: '每个写操作都请你确认' },
  { id: 'bypass', label: '完全放行', hint: '全部自动执行（慎用）' },
];

type Template = { id: string; label: string; desc: string; make(agent: string): TeamDraft };

const TEMPLATES: Template[] = [
  {
    id: 'pair', label: '开发搭档', desc: '一人实现、一人审查',
    make: (agent) => ({
      name: 'dev-pair', goal: '实现需求并保证质量', leaderPermission: 'accept_edits', leaderAgent: '',
      leaderRole: '把需求拆成可交付的步骤，交给开发实现，再交给审查把关，汇总结论向用户汇报。',
      members: [
        { name: 'coder', role: '开发：按分派实现功能，改完自测，交付改动说明。', agent, toolsets: [] },
        { name: 'reviewer', role: '审查：逐个文件检查改动，指出 bug、边界条件与可读性问题，给出修改建议。', agent, toolsets: [] },
      ],
    }),
  },
  {
    id: 'research', label: '调研小组', desc: '多路检索、汇总成报告',
    make: (agent) => ({
      name: 'research', goal: '围绕课题完成调研并产出结论报告', leaderPermission: 'accept_edits', leaderAgent: '',
      leaderRole: '拆解调研问题，分派检索与分析任务，汇总成一份有结论的报告。',
      members: [{ name: 'scout', role: '调研员：多路检索与资料收集，输出要点清单并注明出处。', agent, toolsets: [] }],
    }),
  },
  {
    id: 'qa', label: '测试小队', desc: '拆测试点、执行、验收',
    make: (agent) => ({
      name: 'qa-team', goal: '负责功能测试与验收', leaderPermission: 'accept_edits', leaderAgent: '',
      leaderRole: '拆解测试需求，把可测点分派给测试员，汇总验收结论。',
      members: [{ name: 'tester', role: '测试工程师：执行测试，输出用例与结果清单。', agent, toolsets: [] }],
    }),
  },
];

const blank = (agent: string): MemberDraft => ({ name: '', role: '', agent, toolsets: [] });

function useTeamCatalog(): { toolsets: Array<{ id: string; notes: string }> } {
  const [toolsets, setToolsets] = useState<Array<{ id: string; notes: string }>>([]);
  useEffect(() => {
    engine.get('/modes').then((r) => {
      const ts = (r.body as { toolsets?: Record<string, { notes?: string[] }> } | undefined)?.toolsets ?? {};
      setToolsets(Object.entries(ts).filter(([id]) => id !== 'team').map(([id, v]) => ({ id, notes: (v.notes ?? []).join('；') })));
    }).catch(() => {});
  }, []);
  return { toolsets };
}

function AgentSelect({ value, onChange, allowNone }: { value: string; onChange(v: string): void; allowNone?: boolean }) {
  const { modes } = useApp();
  return (
    <div className="flex flex-wrap gap-1">
      {allowNone && (
        <button type="button" onClick={() => onChange('')}
          className={cn('rounded-full border px-2.5 py-1 text-ui-sm transition-colors',
            !value ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}>
          不额外继承
        </button>
      )}
      {modes.map((m) => (
        <button key={m.id} type="button" onClick={() => onChange(m.id)} title={m.description}
          className={cn('flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-ui-sm transition-colors',
            value === m.id ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}>
          <AgentAvatar icon={m.icon} size="sm" className="rounded-full" />
          {m.name}
        </button>
      ))}
    </div>
  );
}

function MemberCard({ m, index, onChange, onRemove, toolsets, highlight, lockName }: {
  m: MemberDraft;
  index: number;
  onChange(p: Partial<MemberDraft>): void;
  onRemove?: () => void;
  toolsets: Array<{ id: string; notes: string }>;
  highlight?: boolean;
  lockName?: boolean;
}) {
  const [more, setMore] = useState(m.toolsets.length > 0);
  return (
    <div className={cn('rounded-xl border bg-card p-3', highlight ? 'border-brand/60' : 'border-border')}>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-ui-sm font-medium text-foreground-subtle">成员 {index + 1}</span>
        {onRemove && (
          <button type="button" aria-label="移除成员" onClick={onRemove}
            className="ml-auto rounded p-1 text-foreground-subtlest hover:bg-hover hover:text-destructive">
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
      <div className="grid gap-2">
        <div className="flex gap-2">
          <Input value={m.name} disabled={lockName} onChange={(e) => onChange({ name: e.target.value })}
            placeholder="标识，如 coder" className="w-32 shrink-0" />
          <Input value={m.role} onChange={(e) => onChange({ role: e.target.value })}
            placeholder="身份：他是谁、负责什么、交付什么" className="min-w-0 flex-1" />
        </div>
        <div>
          <div className="mb-1 text-ui-xs text-foreground-subtlest">能力来自智能体</div>
          <AgentSelect value={m.agent} onChange={(agent) => onChange({ agent })} allowNone />
        </div>
        <button type="button" onClick={() => setMore(!more)}
          className="flex w-fit items-center gap-1 text-ui-xs text-foreground-subtlest hover:text-foreground-subtle">
          <ChevronRightIcon className={cn('size-3 transition-transform', more && 'rotate-90')} />
          更多能力{m.toolsets.length ? `（${m.toolsets.length}）` : ''}
        </button>
        {more && (
          <div className="flex flex-wrap gap-1">
            {toolsets.map((t) => {
              const on = m.toolsets.includes(t.id);
              return (
                <button key={t.id} type="button" title={t.notes || undefined}
                  onClick={() => onChange({ toolsets: on ? m.toolsets.filter((x) => x !== t.id) : [...m.toolsets, t.id] })}
                  className={cn('rounded-full border px-2 py-0.5 text-ui-xs transition-colors',
                    on ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}>
                  {t.id}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function LeaderCard({ draft, set }: { draft: Omit<TeamDraft, 'name'>; set(p: Partial<TeamDraft>): void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-ui-sm font-medium text-foreground-subtle">
        <CrownIcon className="size-3.5 text-warning" />队长：拆解目标、分派、汇总
      </div>
      <Textarea value={draft.leaderRole} onChange={(e) => set({ leaderRole: e.target.value })} rows={2}
        placeholder="身份：队长怎么拆任务、怎么验收成员的产出" className="min-h-0" />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-ui-xs text-foreground-subtlest">审批策略</span>
        {PERMS.map((p) => (
          <button key={p.id} type="button" title={p.hint} onClick={() => set({ leaderPermission: p.id })}
            className={cn('rounded-full border px-2.5 py-0.5 text-ui-sm transition-colors',
              draft.leaderPermission === p.id ? 'border-brand/60 bg-brand/10 text-foreground' : 'border-border text-foreground-subtle hover:bg-hover')}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2">
        <div className="mb-1 text-ui-xs text-foreground-subtlest">队长也可以继承一个智能体的能力</div>
        <AgentSelect value={draft.leaderAgent} onChange={(leaderAgent) => set({ leaderAgent })} allowNone />
      </div>
    </div>
  );
}

const TEAM_ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function validate(d: Omit<TeamDraft, 'name'>, name?: string): string {
  if (name !== undefined && !TEAM_ID_RE.test(name.trim())) return '团队标识须为小写字母开头的 a-z 0-9 _ -';
  if (!d.leaderRole.trim()) return '请写队长的身份';
  const ms = d.members.filter((m) => m.name.trim() || m.role.trim());
  if (!ms.length) return '至少需要一名成员';
  const seen = new Set<string>();
  for (const m of ms) {
    if (!TEAM_ID_RE.test(m.name.trim()) || m.name.trim() === 'leader') return `成员标识「${m.name}」不合法（小写字母开头）`;
    if (seen.has(m.name.trim())) return `成员标识「${m.name}」重复`;
    seen.add(m.name.trim());
    if (!m.role.trim()) return `成员 ${m.name} 缺少身份`;
  }
  return '';
}

/** 组建团队（目标项目 = appState.teamDialogDir）。 */
export function CreateTeamDialog() {
  const { teamDialogDir, setTeamDialogDir, projectMode, defaultMode } = useApp();
  const refreshTeams = useWorkspace((s) => s.refreshTeams);
  const select = useWorkspace((s) => s.select);
  const { toolsets } = useTeamCatalog();
  const agent = projectMode || defaultMode;
  const [draft, setDraft] = useState<TeamDraft>(() => TEMPLATES[0]!.make(agent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = !!teamDialogDir;

  useEffect(() => {
    if (open) { setDraft({ ...TEMPLATES[0]!.make(agent), name: '' }); setError(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (p: Partial<TeamDraft>): void => setDraft((d) => ({ ...d, ...p }));
  const setMember = (i: number, p: Partial<MemberDraft>): void =>
    setDraft((d) => ({ ...d, members: d.members.map((m, j) => (j === i ? { ...m, ...p } : m)) }));

  const submit = async (): Promise<void> => {
    if (!teamDialogDir) return;
    const err = validate(draft, draft.name);
    if (err) { setError(err); return; }
    setBusy(true);
    const r = await teamApi.create(teamDialogDir, { ...draft, members: draft.members.filter((m) => m.name.trim()) });
    setBusy(false);
    if (!r.ok) { setError(r.error || '创建失败'); return; }
    await refreshTeams(teamDialogDir);
    select({ kind: 'team', dir: teamDialogDir, name: draft.name.trim() });
    setTeamDialogDir(null);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy && !v) setTeamDialogDir(null); }}>
      <DialogContent className="max-h-[86vh] max-w-150 grid-rows-[auto_1fr_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>组建团队</DialogTitle>
          <DialogDescription className="text-ui-base">几个智能体各带身份常驻协作：队长拆解分派，成员执行汇报，你在群聊里随时插话。</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 overflow-y-auto px-1">
          <div className="mb-3 grid grid-cols-3 gap-2">
            {TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => setDraft({ ...t.make(agent), name: t.make(agent).name })}
                className="rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:border-brand/50 hover:bg-hover">
                <div className="text-ui-base font-medium text-foreground">{t.label}</div>
                <div className="text-ui-xs text-foreground-subtlest">{t.desc}</div>
              </button>
            ))}
          </div>
          <div className="mb-3 flex gap-2">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="团队标识，如 dev-pair" className="w-40 shrink-0" />
            <Input value={draft.goal} onChange={(e) => set({ goal: e.target.value })} placeholder="团队目标：这个团队负责什么" className="min-w-0 flex-1" />
          </div>
          <div className="grid gap-2">
            <LeaderCard draft={draft} set={set} />
            {draft.members.map((m, i) => (
              <MemberCard key={i} m={m} index={i} toolsets={toolsets}
                onChange={(p) => setMember(i, p)}
                onRemove={draft.members.length > 1 ? () => setDraft((d) => ({ ...d, members: d.members.filter((_, j) => j !== i) })) : undefined} />
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit"
              onClick={() => setDraft((d) => ({ ...d, members: [...d.members, blank(agent)] }))}>
              <PlusIcon />加成员
            </Button>
          </div>
        </div>
        <div className="grid gap-2">
          {error && <div className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-ui-sm text-destructive">{error}</div>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setTeamDialogDir(null)}>取消</Button>
            <Button disabled={busy} onClick={() => void submit()}>{busy ? '创建中…' : '创建团队'}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 编辑团队：目标、队长、成员的身份与能力（成员会话按名复用，下一轮生效、历史不丢）。 */
export function EditTeamDialog({ team, focus, onClose }: { team: TeamDetail; focus: string; onClose(changed: boolean): void }) {
  const { toolsets } = useTeamCatalog();
  const initial = useMemo(() => draftFromTeam(team), [team]);
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const original = useMemo(() => new Set(initial.members.map((m) => m.name)), [initial]);
  const set = (p: Partial<TeamDraft>): void => setDraft((d) => ({ ...d, ...p }));
  const setMember = (i: number, p: Partial<MemberDraft>): void =>
    setDraft((d) => ({ ...d, members: d.members.map((m, j) => (j === i ? { ...m, ...p } : m)) }));

  const save = async (): Promise<void> => {
    const err = validate(draft);
    if (err) { setError(err); return; }
    setBusy(true);
    const r = await teamApi.update(team.dir, team.name, { ...draft, members: draft.members.filter((m) => m.name.trim()) });
    setBusy(false);
    if (!r.ok) { setError(r.error || '保存失败'); return; }
    onClose(true);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!busy && !v) onClose(false); }}>
      <DialogContent className="max-h-[86vh] max-w-150 grid-rows-[auto_1fr_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle>编辑团队 {team.name}</DialogTitle>
          <DialogDescription className="text-ui-base">改动从成员的下一轮开始生效，已有的会话历史保留；移除的成员会连同其会话一起删除。</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 overflow-y-auto px-1">
          <Input value={draft.goal} onChange={(e) => set({ goal: e.target.value })} placeholder="团队目标" className="mb-3" />
          <div className="grid gap-2">
            <LeaderCard draft={draft} set={set} />
            {draft.members.map((m, i) => (
              <MemberCard key={i} m={m} index={i} toolsets={toolsets} highlight={m.name === focus}
                lockName={original.has(m.name)}
                onChange={(p) => setMember(i, p)}
                onRemove={draft.members.length > 1 ? () => setDraft((d) => ({ ...d, members: d.members.filter((_, j) => j !== i) })) : undefined} />
            ))}
            <Button type="button" variant="outline" size="sm" className="w-fit"
              onClick={() => setDraft((d) => ({ ...d, members: [...d.members, blank(team.members.find((x) => !x.isLeader)?.agent ?? '')] }))}>
              <PlusIcon />加成员
            </Button>
          </div>
        </div>
        <div className="grid gap-2">
          {error && <div className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-ui-sm text-destructive">{error}</div>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => onClose(false)}>取消</Button>
            <Button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
