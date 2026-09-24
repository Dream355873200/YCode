// 模式分区：清单 → 详情。详情只做「组成一览」：每项能力一张卡片，
// 具体内容点卡片进各自详情页查看。自定义模式（用户资产目录）可新建 /
// 编辑 / 删除，内置模式可「复制为自定义」后改。
import { useState } from 'react';
import { PlusIcon, ShapesIcon } from 'lucide-react';
import { useApp } from '../appState';
import {
  allMcp, errorsFor, modeById, modePlugins, modeSkills, useCatalog,
} from './catalog';
import { AssetActions, EditorFrame, FormField, LoadErrors, OriginChip, ToggleChips, useSaver } from './editing';
import { buildModeManifest, modeFormFrom, type ModeForm } from './manifest';
import {
  AgentCard, BaseToolsCard, McpCard, ModePromptCard, PanelCard, PluginRefCard, RuleCard, SkillCard, ToolsetCard,
} from './cards';
import { NEW_ID, useNav } from './nav';
import {
  CardSection, Chip, DetailFrame, DetailSection, ErrorBox, GroupHeader, InfoRow, Loading, RefreshButton,
  ResourceList, ResourceRow,
} from './ui';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';

export const selectCls = 'h-7 w-full rounded-md border border-input bg-input/20 px-2 text-ui-base text-foreground outline-none focus-visible:border-ring';

/** 新建 / 编辑模式表单：保存即写 modes/<id>/mode.json 并 reload 引擎。 */
function ModeEditor({ initial, isNew, onDone, onCancel }: {
  initial: ModeForm; isNew: boolean; onDone(id: string): void; onCancel(): void;
}) {
  const catalog = useCatalog();
  const [form, setForm] = useState(initial);
  const { saving, error, run } = useSaver();
  const set = <K extends keyof ModeForm>(k: K, v: ModeForm[K]) => setForm((f) => ({ ...f, [k]: v }));
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
    <EditorFrame title={isNew ? '新建模式' : `编辑模式 ${initial.id}`} error={error} saving={saving}
      onCancel={onCancel} onSave={save}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="id" hint="目录名，只能含字母、数字、_、-；保存后不可改">
          <Input value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value)} placeholder="review" />
        </FormField>
        <FormField label="名称">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="代码审查" />
        </FormField>
      </div>
      <FormField label="描述">
        <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
      </FormField>
      <FormField label="插件" hint="按点选顺序聚合：工具集、规范、子代理、MCP、技能、右栏面板都来自插件">
        <ToggleChips value={form.plugins} onChange={(v) => set('plugins', v)}
          options={catalog.plugins.map((p) => ({ id: p.id, label: p.name, title: p.description }))} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="提示词组" hint="系统提示词按段覆盖；不选 = 内置通用 Agent">
          <select className={selectCls} value={form.prompts} onChange={(e) => set('prompts', e.target.value)}>
            <option value="">内置通用 Agent</option>
            {catalog.prompts.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
          </select>
        </FormField>
        <FormField label="脚手架" hint="新建项目时生成工程的脚手架 id；留空 = 打开已有目录">
          <Input value={form.scaffold} onChange={(e) => set('scaffold', e.target.value)} placeholder="flutter-app" />
        </FormField>
      </div>
      <FormField label="新建项目字段（JSON）" hint="type 可选 text / textarea / folder / choice；dir 字段即项目目录">
        <Textarea value={form.projectFields} onChange={(e) => set('projectFields', e.target.value)}
          spellCheck={false} className="max-h-80 font-mono text-ui-xs" />
      </FormField>
    </EditorFrame>
  );
}

function ModeDetail({ id, defaultMode, onSetDefault }: { id: string; defaultMode: string; onSetDefault(id: string): void }) {
  const catalog = useCatalog();
  const nav = useNav();
  const { project, projectMode } = useApp();
  const [editing, setEditing] = useState(false);
  const { saving, error, run } = useSaver();
  const mode = modeById(catalog, id);
  if (!mode) {
    return catalog.loaded
      ? <div className="space-y-2"><ErrorBox message={`模式 ${id} 不存在或加载失败`} /><LoadErrors errors={errorsFor(catalog, ['mode'], id)} /></div>
      : <Loading />;
  }
  if (editing) {
    return <ModeEditor initial={modeFormFrom(mode)} isNew={false} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  }
  const plugins = modePlugins(catalog, mode);
  const rulePlugins = plugins.filter((p) => p.rules);
  const agents = plugins.flatMap((p) => p.agentDefs ?? []);
  const mcp = allMcp(catalog).filter((m) => mode.plugins.includes(m.plugin.id));
  const skills = modeSkills(catalog, mode);
  const panels = plugins.flatMap((p) => p.sidePanels ?? []);
  const toolsets = mode.resolved.toolsets;
  return (
    <DetailFrame
      icon={<ShapesIcon className="size-5" />}
      title={mode.name}
      desc={mode.description}
      actions={
        <>
          <OriginChip origin={mode.origin} />
          <AssetActions origin={mode.origin} busy={saving}
            onCopy={mode.dir ? () => void run([{ copy: { src: mode.dir!, dest: `modes/${mode.id}` } }]) : undefined}
            onEdit={() => setEditing(true)}
            onDelete={() => void run([{ rm: `modes/${mode.id}` }], nav.back)} />
          {project && mode.id === projectMode && <Chip>当前项目</Chip>}
          {mode.id === defaultMode
            ? <Chip tone="brand">默认</Chip>
            : <Button type="button" size="sm" variant="outline" onClick={() => onSetDefault(mode.id)}>设为默认</Button>}
        </>
      }>
      {error && <ErrorBox message={error} />}
      <CardSection title="插件" count={plugins.length} empty="未引用插件（只有基础工具与内置提示词）">
        {mode.plugins.map((p) => <PluginRefCard key={p} id={p} />)}
      </CardSection>
      <CardSection title="提示词" count={1 + rulePlugins.length}
        hint="提示词组决定系统提示词；领域规范来自插件，每轮作为项目上下文注入。">
        <ModePromptCard mode={mode} />
        {rulePlugins.map((p) => <RuleCard key={p.id} plugin={p} />)}
      </CardSection>
      <CardSection title="工具" count={1 + toolsets.length}>
        <BaseToolsCard />
        {toolsets.map((t) => <ToolsetCard key={t} id={t} />)}
      </CardSection>
      <CardSection title="子代理" count={agents.length} empty="无（主 agent 独自完成全部检索）">
        {agents.map((a) => <AgentCard key={a.name} agent={a} />)}
      </CardSection>
      <CardSection title="MCP" count={mcp.length}>
        {mcp.map((m) => <McpCard key={m.decl.name} decl={m.decl} status={m.status} />)}
      </CardSection>
      <CardSection title="技能" count={skills.length} empty="没有可用技能">
        {skills.map((s) => <SkillCard key={s.filePath || s.name} skill={s} />)}
      </CardSection>
      <CardSection title="右栏面板" count={panels.length} empty="无（仅内置 Git / 任务 / 计划）">
        {panels.map((p) => <PanelCard key={p.id} panel={p} />)}
      </CardSection>
      <DetailSection title="新建项目">
        <InfoRow label="脚手架">
          {mode.scaffold ? <span className="font-mono text-ui-xs">{mode.scaffold}</span> : '无（打开已有目录）'}
        </InfoRow>
        {mode.projectFields.map((f) => (
          <InfoRow key={f.id} label={f.label}>
            <span className="flex flex-wrap items-center gap-1.5">
              <Chip>{f.type}</Chip>
              {f.required ? <Chip>必填</Chip> : null}
              {f.placeholder && <span className="min-w-0 truncate text-ui-xs text-foreground-subtlest">{f.placeholder}</span>}
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
  const { project, projectMode } = useApp();
  if (error) return <ErrorBox message={error} />;
  if (route.id === NEW_ID) {
    return <ModeEditor initial={modeFormFrom()} isNew onDone={(id) => replace('modes', id)} onCancel={back} />;
  }
  if (route.id) return <ModeDetail id={route.id} defaultMode={defaultMode} onSetDefault={onSetDefault} />;
  return (
    <div className="space-y-4">
      <GroupHeader title="模式包" count={modes.length} actions={
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => go('modes', NEW_ID)}>
            <PlusIcon className="size-3.5" />新建模式
          </Button>
          <RefreshButton />
        </div>
      } />
      <LoadErrors errors={errorsFor(catalog, ['mode'])} />
      {!loaded ? <Loading /> : (
        <ResourceList>
          {modes.map((m) => (
            <ResourceRow
              key={m.id}
              icon={<ShapesIcon className="size-4" />}
              name={m.name}
              desc={m.description}
              onClick={() => go('modes', m.id)}
              right={
                <>
                  {m.origin === 'user' && <OriginChip origin="user" />}
                  {project && m.id === projectMode && <Chip>当前项目</Chip>}
                  {m.id === defaultMode && <Chip tone="brand">默认</Chip>}
                </>
              }
            />
          ))}
        </ResourceList>
      )}
      <p className="text-ui-xs text-foreground-subtlest">
        模式 = 提示词组 + 插件组合，按项目生效：标题栏可随时切换当前项目的模式（不重启引擎）；默认模式只决定新建项目的预选。
        自定义模式存放在用户资产目录，与内置同 id 时覆盖内置。
      </p>
    </div>
  );
}
