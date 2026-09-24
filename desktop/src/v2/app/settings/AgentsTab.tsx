// 子代理分区：汇总各插件 agents/ 下的定义（清单 → 详情）。子代理是主 agent
// 可委派的独立 agent 循环（独立历史、只读工具、跑完只回传结论）。
import { BotIcon } from 'lucide-react';
import { allAgents, useCatalog } from './catalog';
import { useNav } from './nav';
import {
  Chip, DetailFrame, DetailSection, EmptyHint, ErrorBox, FileSection, GroupHeader, InfoRow,
  Loading, RefreshButton, ResourceList, ResourceRow, ToolPill,
} from './ui';

function AgentDetail({ name }: { name: string }) {
  const catalog = useCatalog();
  const row = allAgents(catalog).find((r) => r.agent.name === name);
  if (!row) return <ErrorBox message={`子代理 ${name} 不存在`} />;
  const { agent: a } = row;
  return (
    <DetailFrame icon={<BotIcon className="size-5" />} title={a.name} desc={a.description}>
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
        主 agent 通过 Agent_&lt;name&gt; 工具委派任务：子代理在独立上下文里多步检索，只把结论带回主对话。修改定义后重启引擎生效。
      </p>
    </div>
  );
}
