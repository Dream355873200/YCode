// 智能体图标：mode.json 的 icon 键 → lucide 图标（未知键回落 Bot）。
// 设置页图标选择器用 AGENT_ICON_KEYS 列出全部可选键。
import {
  BookOpenIcon, BotIcon, BriefcaseIcon, ChartColumnIcon, ClapperboardIcon, CodeIcon, DatabaseIcon, FileTextIcon,
  FlaskConicalIcon, Gamepad2Icon, GlobeIcon, GraduationCapIcon, PaletteIcon, PenToolIcon, SearchIcon,
  SmartphoneIcon, SparklesIcon, TerminalIcon, WrenchIcon, type LucideIcon,
} from 'lucide-react';
import { cn } from '../components/lib/utils';

const ICONS: Record<string, LucideIcon> = {
  code: CodeIcon,
  terminal: TerminalIcon,
  smartphone: SmartphoneIcon,
  globe: GlobeIcon,
  gamepad: Gamepad2Icon,
  'file-text': FileTextIcon,
  chart: ChartColumnIcon,
  database: DatabaseIcon,
  search: SearchIcon,
  flask: FlaskConicalIcon,
  palette: PaletteIcon,
  'pen-tool': PenToolIcon,
  book: BookOpenIcon,
  'graduation-cap': GraduationCapIcon,
  briefcase: BriefcaseIcon,
  wrench: WrenchIcon,
  sparkles: SparklesIcon,
  clapperboard: ClapperboardIcon,
  bot: BotIcon,
};

export const AGENT_ICON_KEYS = Object.keys(ICONS);

export function agentIcon(key?: string): LucideIcon {
  return (key && ICONS[key]) || BotIcon;
}

/** 智能体头像：品牌色淡底圆角方块 + 图标。 */
export function AgentAvatar({ icon, size = 'md', className }: {
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const Icon = agentIcon(icon);
  return (
    <span className={cn(
      'inline-flex shrink-0 items-center justify-center bg-brand/12 text-brand',
      size === 'sm' && 'size-5 rounded-md [&_svg]:size-3',
      size === 'md' && 'size-8 rounded-lg [&_svg]:size-4',
      size === 'lg' && 'size-12 rounded-2xl [&_svg]:size-6',
      className,
    )}>
      <Icon />
    </span>
  );
}
