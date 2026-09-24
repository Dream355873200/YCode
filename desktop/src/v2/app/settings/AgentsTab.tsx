// 子代理分区：汇总各插件 agents/ 下的定义（清单 → 详情）。子代理是主 agent
// 可委派的独立 agent 循环（独立历史、只读工具、跑完只回传结论）。
// 自定义插件的子代理可编辑 / 删除；新建入口在插件详情页。
import { useState } from 'react';
import { BotIcon } from 'lucide-react';
import type { AgentDecl } from '../modeRegistry';
import { allAgents, errorsFor, mcpNamesExcept, useCatalog, type PluginItem } from './catalog';
import { AssetActions, EditorFrame, FormField, LoadErrors, OriginChip, useFileText, useSaver, type AssetOp } from './editing';
import { buildAgentFile, buildPluginManifest, pluginFormFrom, splitFrontmatter, type AgentForm } from './manifest';
import { useNav } from './nav';
import {
  Chip, DetailFrame, DetailSection, EmptyHint, ErrorBox, FileSection, GroupHeader, InfoRow,
  Loading, RefreshButton, ResourceList, ResourceRow, ToolPill,
} from './ui';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';

const AGENTS_DIR = 'agents';

function AgentFields({ plugin, agent, initial, onDone, onCancel }: {
  plugin: PluginItem; agent?: AgentDecl; initial: AgentForm; onDone(name: string): void; onCancel(): void;
}) {
  const catalog = useCatalog();
  const [form, setForm] = useState(initial);
  const { saving, error, run } = useSaver();
  const set = <K extends keyof AgentForm>(k: K, v: AgentForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    const file = buildAgentFile(form, {
      pluginId: plugin.id, agentsDir: plugin.agents || AGENTS_DIR, isNew: !agent,
      agentNames: allAgents(catalog).map((r) => r.agent.name), path: agent?.file,
    });
    if (!file.ok) return void run({ error: file.error });
    const ops: AssetOp[] = [{ write: file.value }];
    // 插件还没声明 agents 目录：清单补上（规范不改动）
    if (!plugin.agents) {
      const m = buildPluginManifest({ ...pluginFormFrom(plugin), agents: AGENTS_DIR }, {
        isNew: false, pluginIds: [], toolsets: Object.keys(catalog.toolsets), otherMcpNames: mcpNamesExcept(catalog, plugin.id),
      });
      if (!m.ok) return void run({ error: m.error });
      ops.push(...m.value.map((w) => ({ write: w })));
    }
    void run(ops, () => onDone(form.name.trim()));
  };
  return (
    <EditorFrame title={agent ? `编辑子代理 ${agent.name}` : `新建子代理（${plugin.name}）`} error={error} saving={saving}
      onCancel={onCancel} onSave={save}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField label="名称" hint="工具名为 Agent_<名称>，全局唯一；只能含字母、数字、_、-">
          <Input value={form.name} disabled={!!agent} onChange={(e) => set('name', e.target.value)} placeholder="reviewer" />
        </FormField>
        <FormField label="最大轮数" hint="留空 = 引擎默认">
          <Input value={form.maxTurns} onChange={(e) => set('maxTurns', e.target.value)} placeholder="30" />
        </FormField>
      </div>
      <FormField label="描述" hint="主 agent 据此决定何时委派">
        <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
      </FormField>
      <FormField label="工具" hint="逗号分隔；只能用只读工具（基础工具或本插件工具集），引擎加载时校验">
        <Input value={form.tools} onChange={(e) => set('tools', e.target.value)} placeholder="Read, Glob, Grep" className="font-mono" />
      </FormField>
      <FormField label="系统提示（正文）">
        <Textarea value={form.prompt} onChange={(e) => set('prompt', e.target.value)} className="max-h-[28rem] min-h-40 font-mono text-ui-xs" />
      </FormField>
    </EditorFrame>
  );
}

/** 子代理编辑器：编辑时先读原文件拆出正文，再进表单。 */
export function AgentEditor({ plugin, agent, onDone, onCancel }: {
  plugin: PluginItem; agent?: AgentDecl; onDone(name: string): void; onCancel(): void;
}) {
  const file = useFileText(agent?.file);
  if (!file.loaded) return <Loading />;
  const initial: AgentForm = agent
    ? {
      name: agent.name, description: agent.description, tools: agent.tools.join(', '),
      maxTurns: agent.maxTurns ? String(agent.maxTurns) : '', prompt: splitFrontmatter(file.text).body,
    }
    : { name: '', description: '', tools: 'Read, Glob, Grep', maxTurns: '', prompt: '' };
  return <AgentFields plugin={plugin} agent={agent} initial={initial} onDone={onDone} onCancel={onCancel} />;
}

function AgentDetail({ name }: { name: string }) {
  const catalog = useCatalog();
  const nav = useNav();
  const [editing, setEditing] = useState(false);
  const { saving, error, run } = useSaver();
  const row = allAgents(catalog).find((r) => r.agent.name === name);
  if (!row) {
    return catalog.loaded
      ? <div className="space-y-2"><ErrorBox message={`子代理 ${name} 不存在或加载失败`} /><LoadErrors errors={errorsFor(catalog, ['agent'], name)} /></div>
      : <Loading />;
  }
  const { agent: a, plugin } = row;
  if (editing) {
    return <AgentEditor plugin={plugin} agent={a} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  }
  return (
    <DetailFrame icon={<BotIcon className="size-5" />} title={a.name} desc={a.description}
      actions={
        <>
          <OriginChip origin={plugin.origin} />
          {plugin.origin === 'user' && (
            <AssetActions origin="user" busy={saving} onEdit={() => setEditing(true)}
              onDelete={() => void run([{ rm: a.file }], nav.back)} />
          )}
        </>
      }>
      {error && <ErrorBox message={error} />}
      <DetailSection title="装配">
        <InfoRow label="工具名"><span className="font-mono text-ui-xs">Agent_{a.name}</span></InfoRow>
        <InfoRow label="最大轮数">{a.maxTurns ?? '默认'}</InfoRow>
      </DetailSection>
      <DetailSection title={`可用工具（${a.tools.length}）`}>
        <div className="flex flex-wrap gap-1">{a.tools.map((t) => <ToolPill key={t} name={t} />)}</div>
        <div className="text-ui-xs text-foreground-subtlest">
          子代理的工具调用不经主循环审批，引擎启动时校验这些工具全部为只读；整个子代理因此也是只读工具，计划模式可用。
        </div>
      </DetailSection>
      <FileSection title="定义" path={a.file} />
    </DetailFrame>
  );
}

export function AgentsTab() {
  const catalog = useCatalog();
  const { route, go } = useNav();
  if (catalog.error) return <ErrorBox message={catalog.error} />;
  if (route.id) return <AgentDetail name={route.id} />;
  const rows = allAgents(catalog);
  const groups = catalog.plugins
    .map((p) => ({ plugin: p, agents: p.agentDefs ?? [] }))
    .filter((g) => g.agents.length > 0);
  return (
    <div className="space-y-5">
      <GroupHeader title="插件子代理" count={rows.length} actions={<RefreshButton />} />
      <LoadErrors errors={errorsFor(catalog, ['agent'])} />
      {!catalog.loaded ? <Loading /> : rows.length === 0 ? (
        <EmptyHint
          icon={<BotIcon className="size-8" />}
          title="还没有子代理"
          desc="在插件清单里声明 agents 目录，目录下每个 <name>.md 是一个子代理：frontmatter 写 description / tools（只读工具）/ maxTurns，正文即系统提示。"
        />
      ) : (
        groups.map(({ plugin: p, agents }) => (
          <div key={p.id} className="space-y-3">
            <GroupHeader title={`${p.id} 插件`} count={agents.length}
              actions={p.usedBy.length === 0 ? <Chip>未启用</Chip> : undefined} />
            <ResourceList>
              {agents.map((a) => (
                <ResourceRow
                  key={a.name}
                  icon={<BotIcon className="size-4" />}
                  name={a.name}
                  desc={a.description}
                  onClick={() => go('agents', a.name)}
                  right={<Chip>工具 ×{a.tools.length}</Chip>}
                />
              ))}
            </ResourceList>
          </div>
        ))
      )}
      <p className="text-ui-xs text-foreground-subtlest">
        主 agent 通过 Agent_&lt;name&gt; 工具委派任务：子代理在独立上下文里多步检索，只把结论带回主对话。在自定义插件详情页新建子代理，保存后即时生效；内置插件先「复制为自定义」。
      </p>
    </div>
  );
}
