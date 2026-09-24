// 实体卡片：每类能力一个卡片组件，点击跳到该能力的详情页。
// 只由上层容器展示下层（模式 → 插件 / 提示词 / 工具 …，插件 → 它打包的能力），
// 详情页不做反向引用。
import {
  BlocksIcon, BotIcon, CableIcon, FileTextIcon, PanelRightIcon, PuzzleIcon, ScrollTextIcon,
  SparklesIcon, WrenchIcon,
} from 'lucide-react';
import type { AgentDecl, MCPServerDecl, MCPServerStatus, ModeDecl, ModeSidePanel } from '../modeRegistry';
import {
  baseTools, skillKey, useCatalog, type PluginItem, type PromptGroupItem, type SkillItem,
} from './catalog';
import { BASE_TOOLSET_ID, BUILTIN_PROMPT_ID, ruleId, useNav } from './nav';
import { baseName, Chip, LinkCard, mcpSummary, McpStatusBadge } from './ui';

const ICON = 'size-4';

export function PluginCard({ plugin }: { plugin: PluginItem }) {
  const { go } = useNav();
  return (
    <LinkCard icon={<PuzzleIcon className={ICON} />} title={plugin.name} desc={plugin.description || plugin.id}
      badge={plugin.usedBy.length === 0 ? <Chip>未引用</Chip> : undefined}
      onClick={() => go('plugins', plugin.id)} />
  );
}

/** 插件 id 引用（清单里可能找不到——如声明了但未安装）。 */
export function PluginRefCard({ id }: { id: string }) {
  const { plugins } = useCatalog();
  const p = plugins.find((x) => x.id === id);
  if (p) return <PluginCard plugin={p} />;
  return <LinkCard icon={<PuzzleIcon className={ICON} />} title={id} desc="未安装" />;
}

export function PromptGroupCard({ group }: { group: PromptGroupItem }) {
  const { go } = useNav();
  const n = group.files?.length ?? 0;
  return (
    <LinkCard icon={<FileTextIcon className={ICON} />} title={group.name} mono
      desc={n ? `提示词组 · 覆盖 ${n} 段，其余沿用内置` : '提示词组 · 空组（等同内置）'}
      onClick={() => go('prompts', group.name)} />
  );
}

export function BuiltinPromptCard() {
  const { go } = useNav();
  return (
    <LinkCard icon={<FileTextIcon className={ICON} />} title="内置通用 Agent"
      desc="引擎内置的完整系统提示词（身份 / 任务执行 / 工具使用 / 语气…）"
      badge={<Chip>内置</Chip>}
      onClick={() => go('prompts', BUILTIN_PROMPT_ID)} />
  );
}

/** 模式引用的提示词组（未引用 = 内置提示词）。 */
export function ModePromptCard({ mode }: { mode: ModeDecl }) {
  const { prompts } = useCatalog();
  if (!mode.prompts) return <BuiltinPromptCard />;
  const g = prompts.find((x) => x.name === mode.prompts);
  if (g) return <PromptGroupCard group={g} />;
  return <LinkCard icon={<FileTextIcon className={ICON} />} title={mode.prompts} mono desc="提示词组不存在" />;
}

export function RuleCard({ plugin }: { plugin: PluginItem }) {
  const { go } = useNav();
  return (
    <LinkCard icon={<ScrollTextIcon className={ICON} />} title={`${plugin.id} 规范`}
      desc={`领域规范 · ${plugin.rules ? baseName(plugin.rules) : ''}`}
      onClick={() => go('prompts', ruleId(plugin.id))} />
  );
}

export function BaseToolsCard() {
  const { go } = useNav();
  const catalog = useCatalog();
  const n = baseTools(catalog).length;
  return (
    <LinkCard icon={<WrenchIcon className={ICON} />} title="基础工具"
      desc={`${n ? `${n} 个工具 · ` : ''}文件读写 / Bash / 检索 / 任务 / 计划 / 提问，所有模式恒可用`}
      badge={<Chip>内置</Chip>}
      onClick={() => go('toolsets', BASE_TOOLSET_ID)} />
  );
}

export function ToolsetCard({ id }: { id: string }) {
  const { go } = useNav();
  const { toolsets } = useCatalog();
  const n = toolsets[id]?.tools?.length ?? 0;
  return (
    <LinkCard icon={<BlocksIcon className={ICON} />} title={id} mono desc={n ? `${n} 个工具` : '运行期机制'}
      onClick={() => go('toolsets', id)} />
  );
}

export function AgentCard({ agent }: { agent: AgentDecl }) {
  const { go } = useNav();
  return (
    <LinkCard icon={<BotIcon className={ICON} />} title={agent.name} desc={agent.description}
      badge={<Chip>{agent.tools.length} 工具</Chip>}
      onClick={() => go('agents', agent.name)} />
  );
}

export function McpCard({ decl, status }: { decl: MCPServerDecl; status?: MCPServerStatus }) {
  const { go } = useNav();
  return (
    <LinkCard icon={<CableIcon className={ICON} />} title={decl.name}
      desc={status?.status === 'error' && status.error ? status.error : mcpSummary(decl)}
      badge={<McpStatusBadge status={status} />}
      onClick={() => go('mcp', decl.name)} />
  );
}

export function SkillCard({ skill }: { skill: SkillItem }) {
  const { go } = useNav();
  return (
    <LinkCard icon={<SparklesIcon className={ICON} />} title={skill.name}
      desc={skill.description || skill.whenToUse || '（无描述）'}
      onClick={() => go('skills', skillKey(skill))} />
  );
}

/** 右栏面板卡：面板是桌面壳组件，没有独立详情页（静态卡）。 */
export function PanelCard({ panel }: { panel: ModeSidePanel }) {
  return <LinkCard icon={<PanelRightIcon className={ICON} />} title={panel.label} desc={panel.id} />;
}
