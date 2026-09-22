import { describe, it, expect, beforeEach } from 'vitest';
import { applyFrame, resolvePermission, resolveAsk, resetRowIds, type Row } from './rows';
import type { Envelope } from '../../protocol';

const f = (p: Partial<Envelope>): Envelope => ({ seq: 1, v: 1, type: 'text_delta', ...p });
const kinds = (rows: Row[]) => rows.map((r) => r.kind);

beforeEach(() => resetRowIds());

describe('applyFrame 文本与思考', () => {
  it('text_delta 追加到相邻 assistant_text，无则新建', () => {
    let rows = applyFrame([], f({ text: '你好' }));
    rows = applyFrame(rows, f({ text: '，世界' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'assistant_text', text: '你好，世界' });
  });

  it('thinking 追加到相邻 reasoning；文本打断后思考另起一行', () => {
    let rows = applyFrame([], f({ type: 'thinking', thinking: '想' }));
    rows = applyFrame(rows, f({ type: 'thinking', thinking: '一下' }));
    rows = applyFrame(rows, f({ text: '答' }));
    rows = applyFrame(rows, f({ type: 'thinking', thinking: '再想' }));
    expect(kinds(rows)).toEqual(['reasoning', 'assistant_text', 'reasoning']);
    expect(rows[0]).toMatchObject({ text: '想一下' });
  });

  it('steer 剥 reminder 标记后入提示行（引擎内部通知，非用户气泡）', () => {
    const rows = applyFrame([], f({ type: 'steer', text: '<system-reminder source="steer">\n先跑测试\n</system-reminder>' }));
    expect(rows[0]).toMatchObject({ kind: 'notice', text: '先跑测试', tone: 'info' });
  });

  it('queue_run 用户输入开用户行；降级的 reminder 文本入提示行', () => {
    const user = applyFrame([], f({ type: 'queue_run', text: '顺便加个 dark mode' }));
    expect(user[0]).toMatchObject({ kind: 'user', text: '顺便加个 dark mode' });
    const sys = applyFrame([], f({ type: 'queue_run', text: '<system-reminder source="steer">\n设备已释放\n</system-reminder>' }));
    expect(sys[0]).toMatchObject({ kind: 'notice', text: '设备已释放', tone: 'info' });
  });
});

describe('applyFrame 工具配对', () => {
  it('tool_start 新建 running 行，tool_done 按 tool_use_id 原地配对', () => {
    let rows = applyFrame([], f({ type: 'tool_start', tool_name: 'Edit', tool_use_id: 'u1', tool_input: { file_path: 'a.dart' } }));
    rows = applyFrame(rows, f({ type: 'tool_start', tool_name: 'Bash', tool_use_id: 'u2' }));
    rows = applyFrame(rows, f({ text: 'x' })); // 中间隔了正文也不影响配对
    rows = applyFrame(rows, f({ type: 'tool_done', tool_use_id: 'u1', tool_result: '已替换 2 处匹配 (a.dart)' }));
    expect(kinds(rows)).toEqual(['tool', 'tool', 'assistant_text']);
    const t = rows[0];
    expect(t).toMatchObject({ kind: 'tool', state: 'ok', result: '已替换 2 处匹配 (a.dart)' });
    expect((rows[1] as Extract<Row, { kind: 'tool' }>).state).toBe('running');
  });

  it('结果含错误字样 → err 态', () => {
    let rows = applyFrame([], f({ type: 'tool_start', tool_name: 'Bash', tool_use_id: 'u1' }));
    rows = applyFrame(rows, f({ type: 'tool_done', tool_use_id: 'u1', tool_result: '退出码非零: 1' }));
    expect((rows[0] as Extract<Row, { kind: 'tool' }>).state).toBe('err');
  });
});

describe('applyFrame 交互原语', () => {
  it('结构化 payload → confirm 卡', () => {
    const rows = applyFrame([], f({
      type: 'ask_user', request_id: 'r1', question: '选方案',
      payload: { kind: 'confirm', mode: 'single', choices: ['A', 'B'], detail: '细节' },
    }));
    expect(rows[0]).toMatchObject({
      kind: 'confirm', requestId: 'r1', question: '选方案',
      choices: ['A', 'B'], detail: '细节',
    });
  });

  it('旧 [confirm] 文本前缀协议兜底解析', () => {
    const rows = applyFrame([], f({
      type: 'ask_user', request_id: 'r1',
      question: '[confirm]{"kind":"confirm","mode":"confirm"}\n确认删除？',
    }));
    expect(rows[0]).toMatchObject({ kind: 'confirm', question: '确认删除？' });
  });

  it('无载荷 → ask 卡', () => {
    const rows = applyFrame([], f({ type: 'ask_user', request_id: 'r2', question: '几点了' }));
    expect(rows[0]).toMatchObject({ kind: 'ask', question: '几点了' });
  });

  it('payload.kind=ask 强制走问答卡', () => {
    const rows = applyFrame([], f({
      type: 'ask_user', request_id: 'r3', question: '输入',
      payload: { kind: 'ask' },
    }));
    expect(rows[0]?.kind).toBe('ask');
  });
});

describe('applyFrame 状态行与通知', () => {
  it('status_key 原地替换；text 空清除', () => {
    let rows = applyFrame([], f({ type: 'progress', status_key: 'rate-limit', text: '等 30s' }));
    rows = applyFrame(rows, f({ type: 'progress', status_key: 'rate-limit', text: '等 15s' }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'status', key: 'rate-limit', text: '等 15s' });
    rows = applyFrame(rows, f({ type: 'progress', status_key: 'rate-limit', text: '' }));
    expect(rows).toHaveLength(0);
  });

  it('无 status_key 的 progress 不进权威流', () => {
    const rows = applyFrame([], f({ type: 'progress', text: '随便说说' }));
    expect(rows).toHaveLength(0);
  });

  it('interrupted 与 error 分离为不同 tone', () => {
    let rows = applyFrame([], f({ type: 'interrupted', text: '用户中断' }));
    rows = applyFrame(rows, f({ type: 'error', error: 'boom' }));
    expect(rows[0]).toMatchObject({ kind: 'notice', tone: 'stopped' });
    expect(rows[1]).toMatchObject({ kind: 'notice', tone: 'error' });
  });
});

describe('回写', () => {
  it('resolvePermission 回写审批结果', () => {
    let rows = applyFrame([], f({ type: 'permission_request', request_id: 'p1', tool_name: 'Bash' }));
    rows = resolvePermission(rows, 'p1', true);
    expect((rows[0] as Extract<Row, { kind: 'permission' }>).resolved).toBe('approved');
  });

  it('resolveAsk 回写答案并落定（批量确认逐张独立成行）', () => {
    // 引擎对批量确认逐张发卡（1-based index）；每张卡答完即落定，
    // 由引擎推进下一张——row 层无需聚合同批历史
    const ask = (requestId: string, index: number): Row[] => applyFrame([], f({
      type: 'ask_user', request_id: requestId, question: `Q${index}`,
      payload: { kind: 'confirm', mode: 'single', choices: [], index, total: 3 },
    }));

    for (const [rid, idx] of [['r1', 1], ['r2', 2], ['r3', 3]] as const) {
      const rows0 = ask(rid, idx);
      const rows = resolveAsk(rows0, (rows0[0] as Extract<Row, { kind: 'confirm' }>).id, `答案${idx}`);
      const c = rows[0] as Extract<Row, { kind: 'confirm' }>;
      expect(c.resolved).toBe(true);
      expect(c.answer).toBe(`答案${idx}`);
    }
  });
});

describe('纯函数性质', () => {
  it('同序列帧两次归约结果一致（流式/回放同路径）', () => {
    const frames = [
      f({ text: '开始' }),
      f({ type: 'tool_start', tool_name: 'Read', tool_use_id: 'u1' }),
      f({ type: 'tool_done', tool_use_id: 'u1', tool_result: 'ok' }),
      f({ text: '结束' }),
    ];
    resetRowIds();
    const a = frames.reduce(applyFrame, [] as Row[]);
    resetRowIds();
    const b = frames.reduce(applyFrame, [] as Row[]);
    expect(JSON.stringify(a.map(({ id, ...rest }) => rest)))
      .toBe(JSON.stringify(b.map(({ id, ...rest }) => rest)));
    // 且不修改输入数组
    const before = [...a];
    applyFrame(a, f({ text: 'x' }));
    expect(a).toEqual(before);
  });
});
