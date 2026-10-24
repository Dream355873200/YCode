// 智能体分区（引擎名词 mode）：清单 → 详情 → 编辑。
// 详情页的「插件」区是直接开关：打开 = 把插件加进这个智能体。内置智能体被改动时
// 写成同 id 的用户覆盖，可一键恢复默认。编辑器另管名称、图标、开场建议、提示词组
// 与新建项目表单。
import { useState } from 'react';
import { CopyIcon, PencilIcon, PlusIcon, PuzzleIcon, RotateCcwIcon, Trash2Icon, XIcon } from 'lucide-react';
import { useApp } from '../appState';
import { AGENT_ICON_KEYS, AgentAvatar } from '../agentIcon';
import type { ModeDecl } from '../modeRegistry';
import {
  allMcp, errorsFor, modeById, modePlugins, modeSkills, useCatalog, type PluginItem,
} from './catalog';
import { EditorFrame, FormField, LoadErrors, ToggleChips, useSaver } from './editing';
import { buildModeManifest, modeFormFrom, withPlugins, type ModeForm } from './manifest';
import {
  AgentCard, BaseToolsCard, McpCard, ModePromptCard, PanelCard, RuleCard, SkillCard, ToolsetCard,
} from './cards';
import { NEW_ID, useNav } from './nav';
import {
  CardSection, Chip, DetailFrame, DetailSection, ErrorBox, GroupHeader, InfoRow, Loading, RefreshButton,
} from './ui';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../components/lib/utils';

export const selectCls = 'h-7 w-full rounded-md border border-input bg-input/20 px-2 text-ui-base text-foreground outline-none focus-visible:border-ring';

/** 插件提供的能力摘要（列表与开关行共用）。 */
function pluginProvides(p: PluginItem, mcpCount: number): string[] {
  const out: string[] = [];
  if (p.toolsets?.length) out.push(`工具集 ${p.toolsets.length}`);
  if (p.agentDefs?.length) out.push(`子代理 ${p.agentDefs.length}`);
  if (mcpCount) out.push(`MCP ${mcpCount}`);
  if (p.skills) out.push('技能');
  if (p.rules) out.push('规范');
  if (p.sidePanels?.length) out.push(`面板 ${p.sidePanels.length}`);
  return out;
}

function Switch({ on, busy, onToggle, label }: { on: boolean; busy?: boolean; onToggle(): void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={onToggle}
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-brand' : 'bg-secondary')}>
      <span className={cn('absolute left-0 top-0.5 size-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-4.5' : 'translate-x-0.5')} />
    </button>
  );
}

/** 编辑器：名称 / 图标 / 描述 / 开场建议 / 插件 / 提示词组 / 新建项目。 */
function ModeEditor({ initial, isNew, onDone, onCancel }: {
  initial: ModeForm; isNew: boolean; onDone(id: string): void; onCancel(): void;
}) {
  const catalog = useCatalog();
  const [form, setForm] = useState(initial);
  const { saving, error, run } = useSaver();
  const set = <K extends keyof ModeForm>(k: K, v: ModeForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setStarter = (i: number, patch: Partial<ModeForm['starters'][number]>): void =>
    set('starters', form.starters.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const save = () => {
    const r = buildModeManifest(form, {
      isNew,
      modeIds: catalog.modes.map((m) => m.id),
      pluginIds: catalog.plugins.map((p) => p.id),
      promptNames: catalog.prompts.map((g) => g.name),
    });
    void run(r.ok ? [{ write: r.value }] : { error: r.error }, () => onDone(form.id.trim()));
  };
  return (
    <EditorFrame title={isNew ? '新建智能体' : `编辑 ${initial.name || initial.id}`} error={error} saving={saving}
      onCancel={onCancel} onSave={save}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="名称">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="代码审查" />
        </FormField>
        <FormField label="id" hint="目录名：字母、数字、_、-；保存后不可改">
          <Input value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value)} placeholder="review" />
        </FormField>
      </div>
      <FormField label="一句话描述">
        <Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="它擅长做什么" />
      </FormField>
      <FormField label="图标">
        <div className="flex flex-wrap gap-1.5">
          {AGENT_ICON_KEYS.map((k) => (
            <button key={k} type="button" title={k} onClick={() => set('icon', k)}
              className={cn('rounded-xl p-0.5 ring-2 transition-colors', form.icon === k ? 'ring-brand' : 'ring-transparent hover:ring-border')}>
              <AgentAvatar icon={k} size="md" />
            </button>
          ))}
        </div>
      </FormField>
      <FormField label="开场建议" hint="空对话里的起手按钮：按钮文字 ≤ 16 字，点击把提示填进输入框（不直接发送）">
        <div className="grid gap-1.5">
          {form.starters.map((s, i) => (
            <div key={i} className="flex gap-1.5">
              <Input value={s.label} onChange={(e) => setStarter(i, { label: e.target.value })} placeholder="按钮文字" className="w-36 shrink-0" />
              <Input value={s.prompt} onChange={(e) => setStarter(i, { prompt: e.target.value })} placeholder="填进输入框的提示" className="min-w-0 flex-1" />
              <Button type="button" variant="ghost" size="icon-md" aria-label="删除这条"
                onClick={() => set('starters', form.starters.filter((_, j) => j !== i))}>
                <XIcon />
              </Button>
            </div>
          ))}
          {form.starters.length < 6 && (
            <Button type="button" variant="outline" size="sm" className="w-fit"
              onClick={() => set('starters', [...form.starters, { label: '', prompt: '' }])}>
              <PlusIcon />加一条
            </Button>
          )}
        </div>
      </FormField>
      <FormField label="插件" hint="能力都来自插件；也可以保存后在详情页逐个开关">
        <ToggleChips value={form.plugins} onChange={(v) => set('plugins', v)}
          options={catalog.plugins.map((p) => ({ id: p.id, label: p.name, title: p.description }))} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="提示词组" hint="不选 = 内置通用提示词">
          <select className={selectCls} value={form.prompts} onChange={(e) => set('prompts', e.target.value)}>
            <option value="">内置通用提示词</option>
            {catalog.prompts.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
          </select>
        </FormField>
        <FormField label="脚手架" hint="添加项目时生成工程；留空 = 打开已有目录">
          <Input value={form.scaffold} onChange={(e) => set('scaffold', e.target.value)} placeholder="flutter-app" />
        </FormField>
      </div>
      <FormField label="添加项目表单（JSON）" hint="type：text / textarea / folder / choice；dir 字段即项目目录">
        <Textarea value={form.projectFields} onChange={(e) => set('projectFields', e.target.value)}
          spellCheck={false} className="max-h-60 font-mono text-ui-xs" />
      </FormField>
    </EditorFrame>
  );
}

/** 插件开关行：打开 = 加进这个智能体。 */
function PluginSwitchRow({ mode, plugin, onToggle, busy }: {
  mode: ModeDecl; plugin: PluginItem; onToggle(on: boolean): void; busy: boolean;
}) {
  const catalog = useCatalog();
  const nav = useNav();
  const on = mode.plugins.includes(plugin.id);
  const mcpCount = (plugin.mcpServers ?? []).length;
  const mcpErr = catalog.mcp.filter((s) => s.plugin === plugin.id && s.status === 'error').length;
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors', on ? 'border-brand/40 bg-brand/5' : 'border-border')}>
      <button type="button" onClick={() => nav.go('plugins', plugin.id)}
        className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
        <PuzzleIcon className={cn('mt-0.5 size-4 shrink-0', on ? 'text-brand' : 'text-foreground-subtlest')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-ui-sm text-foreground">
            {plugin.name}
            {plugin.disabled && <Chip>已停用</Chip>}
            {mcpErr > 0 && <span className="text-ui-2xs text-destructive">MCP 失败 {mcpErr}</span>}
          </span>
          {plugin.description && <span className="line-clamp-1 block text-ui-xs text-foreground-subtlest">{plugin.description}</span>}
          <span className="mt-1 flex flex-wrap gap-1">
            {pluginProvides(plugin, mcpCount).map((x) => (
              <span key={x} className="rounded bg-surface px-1.5 text-ui-2xs text-foreground-subtle">{x}</span>
            ))}
          </span>
        </span>
      </button>
      <Switch on={on} busy={busy} label={`${on ? '移出' : '加入'} ${plugin.name}`} onToggle={() => onToggle(!on)} />
    </div>
  );
}

function ModeDetail({ id, defaultMode, onSetDefault }: { id: string; defaultMode: string; onSetDefault(id: string): void }) {
  const catalog = useCatalog();
  const nav = useNav();
  const { projectMode } = useApp();
  const [editing, setEditing] = useState<'edit' | 'copy' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { saving, error, run } = useSaver();
  const mode = modeById(catalog, id);
  if (!mode) {
    return catalog.loaded
      ? <div className="space-y-2"><ErrorBox message={`智能体 ${id} 不存在或加载失败`} /><LoadErrors errors={errorsFor(catalog, ['mode'], id)} /></div>
      : <Loading />;
  }
  if (editing === 'edit') {
    return <ModeEditor initial={modeFormFrom(mode)} isNew={false} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />;
  }
  if (editing === 'copy') {
    return (
      <ModeEditor initial={{ ...modeFormFrom(mode), id: '', name: `${mode.name} 副本` }} isNew
        onDone={(nid) => { setEditing(null); nav.replace('modes', nid); }} onCancel={() => setEditing(null)} />
    );
  }
  const toggle = (pluginId: string, on: boolean): void => {
    const next = on ? [...mode.plugins, pluginId] : mode.plugins.filter((p) => p !== pluginId);
    const r = withPlugins(mode, next, {
      pluginIds: catalog.plugins.map((p) => p.id), promptNames: catalog.prompts.map((g) => g.name),
    });
    void run(r.ok ? [{ write: r.value }] : { error: r.error });
  };
  const plugins = modePlugins(catalog, mode);
  const rulePlugins = plugins.filter((p) => p.rules);
  const agents = plugins.flatMap((p) => p.agentDefs ?? []);
  const mcp = allMcp(catalog).filter((m) => mode.plugins.includes(m.plugin.id));
  const skills = modeSkills(catalog, mode);
  const panels = plugins.flatMap((p) => p.sidePanels ?? []);
  const sorted = [...catalog.plugins].sort((a, b) => Number(mode.plugins.includes(b.id)) - Number(mode.plugins.includes(a.id)));
  const userOwned = mode.origin === 'user' && !mode.overrides;
  return (
    <DetailFrame
      icon={<AgentAvatar icon={mode.icon} size="md" />}
      title={mode.name}
      desc={mode.description}
      actions={
        <>
          {mode.overrides ? <Chip tone="brand">已自定义</Chip> : mode.origin === 'user' ? <Chip tone="brand">自建</Chip> : <Chip>内置</Chip>}
          {mode.id === projectMode && <Chip>当前对话</Chip>}
          {mode.id === defaultMode
            ? <Chip tone="brand">默认</Chip>
            : <Button type="button" size="sm" variant="outline" onClick={() => onSetDefault(mode.id)}>设为默认</Button>}
          <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setEditing('edit')}><PencilIcon />编辑</Button>
          <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setEditing('copy')}><CopyIcon />复制</Button>
          {mode.overrides && (
            <Button type="button" size="sm" variant="ghost" disabled={saving} title="删除你的修改，回到应用内置的版本"
              onClick={() => void run([{ rm: `modes/${mode.id}` }])}>
              <RotateCcwIcon />恢复默认
            </Button>
          )}
          {userOwned && (
            <Button type="button" size="sm" variant={confirmDelete ? 'destructive' : 'ghost'} disabled={saving}
              onClick={() => (confirmDelete ? void run([{ rm: `modes/${mode.id}` }], nav.back) : setConfirmDelete(true))}>
              <Trash2Icon />{confirmDelete ? '确认删除' : '删除'}
            </Button>
          )}
        </>
      }>
      {error && <ErrorBox message={error} />}
      <CardSection title="插件" count={mode.plugins.length} hint="打开开关即把插件的工具、技能、子代理、MCP 与面板交给这个智能体（下一轮生效）。">
        <div className="col-span-full grid gap-1.5">
          {sorted.map((p) => (
            <PluginSwitchRow key={p.id} mode={mode} plugin={p} busy={saving} onToggle={(on) => toggle(p.id, on)} />
          ))}
        </div>
      </CardSection>
      {!!mode.starters?.length && (
        <DetailSection title="开场建议">
          {mode.starters.map((s) => (
            <InfoRow key={s.label} label={s.label}><span className="text-ui-xs text-foreground-subtle">{s.prompt}</span></InfoRow>
          ))}
        </DetailSection>
      )}
      <CardSection title="提示词" count={1 + rulePlugins.length}>
        <ModePromptCard mode={mode} />
        {rulePlugins.map((p) => <RuleCard key={p.id} plugin={p} />)}
      </CardSection>
      <CardSection title="工具" count={1 + mode.resolved.toolsets.length}>
        <BaseToolsCard />
        {mode.resolved.toolsets.map((t) => <ToolsetCard key={t} id={t} />)}
      </CardSection>
      {agents.length > 0 && (
        <CardSection title="子代理" count={agents.length}>
          {agents.map((a) => <AgentCard key={a.name} agent={a} />)}
        </CardSection>
      )}
      {mcp.length > 0 && (
        <CardSection title="MCP" count={mcp.length}>
          {mcp.map((m) => <McpCard key={m.decl.name} decl={m.decl} status={m.status} />)}
        </CardSection>
      )}
      {skills.length > 0 && (
        <CardSection title="技能" count={skills.length}>
          {skills.map((s) => <SkillCard key={s.filePath || s.name} skill={s} />)}
        </CardSection>
      )}
      {panels.length > 0 && (
        <CardSection title="右栏面板" count={panels.length}>
          {panels.map((p) => <PanelCard key={p.id} panel={p} />)}
        </CardSection>
      )}
      <DetailSection title="添加项目">
        <InfoRow label="脚手架">
          {mode.scaffold ? <span className="font-mono text-ui-xs">{mode.scaffold}</span> : '无（打开已有目录）'}
        </InfoRow>
        {mode.projectFields.map((f) => (
          <InfoRow key={f.id} label={f.label}>
            <span className="flex flex-wrap items-center gap-1.5">
              <Chip>{f.type}</Chip>
              {f.required ? <Chip>必填</Chip> : null}
            </span>
          </InfoRow>
        ))}
      </DetailSection>
    </DetailFrame>
  );
}

export function ModesTab({ defaultMode, onSetDefault }: { defaultMode: string; onSetDefault(id: string): void }) {
  const catalog = useCatalog();
  const { modes, loaded, error } = catalog;
  const { route, go, replace, back } = useNav();
  const { projectMode } = useApp();
  if (error) return <ErrorBox message={error} />;
  if (route.id === NEW_ID) {
    return <ModeEditor initial={{ ...modeFormFrom(), icon: 'bot' }} isNew onDone={(id) => replace('modes', id)} onCancel={back} />;
  }
  if (route.id) return <ModeDetail id={route.id} defaultMode={defaultMode} onSetDefault={onSetDefault} />;
  return (
    <div className="space-y-4">
      <GroupHeader title="全部智能体" count={modes.length} actions={
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => go('modes', NEW_ID)}>
            <PlusIcon className="size-3.5" />新建智能体
          </Button>
          <RefreshButton />
        </div>
      } />
      <LoadErrors errors={errorsFor(catalog, ['mode'])} />
      {!loaded ? <Loading /> : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {modes.map((m) => {
            const plugins = modePlugins(catalog, m);
            return (
              <button key={m.id} type="button" onClick={() => go('modes', m.id)}
                className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition-colors hover:border-border-hover hover:bg-hover">
                <AgentAvatar icon={m.icon} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-ui-sm font-medium text-foreground">{m.name}</span>
                    {m.id === defaultMode && <Chip tone="brand">默认</Chip>}
                    {m.id === projectMode && <Chip>当前</Chip>}
                    {m.overrides && <Chip>已自定义</Chip>}
                  </span>
                  {m.description && <span className="mt-0.5 line-clamp-2 block text-ui-xs text-foreground-subtlest">{m.description}</span>}
                  <span className="mt-2 block truncate text-ui-2xs text-foreground-subtle">
                    {plugins.length ? plugins.map((p) => p.name).join(' · ') : '只有基础工具'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
