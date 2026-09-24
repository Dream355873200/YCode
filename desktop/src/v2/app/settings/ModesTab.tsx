// 模式分区：清单 → 详情。详情只做「组成一览」：每项能力一张卡片，
// 具体内容点卡片进各自详情页查看。
import { ShapesIcon } from 'lucide-react';
import { useApp } from '../appState';
import {
  allMcp, modeById, modePlugins, modeSkills, useCatalog,
} from './catalog';
import {
  AgentCard, BaseToolsCard, McpCard, ModePromptCard, PanelCard, PluginRefCard, RuleCard, SkillCard, ToolsetCard,
} from './cards';
import { useNav } from './nav';
import {
  CardSection, Chip, DetailFrame, DetailSection, ErrorBox, GroupHeader, InfoRow, Loading, RefreshButton,
  ResourceList, ResourceRow,
} from './ui';
import { Button } from '../../components/ui/button';

function ModeDetail({ id, defaultMode, onSetDefault }: { id: string; defaultMode: string; onSetDefault(id: string): void }) {
  const catalog = useCatalog();
  const { project, projectMode } = useApp();
  const mode = modeById(catalog, id);
  if (!mode) return <ErrorBox message={`模式 ${id} 不存在`} />;
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
          {project && mode.id === projectMode && <Chip>当前项目</Chip>}
          {mode.id === defaultMode
            ? <Chip tone="brand">默认</Chip>
            : <Button type="button" size="sm" variant="outline" onClick={() => onSetDefault(mode.id)}>设为默认</Button>}
        </>
      }>
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
  const { modes, loaded, error } = useCatalog();
  const { route, go } = useNav();
  const { project, projectMode } = useApp();
  if (error) return <ErrorBox message={error} />;
  if (route.id) return <ModeDetail id={route.id} defaultMode={defaultMode} onSetDefault={onSetDefault} />;
  return (
    <div className="space-y-4">
      <GroupHeader title="模式包" count={modes.length} actions={<RefreshButton />} />
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
      </p>
    </div>
  );
}
