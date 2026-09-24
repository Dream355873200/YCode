// 设置页导航：左栏分区 + 详情路由栈。能力目录里的卡片可跨分区跳转
//（模式 → 插件 → 技能 …），返回按钮逐级弹栈；点左栏分区即重置栈。
import { createContext, useContext } from 'react';
import {
  BlocksIcon, BotIcon, CableIcon, CpuIcon, FileTextIcon, InfoIcon, PuzzleIcon, Settings2Icon,
  ShapesIcon, SparklesIcon,
} from 'lucide-react';

export type Tab = 'general' | 'model' | 'modes' | 'toolsets' | 'plugins' | 'agents' | 'skills' | 'prompts' | 'mcp' | 'about';

export const TABS: Array<{ id: Tab; label: string; icon: typeof Settings2Icon }> = [
  { id: 'general', label: '常规', icon: Settings2Icon },
  { id: 'model', label: '模型设置', icon: CpuIcon },
  { id: 'modes', label: '模式', icon: ShapesIcon },
  { id: 'plugins', label: '插件', icon: PuzzleIcon },
  { id: 'prompts', label: '提示词', icon: FileTextIcon },
  { id: 'toolsets', label: '工具集', icon: BlocksIcon },
  { id: 'agents', label: '子代理', icon: BotIcon },
  { id: 'mcp', label: 'MCP', icon: CableIcon },
  { id: 'skills', label: '技能', icon: SparklesIcon },
  { id: 'about', label: '关于', icon: InfoIcon },
];

export const tabLabel = (t: Tab): string => TABS.find((x) => x.id === t)?.label ?? t;

/** 路由：分区 + 可选详情 id（无 id = 分区清单页）。
 *  详情 id 约定：工具集 `base` = 基础工具；提示词 `@builtin` = 内置提示词、
 *  `rule:<pluginId>` = 插件的领域规范；技能用 key（见 skillKey）。 */
export interface Route {
  tab: Tab;
  id?: string;
}

export interface Nav {
  route: Route;
  /** 上一级路由（返回按钮的去处与文案）；栈底为 null。 */
  prev: Route | null;
  go(tab: Tab, id?: string): void;
  back(): void;
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav 须在设置页内使用');
  return nav;
}

export const BUILTIN_PROMPT_ID = '@builtin';
export const BASE_TOOLSET_ID = 'base';
export const ruleId = (pluginId: string): string => `rule:${pluginId}`;
