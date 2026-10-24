import { describe, expect, it } from 'vitest';
import type { Row } from '../projection/rows';
import {
  buildStatusPanelModel, capsuleOf, extractPlans, foldLabel, formatDuration, goalElapsedMs, planTitle,
  todoFocusWindow, type TaskItem,
} from './statusPanelModel';

const tool = (p: Partial<Extract<Row, { kind: 'tool' }>>): Row => ({
  kind: 'tool', id: p.toolUseId ?? 'x', toolUseId: 'x', name: 'Bash', state: 'ok', ...p,
} as Row);

const tasks = (statuses: string[]): TaskItem[] => statuses.map((status, i) => ({ id: String(i + 1), subject: `任务${i + 1}`, status }));

describe('statusPanelModel', () => {
  it('计划取自已结束的 ExitPlanMode 结果，新的在前', () => {
    const rows = [
      tool({ toolUseId: 'p1', name: 'ExitPlanMode', result: '已退出计划模式。计划内容:\n# 重构登录\n- 拆服务' }),
      tool({ toolUseId: 'p2', name: 'ExitPlanMode', state: 'running', result: '' }),
      tool({ toolUseId: 'p3', name: 'ExitPlanMode', result: '已退出计划模式（无计划内容）。' }),
      tool({ toolUseId: 'p4', name: 'ExitPlanMode', result: '已退出计划模式。计划内容:\n第二版方案\n细节' }),
    ];
    expect(extractPlans(rows).map((p) => [p.toolUseId, p.title])).toEqual([['p4', '第二版方案'], ['p1', '重构登录']]);
    expect(planTitle('**加粗** 开头\n')).toBe('加粗 开头');
  });

  it('流水线只在发起它的对话里出现，节点按 DAG 层序', () => {
    const pipeline = {
      sessionId: 's1', goal: '翻译文档', startedAt: 1, finishedAt: null,
      nodes: [
        { name: 'merge', status: 'pending' as const, dependsOn: ['a', 'b'] },
        { name: 'a', status: 'done' as const },
        { name: 'b', status: 'running' as const },
      ],
    };
    const m = buildStatusPanelModel({ sid: 's1', pipeline });
    expect(m.pipeline?.nodes.map((n) => n.name)).toEqual(['a', 'b', 'merge']);
    expect(m.pipeline).toMatchObject({ settled: 1, total: 3, running: ['b'] });
    expect(buildStatusPanelModel({ sid: 's2', pipeline }).pipeline).toBeNull();
    expect(buildStatusPanelModel({ sid: 's1', pipeline: { ...pipeline, finishedAt: 9 } }).pipeline).toBeNull();
  });

  it('终端只列本对话运行中的后台命令；子代理分运行中与已结束', () => {
    const m = buildStatusPanelModel({
      sid: 's1',
      rows: [tool({ toolUseId: 'ag1', name: 'Agent_explore', input: { description: '查找登录入口' } })],
      bgtasks: [
        { id: 'b1', type: 'local_bash', status: 'running', session_id: 's1', description: 'npm run dev' },
        { id: 'b2', type: 'local_bash', status: 'running', session_id: 's2' },
        { id: 'b3', type: 'local_bash', status: 'completed', session_id: 's1' },
        { id: 'a1', type: 'local_agent', status: 'running', session_id: 's1' },
      ],
      agents: [
        { id: 'ag1', name: 'explore', status: 'running' },
        { id: 'ag2', name: 'explore', status: 'done' },
      ],
    });
    expect(m.terminals.map((t) => t.title)).toEqual(['npm run dev']);
    expect(m.agents.map((a) => a.title)).toEqual(['查找登录入口']);
    expect(m.endedAgents).toBe(1);
  });

  it('Git 只在有行级改动时出现；环境资源全空时不出现', () => {
    expect(buildStatusPanelModel({ sid: 's', git: { ok: true, added: 0, deleted: 0, files: 0 } }).git).toBeNull();
    expect(buildStatusPanelModel({ sid: 's', git: { ok: true, added: 3, deleted: 1, files: 2 } }).git).not.toBeNull();
    expect(buildStatusPanelModel({ sid: 's', env: { browserPages: 0, devices: [], mcp: [] } }).hasContent).toBe(false);
    expect(buildStatusPanelModel({ sid: 's', env: { devices: ['Pixel 8'] } }).env?.devices).toEqual(['Pixel 8']);
  });

  it('胶囊主状态按优先级取一项，后台计数常驻尾部', () => {
    const git = { ok: true, added: 5, deleted: 2, files: 1 };
    const agents = [{ id: 'a', name: 'explore', status: 'running' }];
    const base = { sid: 's', git, agents };
    expect(capsuleOf(buildStatusPanelModel({ ...base, tasks: tasks(['completed', 'in_progress', 'pending']) })))
      .toEqual({ main: { kind: 'todoCurrent', text: '任务2' }, agents: 1, terminals: 0 });
    expect(capsuleOf(buildStatusPanelModel(base))?.main).toEqual({ kind: 'git', added: 5, deleted: 2 });
    const goal = { objective: '测试全绿', status: 'active', iteration: 1, maxIterations: 8, elapsedMs: 0, createdAt: 0 };
    expect(capsuleOf(buildStatusPanelModel({ ...base, goal }))?.main).toEqual({ kind: 'goal', text: '测试全绿', done: false });
    expect(capsuleOf(buildStatusPanelModel({ ...base, git: null, goal: { ...goal, status: 'verified' } }))?.main.kind).toBe('goal');
    expect(capsuleOf(buildStatusPanelModel({ sid: 's', tasks: tasks(['completed', 'completed']) }))?.main)
      .toEqual({ kind: 'todoDone', text: '任务2' });
    expect(capsuleOf(buildStatusPanelModel({ sid: 's', agents }))?.main).toEqual({ kind: 'activity' });
    expect(capsuleOf(buildStatusPanelModel({ sid: 's' }))).toBeNull();
  });

  it('进程超过 6 条时只露当前附近 3 条，折叠桶按真实状态命名', () => {
    const items = tasks(['completed', 'completed', 'completed', 'completed', 'in_progress', 'pending', 'pending', 'pending']);
    const w = todoFocusWindow(items);
    expect(w.compact).toBe(true);
    expect(w.focus.map((t) => t.id)).toEqual(['5', '6', '7']);
    expect(foldLabel('preceding', w.preceding)).toBe('已完成 4 项');
    expect(foldLabel('following', w.following)).toBe('待处理 1 项');
    const tail = todoFocusWindow(tasks(['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'in_progress']));
    expect(tail.focus.map((t) => t.id)).toEqual(['5', '6', '7']);
    expect(todoFocusWindow(tasks(['pending', 'pending'])).compact).toBe(false);
  });

  it('目标计时与时长格式', () => {
    const g = { objective: 'x', status: 'active', iteration: 1, maxIterations: 8, elapsedMs: 60_000, activeSince: 1_000, createdAt: 0 };
    expect(goalElapsedMs(g, 31_000)).toBe(90_000);
    expect(goalElapsedMs({ ...g, status: 'paused' }, 31_000)).toBe(60_000);
    expect(formatDuration(90_000)).toBe('1分 30秒');
    expect(formatDuration(3_720_000)).toBe('1小时 2分');
    expect(formatDuration(500)).toBe('0秒');
  });
});
