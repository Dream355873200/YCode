import { describe, expect, it } from 'vitest';
import {
  buildAgentFile, buildModeManifest, buildPluginManifest, buildSkillFile, modeFormFrom, pluginFormFrom,
  splitFrontmatter,
} from './manifest';

const modeCtx = { isNew: true, modeIds: ['code'], pluginIds: ['explore', 'vision'], promptNames: ['flutter'] };

describe('buildModeManifest', () => {
  it('builds mode.json with defaults and omits empty optionals', () => {
    const r = buildModeManifest({ ...modeFormFrom(), id: 'review', name: '审查', plugins: ['explore'] }, modeCtx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.path).toBe('modes/review/mode.json');
    const m = JSON.parse(r.value.content);
    expect(m).toMatchObject({ id: 'review', name: '审查', plugins: ['explore'] });
    expect(m).not.toHaveProperty('prompts');
    expect(m).not.toHaveProperty('scaffold');
    expect(m.projectFields[0].id).toBe('dir');
  });

  it('rejects bad id, duplicates, unknown refs and bad fields', () => {
    const base = { ...modeFormFrom(), id: 'review', name: 'x' };
    expect(buildModeManifest({ ...base, id: 'a b' }, modeCtx).ok).toBe(false);
    expect(buildModeManifest({ ...base, id: 'code' }, modeCtx).ok).toBe(false);
    expect(buildModeManifest({ ...base, id: 'code' }, { ...modeCtx, isNew: false }).ok).toBe(true);
    expect(buildModeManifest({ ...base, name: ' ' }, modeCtx).ok).toBe(false);
    expect(buildModeManifest({ ...base, plugins: ['nope'] }, modeCtx).ok).toBe(false);
    expect(buildModeManifest({ ...base, plugins: ['explore', 'explore'] }, modeCtx).ok).toBe(false);
    expect(buildModeManifest({ ...base, prompts: 'nope' }, modeCtx).ok).toBe(false);
    expect(buildModeManifest({ ...base, projectFields: '{' }, modeCtx).ok).toBe(false);
    expect(buildModeManifest({ ...base, projectFields: '[{"id":"k","label":"K","type":"choice"}]' }, modeCtx).ok).toBe(false);
  });
});

describe('buildPluginManifest', () => {
  const ctx = { isNew: true, pluginIds: ['explore'], toolsets: ['flutter'], otherMcpNames: ['taken'] };

  it('writes plugin.json plus rules file, keeping directory fields', () => {
    const form = { ...pluginFormFrom(), id: 'mine', name: '我的', rules: '# 规范', agents: 'agents', toolsets: ['flutter'] };
    const r = buildPluginManifest(form, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((w) => w.path)).toEqual(['plugins/mine/plugin.json', 'plugins/mine/rules.md']);
    expect(JSON.parse(r.value[0]!.content)).toEqual({ id: 'mine', name: '我的', toolsets: ['flutter'], rules: 'rules.md', agents: 'agents' });
  });

  it('keeps the rules reference untouched when content is not loaded', () => {
    const p = {
      id: 'mine', name: 'x', rules: 'RULES.md', agents: 'agents', dir: '/u/plugins/mine', origin: 'user' as const,
      agentDefs: [], usedBy: [],
    };
    const r = buildPluginManifest(pluginFormFrom(p), { ...ctx, isNew: false, pluginIds: ['mine'] });
    expect(r.ok && r.value.length).toBe(1);
    expect(r.ok && JSON.parse(r.value[0]!.content).rules).toBe('RULES.md');
    const cleared = buildPluginManifest(pluginFormFrom(p, ''), { ...ctx, isNew: false });
    expect(cleared.ok && JSON.parse(cleared.value[0]!.content)).not.toHaveProperty('rules');
  });

  it('validates MCP servers', () => {
    const base = { ...pluginFormFrom(), id: 'mine', name: 'x' };
    expect(buildPluginManifest({ ...base, mcpServers: '[{"name":"a","command":"x","url":"y"}]' }, ctx).ok).toBe(false);
    expect(buildPluginManifest({ ...base, mcpServers: '[{"name":"taken","command":"x"}]' }, ctx).ok).toBe(false);
    expect(buildPluginManifest({ ...base, mcpServers: '[{"name":"a b","url":"y"}]' }, ctx).ok).toBe(false);
    const ok = buildPluginManifest({ ...base, mcpServers: '[{"name":"a","url":"http://x"}]' }, ctx);
    expect(ok.ok && JSON.parse(ok.value[0]!.content).mcpServers).toEqual([{ name: 'a', url: 'http://x' }]);
    expect(buildPluginManifest({ ...base, toolsets: ['nope'] }, ctx).ok).toBe(false);
  });
});

describe('agent / skill files', () => {
  it('round-trips agent frontmatter', () => {
    const r = buildAgentFile(
      { name: 'rev', description: '审查\n代码', tools: 'Read, Grep,', maxTurns: '20', prompt: '你是审查助手' },
      { pluginId: 'mine', agentsDir: 'agents', isNew: true, agentNames: [] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.path).toBe('plugins/mine/agents/rev.md');
    const { fields, body } = splitFrontmatter(r.value.content);
    expect(fields).toEqual({ name: 'rev', description: '审查 代码', tools: 'Read, Grep', maxTurns: '20' });
    expect(body.trim()).toBe('你是审查助手');
  });

  it('rejects invalid agents', () => {
    const f = { name: 'rev', description: 'd', tools: 'Read', maxTurns: '', prompt: 'p' };
    const ctx = { pluginId: 'mine', agentsDir: 'agents', isNew: true, agentNames: ['explore'] };
    expect(buildAgentFile({ ...f, name: 'explore' }, ctx).ok).toBe(false);
    expect(buildAgentFile({ ...f, tools: ' , ' }, ctx).ok).toBe(false);
    expect(buildAgentFile({ ...f, maxTurns: '0' }, ctx).ok).toBe(false);
    expect(buildAgentFile({ ...f, prompt: '' }, ctx).ok).toBe(false);
  });

  it('builds SKILL.md with when-to-use', () => {
    const r = buildSkillFile({ name: 'deploy', description: '发布', whenToUse: '', body: '步骤…' }, { isNew: true, skillNames: [] });
    expect(r.ok && r.value.path).toBe('skills/deploy/SKILL.md');
    expect(r.ok && splitFrontmatter(r.value.content).fields).toEqual({ name: 'deploy', description: '发布' });
    expect(buildSkillFile({ name: 'deploy', description: 'd', whenToUse: '', body: 'b' }, { isNew: true, skillNames: ['deploy'] }).ok).toBe(false);
  });
});
