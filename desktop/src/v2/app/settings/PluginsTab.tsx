// 插件分区：清单 → 详情。详情 = 清单信息 + 打包的能力卡片。
// 自定义插件（用户资产目录）可新建 / 编辑清单与规范 / 新建子代理 / 删除；
// 内置插件「复制为自定义」后再改。
import { useState } from 'react';
import { CircleAlertIcon, PlusIcon, PowerIcon, PuzzleIcon } from 'lucide-react';
import { AgentEditor } from './AgentsTab';
import { allMcp, errorsFor, mcpNamesExcept, pluginById, useCatalog, type PluginItem } from './catalog';
import { engine } from '../../protocol';
import { AgentCard, McpCard, PanelCard, RuleCard, SkillCard, ToolsetCard } from './cards';
import { AssetActions, EditorFrame, FormField, LoadErrors, OriginChip, ToggleChips, useFileText, useSaver } from './editing';
import { buildPluginManifest, pluginFormFrom, type PluginForm } from './manifest';
import { NEW_ID, useNav } from './nav';
import {
  CardSection, Chip, DetailFrame, DetailSection, EmptyHint, ErrorBox, GroupHeader, InfoRow, Loading,
  RefreshButton, ResourceList, ResourceRow,
} from './ui';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';

const MCP_EXAMPLE = '[{ "name": "fs", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }]';

/** 插件启停开关：POST /plugins/{id}/enabled（引擎撤销/重装资产后 reload）。 */
function PluginToggle({ id, disabled }: { id: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const { refresh } = useCatalog();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!disabled}
      disabled={busy}
      title={disabled ? '插件已停用，点击启用' : '停用插件（子代理下线、MCP 断开，立即生效）'}
      onClick={async () => {
        setBusy(true);
        try {
          await engine.post(`/plugins/${id}/enabled`, { enabled: !!disabled });
          refresh();
        } finally {
          setBusy(false);
        }
      }}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-ui-2xs transition-colors disabled:opacity-50 ${
        disabled
          ? 'border-border text-foreground-subtle hover:bg-hover hover:text-foreground'
          : 'border-success/50 bg-success/10 text-success hover:bg-success/20'
      }`}
    >
      <PowerIcon className="size-3" />
      {busy ? '切换中…' : disabled ? '已停用' : '启用中'}
    </button>
  );
}

function PluginFields({ initial, isNew, onDone, onCancel }: {
  initial: PluginForm; isNew: boolean; onDone(id: string): void; onCancel(): void;
}) {
  const catalog = useCatalog();
  const [form, setForm] = useState(initial);
  const { saving, error, run } = useSaver();
  const set = <K extends keyof PluginForm>(k: K, v: PluginForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    const r = buildPluginManifest(form, {
      isNew,
      pluginIds: catalog.plugins.map((p) => p.id),
      toolsets: Object.keys(catalog.toolsets),
      otherMcpNames: mcpNamesExcept(catalog, form.id.trim()),
    });
    void run(r.ok ? r.value.map((w) => ({ write: w })) : { error: r.error }, () => onDone(form.id.trim()));
  };
  return (
    <EditorFrame title={isNew ? '新建插件' : `编辑插件 ${initial.id}`} error={error} saving={saving}
      onCancel={onCancel} onSave={save}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="id" hint="目录名，只能含字母、数字、_、-；保存后不可改">
          <Input value={form.id} disabled={!isNew} onChange={(e) => set('id', e.target.value)} placeholder="my-tools" />
        </FormField>
        <FormField label="名称">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </FormField>
      </div>
      <FormField label="描述">
        <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
      </FormField>
      <FormField label="工具集" hint="引擎内置的原生工具集；引用本插件的模式即可用其工具">
        <ToggleChips value={form.toolsets} onChange={(v) => set('toolsets', v)}
          options={Object.keys(catalog.toolsets).sort().map((t) => ({ id: t, label: t }))} empty="引擎没有可选工具集" />
      </FormField>
      <FormField label="领域规范" hint={`每轮作为项目上下文注入；留空 = 不声明规范${form.rulesFile ? `（文件 ${form.rulesFile}）` : ''}`}>
        <Textarea value={form.rules ?? ''} onChange={(e) => set('rules', e.target.value)}
          className="max-h-[28rem] min-h-24 font-mono text-ui-xs" placeholder="# 规范&#10;- 约束一&#10;- 约束二" />
      </FormField>
      <FormField label="MCP 服务器（JSON 数组）" hint={`stdio 写 command/args/env，远程写 url/headers，二选一；server 名全局唯一。例：${MCP_EXAMPLE}`}>
        <Textarea value={form.mcpServers} onChange={(e) => set('mcpServers', e.target.value)}
          spellCheck={false} className="max-h-80 font-mono text-ui-xs" />
      </FormField>
    </EditorFrame>
  );
}

/** 插件编辑器：编辑时先读规范文件预填。 */
function PluginEditor({ plugin, onDone, onCancel }: { plugin?: PluginItem; onDone(id: string): void; onCancel(): void }) {
  const rules = useFileText(plugin?.rules ? plugin.rulesFile || `${plugin.dir}/${plugin.rules}` : undefined);
  if (!rules.loaded) return <Loading />;
  return <PluginFields initial={pluginFormFrom(plugin, rules.text)} isNew={!plugin} onDone={onDone} onCancel={onCancel} />;
}

function PluginDetail({ id }: { id: string }) {
  const catalog = useCatalog();
  const nav = useNav();
  const [editing, setEditing] = useState<'plugin' | 'agent' | null>(null);
  const { saving, error, run } = useSaver();
  const plugin = pluginById(catalog, id);
  if (!plugin) {
    return catalog.loaded
      ? <div className="space-y-2"><ErrorBox message={`插件 ${id} 不存在或加载失败`} /><LoadErrors errors={errorsFor(catalog, ['plugin'], id)} /></div>
      : <Loading />;
  }
  const done = () => setEditing(null);
  if (editing === 'plugin') return <PluginEditor plugin={plugin} onDone={done} onCancel={done} />;
  if (editing === 'agent') return <AgentEditor plugin={plugin} onDone={done} onCancel={done} />;
  const isUser = plugin.origin === 'user';
  const skills = catalog.skills.filter((s) => s.origin === 'plugin' && s.plugin === plugin.id);
  const agents = plugin.agentDefs ?? [];
  const mcp = allMcp(catalog).filter((m) => m.plugin.id === plugin.id);
  const panels = plugin.sidePanels ?? [];
  const toolsets = plugin.toolsets ?? [];
  const provides = toolsets.length + (plugin.rules ? 1 : 0) + agents.length + mcp.length + skills.length + panels.length;
  return (
    <DetailFrame icon={<PuzzleIcon className="size-5" />} title={plugin.name} desc={plugin.description}
      actions={
        <>
          <PluginToggle id={plugin.id} disabled={plugin.disabled} />
          <OriginChip origin={plugin.origin} />
          <AssetActions origin={plugin.origin} busy={saving}
            onCopy={() => void run([{ copy: { src: plugin.dir, dest: `plugins/${plugin.id}` } }])}
            onEdit={() => setEditing('plugin')}
            onDelete={() => void run([{ rm: `plugins/${plugin.id}` }], nav.back)} />
          {plugin.usedBy.length === 0 && <Chip>未被模式引用</Chip>}
        </>
      }>
      {error && <ErrorBox message={error} />}
      <LoadErrors errors={catalog.errors.filter((e) => e.kind !== 'mode' && e.file?.startsWith(plugin.dir))} />
      <DetailSection title="清单">
        <InfoRow label="id"><span className="font-mono text-ui-xs">{plugin.id}</span></InfoRow>
        <InfoRow label="目录"><span className="break-all font-mono text-ui-xs">{plugin.dir}</span></InfoRow>
      </DetailSection>
      {provides === 0 && !isUser && (
        <CardSection title="提供的能力" empty="清单没有声明任何能力" />
      )}
      {plugin.rules && (
        <CardSection title="提示词">
          <RuleCard plugin={plugin} />
        </CardSection>
      )}
      {toolsets.length > 0 && (
        <CardSection title="工具集" count={toolsets.length}>
          {toolsets.map((t) => <ToolsetCard key={t} id={t} />)}
        </CardSection>
      )}
      {(agents.length > 0 || plugin.agents || isUser) && (
        <CardSection title="子代理" count={agents.length} empty={isUser ? '还没有子代理' : `${plugin.agents}/ 下没有子代理定义`}
          actions={isUser ? (
            <Button type="button" size="xs" variant="ghost" onClick={() => setEditing('agent')}>
              <PlusIcon className="size-3" />新建子代理
            </Button>
          ) : undefined}>
          {agents.map((a) => <AgentCard key={a.name} agent={a} />)}
        </CardSection>
      )}
      {mcp.length > 0 && (
        <CardSection title="MCP" count={mcp.length}>
          {mcp.map((m) => <McpCard key={m.decl.name} decl={m.decl} status={m.status} />)}
        </CardSection>
      )}
      {(skills.length > 0 || plugin.skills) && (
        <CardSection title="技能" count={skills.length} empty="技能目录存在但没有发现技能">
          {skills.map((s) => <SkillCard key={s.filePath || s.name} skill={s} />)}
        </CardSection>
      )}
      {panels.length > 0 && (
        <CardSection title="右栏面板" count={panels.length}>
          {panels.map((p) => <PanelCard key={p.id} panel={p} />)}
        </CardSection>
      )}
    </DetailFrame>
  );
}

export function PluginsTab() {
  const catalog = useCatalog();
  const { route, go, replace, back } = useNav();
  const { plugins, loaded, error } = catalog;
  if (error) return <ErrorBox message={error} />;
  if (route.id === NEW_ID) return <PluginEditor onDone={(id) => replace('plugins', id)} onCancel={back} />;
  if (route.id) return <PluginDetail id={route.id} />;
  return (
    <div className="space-y-4">
      <GroupHeader title="已安装插件" count={plugins.length} actions={
        <div className="flex items-center gap-1">
          <Button type="button" size="sm" variant="outline" onClick={() => go('plugins', NEW_ID)}>
            <PlusIcon className="size-3.5" />新建插件
          </Button>
          <RefreshButton />
        </div>
      } />
      <LoadErrors errors={errorsFor(catalog, ['plugin'])} />
      {!loaded ? <Loading /> : plugins.length === 0 ? (
        <EmptyHint
          icon={<PuzzleIcon className="size-8" />}
          title="还没有插件"
          desc="点「新建插件」组合工具集 / 规范 / MCP / 子代理，再在模式里引用。"
        />
      ) : (
        <ResourceList>
          {plugins.map((p) => {
            const mcpErr = catalog.mcp.filter((s) => s.plugin === p.id && s.status === 'error').length;
            return (
              <ResourceRow
                key={p.id}
                icon={<PuzzleIcon className="size-4" />}
                name={p.name}
                desc={p.description || p.id}
                onClick={() => go('plugins', p.id)}
                right={
                  <>
                    <PluginToggle id={p.id} disabled={p.disabled} />
                    {p.disabled && <Chip tone="muted">停用</Chip>}
                    {p.origin === 'user' && <OriginChip origin="user" />}
                    {p.usedBy.length === 0 && <Chip>未引用</Chip>}
                    {(p.toolsets?.length ?? 0) > 0 && <Chip>工具集 ×{p.toolsets!.length}</Chip>}
                    {p.rules && <Chip>规范</Chip>}
                    {p.skills && <Chip>技能</Chip>}
                    {(p.agentDefs?.length ?? 0) > 0 && <Chip>子代理 ×{p.agentDefs.length}</Chip>}
                    {(p.mcpServers?.length ?? 0) > 0 && <Chip>MCP ×{p.mcpServers!.length}</Chip>}
                    {mcpErr > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-ui-2xs text-destructive">
                        <CircleAlertIcon className="size-3" />MCP 失败 {mcpErr}
                      </span>
                    )}
                    {(p.sidePanels?.length ?? 0) > 0 && <Chip>面板 ×{p.sidePanels!.length}</Chip>}
                  </>
                }
              />
            );
          })}
        </ResourceList>
      )}
    </div>
  );
}
