// 插件分区：清单 → 详情。详情 = 清单信息 + 被哪些模式引用 + 打包的能力卡片。
import { CircleAlertIcon, PuzzleIcon } from 'lucide-react';
import { allMcp, pluginById, useCatalog } from './catalog';
import { AgentCard, McpCard, PanelCard, RuleCard, SkillCard, ToolsetCard } from './cards';
import { useNav } from './nav';
import {
  CardSection, Chip, DetailFrame, DetailSection, EmptyHint, ErrorBox, GroupHeader, InfoRow, Loading,
  RefreshButton, ResourceList, ResourceRow,
} from './ui';

function PluginDetail({ id }: { id: string }) {
  const catalog = useCatalog();
  const plugin = pluginById(catalog, id);
  if (!plugin) return <ErrorBox message={`插件 ${id} 不存在`} />;
  const skills = catalog.skills.filter((s) => s.origin === 'plugin' && s.plugin === plugin.id);
  const agents = plugin.agentDefs ?? [];
  const mcp = allMcp(catalog).filter((m) => m.plugin.id === plugin.id);
  const panels = plugin.sidePanels ?? [];
  const toolsets = plugin.toolsets ?? [];
  const provides = toolsets.length + (plugin.rules ? 1 : 0) + agents.length + mcp.length + skills.length + panels.length;
  return (
    <DetailFrame icon={<PuzzleIcon className="size-5" />} title={plugin.name} desc={plugin.description}
      actions={plugin.usedBy.length === 0 ? <Chip>未被模式引用</Chip> : undefined}>
      <DetailSection title="清单">
        <InfoRow label="id"><span className="font-mono text-ui-xs">{plugin.id}</span></InfoRow>
        <InfoRow label="目录"><span className="break-all font-mono text-ui-xs">{plugin.dir}</span></InfoRow>
      </DetailSection>
      {provides === 0 && (
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
      {(agents.length > 0 || plugin.agents) && (
        <CardSection title="子代理" count={agents.length} empty={`${plugin.agents}/ 下没有子代理定义`}>
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
  const { route, go } = useNav();
  const { plugins, loaded, error } = catalog;
  if (error) return <ErrorBox message={error} />;
  if (route.id) return <PluginDetail id={route.id} />;
  return (
    <div className="space-y-4">
      <GroupHeader title="已安装插件" count={plugins.length} actions={<RefreshButton />} />
      {!loaded ? <Loading /> : plugins.length === 0 ? (
        <EmptyHint
          icon={<PuzzleIcon className="size-8" />}
          title="还没有插件"
          desc="把能力包放进应用目录 plugins/<id>/（plugin.json 清单，规范见 plugins/README.md），再在模式的 plugins 里引用。"
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
