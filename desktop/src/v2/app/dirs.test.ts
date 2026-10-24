import { describe, expect, it } from 'vitest';
import { normalizeDir } from './dirs';

describe('normalizeDir', () => {
  it('分隔符 / 尾部分隔符 / 盘符大小写不影响结果', () => {
    expect(normalizeDir('e:/aaaa/t1/')).toBe(normalizeDir('E:\\AAAA\\T1'));
  });

  it('非盘符路径保留大小写', () => {
    expect(normalizeDir('/home/A/b/')).toBe('/home/A/b');
    expect(normalizeDir('/home/A')).not.toBe(normalizeDir('/home/a'));
  });
});
