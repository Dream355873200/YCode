// modeRegistry — 桌面壳侧的模式目录：引擎 GET /modes 返回全部模式及其
// 插件聚合视图（resolved）。模式是项目级的（projects.json 的 mode 字段，
// 缺省回落 config.engine.mode），切换只改会话绑定、不重启引擎。
// 壳只消费声明数据（sidePanels 的 id/label），组件映射在 pane 层注册——
// 内核不 import 任何具体 mode 的面板。
import { useApp } from './appState';

export interface ModeSidePanel { id: string; label: string }

/** MCP server 声明（stdio：command/args/env；远程：url/headers）。 */
export interface MCPServerDecl {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/** MCP server 运行状态（引擎 GET /mcp；工具名形如 mcp__<server>__<tool>）。 */
export interface MCPServerStatus {
  plugin: string;
  name: string;
  transport: 'stdio' | 'http';
  status: 'connecting' | 'connected' | 'error';
  error?: string;
  /** 服务端自报名/版本。 */
  server?: string;
  tools: string[];
}

/** 插件子代理（agents/<name>.md 解析产物；注册为 Agent_<name> 工具）。 */
export interface AgentDecl {
  name: string;
  description: string;
  tools: string[];
  maxTurns?: number;
  file: string;
}

/** 模式经插件聚合后的能力视图（引擎 ModeView）。 */
export interface ModeResolved {
  promptDir?: string;
  toolsets: string[];
  /** 领域工具名（工具集工具 + Agent_<name>；MCP 工具见 /mcp）。 */
  tools: string[];
  rules: string[];
  skillDirs: string[];
  /** 子代理名。 */
  agents: string[];
  mcpServers: MCPServerDecl[];
  sidePanels: ModeSidePanel[];
}

/** 新建项目表单字段（mode.json projectFields；引擎已校验结构）。 */
export interface ProjectField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'folder' | 'choice';
  required?: boolean;
  placeholder?: string;
  hint?: string;
  default?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface ModeDecl {
  id: string;
  name: string;
  description?: string;
  prompts?: string;
  plugins: string[];
  projectFields: ProjectField[];
  /** 脚手架 id（electron/lib/scaffolds.js 注册表；空 = 打开已有目录）。 */
  scaffold?: string;
  /** bundled = 应用内置；user = 用户资产目录（设置页可编辑）。 */
  origin?: 'bundled' | 'user';
  /** 模式包目录绝对路径。 */
  dir?: string;
  resolved: ModeResolved;
}

/** /modes 响应体。 */
export interface ModesBody {
  modes: ModeDecl[];
  defaultMode: string;
  toolsets: Record<string, { tools?: string[]; notes?: string[] }>;
}

/** 全部模式（引擎不可达时为空数组）。 */
export function useModes(): ModeDecl[] {
  return useApp().modes;
}

/** 当前项目的模式声明（未打开项目时取默认模式；引擎不可达时 null）。 */
export function useCurrentMode(): ModeDecl | null {
  const { modes, projectMode } = useApp();
  return modes.find((m) => m.id === projectMode) || null;
}
