import { describe, expect, it } from 'vitest';
import { historyToRows } from './historyToRows';

describe('historyToRows', () => {
  it('跳过元消息：is_meta 标记的与旧版引擎未打标记的恢复提示', () => {
    const rows = historyToRows([
      { role: 'user', content: [{ type: 'text', text: '帮我看看' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '想了想' }] },
      { role: 'user', content: [{ type: 'text', text: 'Your previous reply contained only internal reasoning with no visible response. Re-state...' }] },
      { role: 'user', content: 'Output token limit hit. Resume directly — no apology, no recap.' },
      { role: 'user', content: [{ type: 'text', text: '继续' }], is_meta: true },
      { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
    ]);
    expect(rows.filter((r) => r.kind === 'user').map((r) => (r as { text: string }).text)).toEqual(['帮我看看']);
    expect(rows.some((r) => r.kind === 'assistant_text')).toBe(true);
  });

  it('用户自己写的同类英文不受影响（只认整条消息开头）', () => {
    const rows = historyToRows([{ role: 'user', content: [{ type: 'text', text: '为什么会出现 Your previous reply contained only internal reasoning？' }] }]);
    expect(rows).toHaveLength(1);
  });
});
