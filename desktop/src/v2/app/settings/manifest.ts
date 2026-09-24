// 用户资产清单构建（纯函数，无 IO）：设置页表单 → 校验 → 待写文件。
// 校验规则与引擎加载一致（mode.go / plugin.go / agents.go / skillsdir.go），
// 在前端先拦下能预知的错误；引擎 reload 仍是最终裁决（错误回显到页面）。
// 路径一律相对用户资产根（electron assets:* 限定在其内）。
import type { MCPServerDecl, ModeDecl, ProjectField } from '../modeRegistry';
import type { PluginItem } from './catalog';

/** 模式 / 插件 / 子代理 / 技能 / MCP 名的合法字符集（进目录名与工具名）。 */
export const ID_RE = /^[A-Za-z0-9_-]+$/;

export type BuildResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** 一次保存要写入的文件（相对用户资产根）。 */
export interface FileWrite {
  path: string;
  content: string;
}

const fail = <T,>(error: string): BuildResult<T> => ({ ok: false, error });
const json = (v: unknown): string => `${JSON.stringify(v, null, 2)}\n`;
/** frontmatter 值只支持单行：换行折成空格。 */
const oneLine = (s: string): string => s.replace(/\s*\r?\n\s*/g, ' ').trim();

// ---------- 模式 ----------

export interface ModeForm {
  id: string;
  name: string;
  description: string;
  /** 提示词组名；空 = 内置通用提示词。 */
  prompts: string;
  plugins: string[];
  scaffold: string;
  /** projectFields 的 JSON 文本（简易编辑）。 */
  projectFields: string;
}

/** 无脚手架模式的默认新建项目表单：打开已有目录。 */
export const DEFAULT_PROJECT_FIELDS: ProjectField[] = [
  { id: 'dir', label: '工作目录', type: 'folder', required: true, placeholder: '选择要打开的项目文件夹' },
  { id: 'name', label: '显示名称', type: 'text', placeholder: '留空则使用目录名' },
];

export function modeFormFrom(m?: ModeDecl): ModeForm {
  return {
    id: m?.id ?? '',
    name: m?.name ?? '',
    description: m?.description ?? '',
    prompts: m?.prompts ?? '',
    plugins: m ? [...m.plugins] : [],
    scaffold: m?.scaffold ?? '',
    projectFields: JSON.stringify(m?.projectFields?.length ? m.projectFields : DEFAULT_PROJECT_FIELDS, null, 2),
  };
}

const FIELD_TYPES = ['text', 'textarea', 'folder', 'choice'];

function parseProjectFields(text: string): BuildResult<ProjectField[]> {
  let v: unknown;
  try { v = JSON.parse(text || '[]'); } catch (e) {
    return fail(`新建项目字段不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(v)) return fail('新建项目字段须为数组');
  const seen = new Set<string>();
  for (const [i, f] of v.entries()) {
    const at = `新建项目字段第 ${i + 1} 项`;
    if (!f || typeof f !== 'object') return fail(`${at}须为对象`);
    const { id, label, type, options } = f as Partial<ProjectField>;
    if (!id || typeof id !== 'string') return fail(`${at}缺少 id`);
    if (seen.has(id)) return fail(`${at}：id「${id}」重复`);
    seen.add(id);
    if (!label) return fail(`${at}缺少 label`);
    if (!type || !FIELD_TYPES.includes(type)) return fail(`${at}：type 须为 ${FIELD_TYPES.join(' / ')}`);
    if (type === 'choice' && !(Array.isArray(options) && options.length)) return fail(`${at}：choice 须声明 options`);
  }
  return { ok: true, value: v as ProjectField[] };
}

/** 模式表单 → modes/<id>/mode.json。isNew 时 id 不得与已有模式重复。 */
export function buildModeManifest(form: ModeForm, ctx: {
  isNew: boolean; modeIds: string[]; pluginIds: string[]; promptNames: string[];
}): BuildResult<FileWrite> {
  const id = form.id.trim();
  const name = form.name.trim();
  if (!ID_RE.test(id)) return fail('id 只能含字母、数字、_、-');
  if (ctx.isNew && ctx.modeIds.includes(id)) return fail(`模式 ${id} 已存在（内置模式请用「复制为自定义」）`);
  if (!name) return fail('请填写名称');
  if (new Set(form.plugins).size !== form.plugins.length) return fail('插件重复引用');
  const unknown = form.plugins.filter((p) => !ctx.pluginIds.includes(p));
  if (unknown.length) return fail(`未知插件：${unknown.join(', ')}`);
  const prompts = form.prompts.trim();
  if (prompts && !ctx.promptNames.includes(prompts)) return fail(`提示词组 ${prompts} 不存在`);
  const fields = parseProjectFields(form.projectFields);
  if (!fields.ok) return fields;
  const manifest: Record<string, unknown> = { id, name };
  if (form.description.trim()) manifest.description = form.description.trim();
  if (prompts) manifest.prompts = prompts;
  manifest.plugins = form.plugins;
  if (form.scaffold.trim()) manifest.scaffold = form.scaffold.trim();
  manifest.projectFields = fields.value;
  return { ok: true, value: { path: `modes/${id}/mode.json`, content: json(manifest) } };
}

// ---------- 插件 ----------

export interface PluginForm {
  id: string;
  name: string;
  description: string;
  toolsets: string[];
  /** 规范正文；空串 = 不声明 rules；undefined = 不改动（沿用 rulesFile 引用，不写文件）。 */
  rules?: string;
  /** 规范文件名（相对插件目录；编辑已有插件时沿用原名，空 = 尚无规范）。 */
  rulesFile: string;
  /** mcpServers 的 JSON 文本。 */
  mcpServers: string;
  /** 原样保留的目录字段（skills / agents 目录由各自编辑器维护）。 */
  skills?: string;
  agents?: string;
  sidePanels?: PluginItem['sidePanels'];
}

/** 插件表单初值。rulesContent 省略 = 规范不改动（只改清单时用）。 */
export function pluginFormFrom(p?: PluginItem, rulesContent?: string): PluginForm {
  return {
    id: p?.id ?? '',
    name: p?.name ?? '',
    description: p?.description ?? '',
    toolsets: [...(p?.toolsets ?? [])],
    rules: p ? rulesContent : '',
    rulesFile: p?.rules ?? '',
    mcpServers: p?.mcpServers?.length ? JSON.stringify(p.mcpServers, null, 2) : '[]',
    skills: p?.skills,
    agents: p?.agents,
    sidePanels: p?.sidePanels,
  };
}

function parseMcpServers(text: string, taken: string[]): BuildResult<MCPServerDecl[]> {
  let v: unknown;
  try { v = JSON.parse(text.trim() || '[]'); } catch (e) {
    return fail(`MCP 配置不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(v)) return fail('MCP 配置须为数组');
  const seen = new Set<string>();
  for (const [i, s] of v.entries()) {
    const at = `MCP 第 ${i + 1} 项`;
    if (!s || typeof s !== 'object') return fail(`${at}须为对象`);
    const { name, command, url } = s as Partial<MCPServerDecl>;
    if (!name || !ID_RE.test(name)) return fail(`${at}：name 只能含字母、数字、_、-`);
    if (seen.has(name) || taken.includes(name)) return fail(`${at}：server 名「${name}」已被占用（须全局唯一）`);
    seen.add(name);
    if (!!command === !!url) return fail(`${at}：command（stdio）与 url（远程）须二选一`);
  }
  return { ok: true, value: v as MCPServerDecl[] };
}

/** 插件表单 → plugins/<id>/plugin.json（+ 规范文件）。
 *  otherMcpNames = 其他插件已占用的 MCP server 名。 */
export function buildPluginManifest(form: PluginForm, ctx: {
  isNew: boolean; pluginIds: string[]; toolsets: string[]; otherMcpNames: string[];
}): BuildResult<FileWrite[]> {
  const id = form.id.trim();
  const name = form.name.trim();
  if (!ID_RE.test(id)) return fail('id 只能含字母、数字、_、-');
  if (ctx.isNew && ctx.pluginIds.includes(id)) return fail(`插件 ${id} 已存在（内置插件请用「复制为自定义」）`);
  if (!name) return fail('请填写名称');
  const unknown = form.toolsets.filter((t) => !ctx.toolsets.includes(t));
  if (unknown.length) return fail(`未知工具集：${unknown.join(', ')}`);
  const mcp = parseMcpServers(form.mcpServers, ctx.otherMcpNames);
  if (!mcp.ok) return mcp;
  const writes: FileWrite[] = [];
  const manifest: Record<string, unknown> = { id, name };
  if (form.description.trim()) manifest.description = form.description.trim();
  if (form.toolsets.length) manifest.toolsets = form.toolsets;
  if (form.rules === undefined) {
    if (form.rulesFile) manifest.rules = form.rulesFile;
  } else if (form.rules.trim()) {
    const file = form.rulesFile.trim() || 'rules.md';
    manifest.rules = file;
    writes.push({ path: `plugins/${id}/${file}`, content: form.rules });
  }
  if (form.skills) manifest.skills = form.skills;
  if (form.agents) manifest.agents = form.agents;
  if (mcp.value.length) manifest.mcpServers = mcp.value;
  if (form.sidePanels?.length) manifest.sidePanels = form.sidePanels;
  writes.unshift({ path: `plugins/${id}/plugin.json`, content: json(manifest) });
  return { ok: true, value: writes };
}

// ---------- frontmatter（子代理 / 技能）----------

/** 拆出 frontmatter 单行字段与正文（与引擎 parseFrontmatter 的单行子集一致）。 */
export function splitFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const s = text.replace(/\r\n/g, '\n');
  if (!s.startsWith('---\n')) return { fields: {}, body: s };
  const end = s.indexOf('\n---', 4);
  if (end < 0) return { fields: {}, body: s };
  const fields: Record<string, string> = {};
  for (const line of s.slice(4, end).split('\n')) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (m?.[1]) fields[m[1]] = (m[2] ?? '').trim();
  }
  return { fields, body: s.slice(end + 4).replace(/^[^\n]*\n/, '').replace(/^\n+/, '') };
}

const frontmatter = (fields: Array<[string, string]>, body: string): string =>
  `---\n${fields.filter(([, v]) => v).map(([k, v]) => `${k}: ${oneLine(v)}`).join('\n')}\n---\n\n${body.trim()}\n`;

export interface AgentForm {
  name: string;
  description: string;
  /** 逗号分隔的只读工具名。 */
  tools: string;
  maxTurns: string;
  prompt: string;
}

/** 子代理表单 → plugins/<pluginId>/<agentsDir>/<name>.md。 */
export function buildAgentFile(form: AgentForm, ctx: {
  pluginId: string; agentsDir: string; isNew: boolean; agentNames: string[];
  /** 编辑已有定义时写回原文件（绝对路径，须在用户资产目录内）。 */
  path?: string;
}): BuildResult<FileWrite> {
  const name = form.name.trim();
  if (!ID_RE.test(name)) return fail('名称只能含字母、数字、_、-');
  if (ctx.isNew && ctx.agentNames.includes(name)) return fail(`子代理 ${name} 已存在（须全局唯一）`);
  if (!form.description.trim()) return fail('请填写描述（主 agent 据此决定何时委派）');
  const tools = form.tools.split(',').map((t) => t.trim()).filter(Boolean);
  if (!tools.length) return fail('请填写工具（逗号分隔的只读工具名）');
  const turns = form.maxTurns.trim();
  if (turns && !(/^\d+$/.test(turns) && Number(turns) > 0)) return fail('最大轮数须为正整数');
  if (!form.prompt.trim()) return fail('请填写系统提示（正文）');
  return {
    ok: true,
    value: {
      path: ctx.path ?? `plugins/${ctx.pluginId}/${ctx.agentsDir}/${name}.md`,
      content: frontmatter([
        ['name', name], ['description', form.description], ['tools', tools.join(', ')], ['maxTurns', turns],
      ], form.prompt),
    },
  };
}

export interface SkillForm {
  name: string;
  description: string;
  whenToUse: string;
  body: string;
}

/** 技能表单 → skills/<name>/SKILL.md（用户技能，所有模式可用）。 */
export function buildSkillFile(form: SkillForm, ctx: {
  isNew: boolean; skillNames: string[];
  /** 编辑已有技能时写回原文件（绝对路径，须在用户资产目录内）。 */
  path?: string;
}): BuildResult<FileWrite> {
  const name = form.name.trim();
  if (!ID_RE.test(name)) return fail('名称只能含字母、数字、_、-');
  if (ctx.isNew && ctx.skillNames.includes(name)) return fail(`用户技能 ${name} 已存在`);
  if (!form.description.trim()) return fail('请填写描述');
  if (!form.body.trim()) return fail('请填写技能正文');
  return {
    ok: true,
    value: {
      path: ctx.path ?? `skills/${name}/SKILL.md`,
      content: frontmatter([
        ['name', name], ['description', form.description], ['when-to-use', form.whenToUse],
      ], form.body),
    },
  };
}
