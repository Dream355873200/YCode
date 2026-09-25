// 能力目录数据层：设置页打开时一次拉齐引擎的只读资源（模式 / 插件 / 技能 /
// 提示词组 / MCP 状态 / 已注册工具），各分区与详情页共享同一份快照，
// 跨分区跳转不重复请求。另附按「模式 / 插件」聚合能力的纯函数，
// 与引擎的装配规则一一对应。
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AgentDecl, MCPServerDecl, MCPServerStatus, ModeDecl, ModeSidePanel } from '../modeRegistry';
import { engine } from '../../protocol';

/** 资产来源：应用内置（只读，可复制为自定义）/ 用户资产目录（可编辑、删除）。 */
export type AssetOrigin = 'bundled' | 'user';

/** 引擎逐项加载错误（坏项被跳过，不影响其他项）。 */
export interface LoadError {
  kind: 'mode' | 'plugin' | 'agent' | 'mcp';
  id: string;
  file?: string;
  error: string;
}

export interface PluginItem {
  id: string;
  name: string;
  description?: string;
  toolsets?: string[];
  /** 规范文件（插件目录相对路径）；rulesFile 为解析后的绝对路径。 */
  rules?: string;
  rulesFile?: string;
  skills?: string;
  agents?: string;
  mcpServers?: MCPServerDecl[];
  sidePanels?: ModeSidePanel[];
  dir: string;
  origin: AssetOrigin;
  agentDefs: AgentDecl[];
  usedBy: string[];
  disabled?: boolean;
}

export interface SkillItem {
  name: string;
  description?: string;
  whenToUse?: string;
  origin: 'plugin' | 'user' | 'global';
  plugin?: string;
  filePath?: string;
}

export interface PromptGroupItem {
  name: string;
  dir?: string;
  origin?: AssetOrigin;
  files?: string[];
  usedBy: string[];
}

/** goagent GET /tools 的一项（全部已注册工具，不分会话）。 */
export interface ToolInfo {
  name: string;
  description: string;
  permission: string;
  concurrent: boolean;
}

/** /modes 附带的 toolset 明细：id → 工具名 + 非工具资产说明。 */
export type ToolsetsDetail = Record<string, { tools?: string[]; notes?: string[] }>;

export interface Catalog {
  modes: ModeDecl[];
  toolsets: ToolsetsDetail;
  plugins: PluginItem[];
  skills: SkillItem[];
  prompts: PromptGroupItem[];
  mcp: MCPServerStatus[];
  tools: ToolInfo[];
  /** 模式 / 插件 / 子代理 / MCP 的加载错误。 */
  errors: LoadError[];
  loaded: boolean;
  loading: boolean;
  error: string;
  refresh(): void;
}

const CatalogContext = createContext<Catalog | null>(null);

export function useCatalog(): Catalog {
  const c = useContext(CatalogContext);
  if (!c) throw new Error('useCatalog 须在 CatalogProvider 内使用');
  return c;
}

type Body = Record<string, unknown> | undefined;
type Resp = Awaited<ReturnType<typeof engine.get>>;
const listOf = <T,>(body: Body, key: string): T[] => (body?.[key] as T[] | undefined) ?? [];

/** 目录快照提供者。MCP server 在引擎启动后后台连接：仍有 server 处于
 *  connecting 时每 2s 只重拉 /mcp，全部落定即停。 */
export function CatalogProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Omit<Catalog, 'loaded' | 'loading' | 'error' | 'refresh'>>({
    modes: [], toolsets: {}, plugins: [], skills: [], prompts: [], mcp: [], tools: [], errors: [],
  });
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(['/modes', '/plugins', '/skills', '/prompts', '/mcp', '/tools'].map((p) => engine.get(p)))
      .then((rs) => {
        if (!alive) return;
        const [modes, plugins, skills, prompts, mcp, tools] = rs as [Resp, Resp, Resp, Resp, Resp, Resp];
        if (modes.unreachable) {
          setError('引擎未运行，能力目录暂不可用');
          return;
        }
        const mb = modes.body as Body;
        setData({
          modes: listOf<ModeDecl>(mb, 'modes'),
          toolsets: (mb?.toolsets as ToolsetsDetail | undefined) ?? {},
          plugins: listOf<PluginItem>(plugins.body as Body, 'plugins'),
          skills: listOf<SkillItem>(skills.body as Body, 'skills'),
          prompts: listOf<PromptGroupItem>(prompts.body as Body, 'prompts'),
          mcp: listOf<MCPServerStatus>(mcp.body as Body, 'servers'),
          tools: Array.isArray(tools.body) ? (tools.body as ToolInfo[]) : [],
          errors: [...listOf<LoadError>(mb, 'errors'), ...listOf<LoadError>(plugins.body as Body, 'errors')],
        });
        setError('');
        setLoaded(true);
      })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tick]);

  const connecting = data.mcp.some((s) => s.status === 'connecting');
  useEffect(() => {
    if (!connecting) return;
    let alive = true;
    const timer = setTimeout(() => {
      engine.get('/mcp').then((r) => {
        if (alive) setData((d) => ({ ...d, mcp: listOf<MCPServerStatus>(r.body as Body, 'servers') }));
      }).catch(() => {});
    }, 2000);
    return () => { alive = false; clearTimeout(timer); };
  }, [connecting, data.mcp]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return (
    <CatalogContext.Provider value={{ ...data, loaded, loading, error, refresh }}>
      {children}
    </CatalogContext.Provider>
  );
}

// ---------- 聚合规则（与引擎装配一致）----------

/** 技能路由 key：同名技能可能同时来自插件与全局，用文件路径区分。 */
export const skillKey = (s: SkillItem): string => s.filePath || `${s.origin}:${s.plugin ?? ''}:${s.name}`;

/** 模式引用的插件（按 mode.json 顺序；清单里找不到的忽略）。 */
export const modePlugins = (c: Catalog, m: ModeDecl): PluginItem[] =>
  m.plugins.map((id) => c.plugins.find((p) => p.id === id)).filter((p): p is PluginItem => !!p);

/** 会话可见技能 = 引用插件的技能 + 用户技能 + 全局技能。 */
export const modeSkills = (c: Catalog, m: ModeDecl): SkillItem[] =>
  c.skills.filter((s) => s.origin !== 'plugin' || (s.plugin !== undefined && m.plugins.includes(s.plugin)));

/** 子代理 + 其所属插件。 */
export const allAgents = (c: Catalog): Array<{ agent: AgentDecl; plugin: PluginItem }> =>
  c.plugins.flatMap((p) => (p.agentDefs ?? []).map((agent) => ({ agent, plugin: p })));

/** MCP 声明 + 所属插件 + 实时状态（server 名全局唯一，引擎加载时校验）。 */
export const allMcp = (c: Catalog): Array<{ decl: MCPServerDecl; plugin: PluginItem; status?: MCPServerStatus }> =>
  c.plugins.flatMap((p) => (p.mcpServers ?? []).map((decl) => ({
    decl, plugin: p, status: c.mcp.find((s) => s.name === decl.name),
  })));

/** 基础工具：已注册工具去掉工具集工具、子代理（Agent_*）与 MCP 工具（mcp__*），
 *  即所有模式恒可用的那部分。 */
export function baseTools(c: Catalog): ToolInfo[] {
  const owned = new Set(Object.values(c.toolsets).flatMap((d) => d.tools ?? []));
  return c.tools.filter((t) => !owned.has(t.name) && !t.name.startsWith('Agent_') && !t.name.startsWith('mcp__'));
}

/** 按 id 取模式。 */
export const modeById = (c: Catalog, id: string): ModeDecl | undefined => c.modes.find((m) => m.id === id);
export const pluginById = (c: Catalog, id: string): PluginItem | undefined => c.plugins.find((p) => p.id === id);

/** 指定类别、指定 id 的加载错误。 */
export const errorsFor = (c: Catalog, kinds: LoadError['kind'][], id?: string): LoadError[] =>
  c.errors.filter((e) => kinds.includes(e.kind) && (id === undefined || e.id === id));

/** 除指定插件外已占用的 MCP server 名（server 名须全局唯一）。 */
export const mcpNamesExcept = (c: Catalog, pluginId: string): string[] =>
  c.plugins.filter((p) => p.id !== pluginId).flatMap((p) => (p.mcpServers ?? []).map((s) => s.name));
