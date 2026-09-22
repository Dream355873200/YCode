import { describe, it, expect, beforeEach } from 'vitest';
import { foldTurns, type TurnUnit } from './turns';
import { applyFrame, pushUser, resetRowIds, type Row } from './rows';
import type { Envelope } from '../../protocol';

const f = (p: Partial<Envelope>): Envelope => ({ seq: 1, v: 1, type: 'text_delta', ...p });

beforeEach(() => resetRowIds());

// 真实流里用户输入不进帧（引擎不回显）——本地 pushUser，与 store.send 同路径；
// 其余步骤补齐信封默认字段（type=text_delta）后走 applyFrame
const run = (steps: Array<Partial<Envelope> | { user: string }>): Row[] =>
  steps.reduce<Row[]>(
    (rows, s) => ('user' in s
      ? pushUser(rows, s.user)
      : applyFrame(rows, { seq: 1, v: 1, type: 'text_delta', ...s } as Envelope)),
    [],
  );

describe('foldTurns', () => {
  it('用户输入开新轮；工具/思考进工作段；正文进轮尾', () => {
    const rows = run([
      { user: '帮我改' },
      { type: 'thinking', thinking: '看看' },
      { type: 'tool_start', tool_name: 'Read', tool_use_id: 'u1' },
      { type: 'tool_done', tool_use_id: 'u1', tool_result: 'ok' },
      { text: '改好了' },
    ]);
    const units = foldTurns(rows);
    expect(units).toHaveLength(2);
    const turn = units[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(turn.work.toolCount).toBe(1);
    expect(turn.work.reasoningCount).toBe(1);
    expect(turn.visibleRows.map((r) => r.kind)).toEqual(['reasoning', 'tool']);
    expect(turn.tail.map((r) => r.kind)).toEqual(['assistant_text']);
  });

  it('状态行不进折叠单元（由时间线原地渲染）', () => {
    const rows = run([
      { user: 'hi' },
      { type: 'tool_start', tool_name: 'Bash', tool_use_id: 'u1' },
      { type: 'progress', status_key: 'rate-limit', text: '等 30s' },
    ]);
    const turn = foldTurns(rows)[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(turn.visibleRows.map((r) => r.kind)).toEqual(['tool']);
    expect(turn.rows.some((r) => r.kind === 'status')).toBe(false);
  });

  it('空思考被过滤，非空思考保留', () => {
    const rows = run([
      { user: 'hi' },
      { type: 'thinking', thinking: '  ' },
      { type: 'thinking', thinking: '实质' },
    ]);
    const turn = foldTurns(rows)[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(turn.visibleRows).toHaveLength(1);
  });

  it('交互卡（审批/确认）进轮尾按到达顺序', () => {
    const rows = run([
      { user: 'hi' },
      { type: 'permission_request', request_id: 'p1', tool_name: 'Bash' },
      { type: 'ask_user', request_id: 'r1', question: '继续？', payload: { kind: 'confirm', mode: 'confirm' } },
      { text: '好' },
    ]);
    const turn = foldTurns(rows)[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(turn.tail.map((r) => r.kind)).toEqual(['permission', 'confirm', 'assistant_text']);
  });

  it('queue_run 用户输入开新轮；steer 通知归当前轮尾', () => {
    const rows = run([
      { user: 'v1' },
      { type: 'steer', text: '编辑器写回通知' },
      { text: 'ok' },
      { type: 'queue_run', text: '接着跑测试' },
      { text: 'done' },
    ]);
    const units = foldTurns(rows);
    // v1 轮 → queue_run 消费是用户可见输入开新轮（含中间的 steer 通知）
    expect(units.map((u) => u.type)).toEqual(['user', 'turn', 'user', 'turn']);
    expect(units[2]).toMatchObject({ type: 'user', text: '接着跑测试' });
  });

  it('运行中工作段统计 runningTools', () => {
    const rows = run([
      { user: 'hi' },
      { type: 'tool_start', tool_name: 'Bash', tool_use_id: 'u1' },
      { type: 'tool_start', tool_name: 'Edit', tool_use_id: 'u2' },
      { type: 'tool_done', tool_use_id: 'u2', tool_result: 'ok' },
    ]);
    const turn = foldTurns(rows)[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(turn.work.runningTools).toBe(1);
    expect(turn.work.toolCount).toBe(2);
  });

  it('异常收尾（出错/中断）标记 aborted；正常收尾不标记', () => {
    const errRows = run([
      { user: 'hi' },
      { type: 'tool_start', tool_name: 'Bash', tool_use_id: 'u1' },
      { type: 'error', error: 'terminated' },
    ]);
    const units = foldTurns(errRows);
    expect(units).toHaveLength(2);
    const errTurn = units[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(errTurn.aborted).toBe(true);

    const stopRows = run([
      { user: 'hi' },
      { type: 'text', text: '跑一半' },
      { type: 'interrupted', text: '已停止' },
    ]);
    const stopTurn = foldTurns(stopRows)[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(stopTurn.aborted).toBe(true);

    const okRows = run([
      { user: 'hi' },
      { type: 'text', text: '完成' },
    ]);
    const okTurn = foldTurns(okRows)[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(okTurn.aborted).toBe(false);
  });

  it('用户行后立即建空轮单元（eager）：运行计时首帧前可见', () => {
    const rows = run([{ user: '刚发送' }]);
    const units = foldTurns(rows);
    expect(units.map((u) => u.type)).toEqual(['user', 'turn']);
    const turn = units[1] as Extract<TurnUnit, { type: 'turn' }>;
    expect(turn.rows).toHaveLength(0);
    expect(turn.aborted).toBe(false);
  });
});
