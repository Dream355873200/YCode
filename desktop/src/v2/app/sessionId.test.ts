import { describe, expect, it } from 'vitest';
import { dirHash, normalizeDir, projectSessionId } from './sessionId';

describe('projectSessionId', () => {
  it('目录名 + 8 位路径哈希', () => {
    expect(projectSessionId('E:\\aaaa\\test\\aa')).toMatch(/^amc-aa-[0-9a-f]{8}$/);
  });

  it('同名目录不同位置得到不同 ID', () => {
    expect(projectSessionId('E:\\work\\demo')).not.toBe(projectSessionId('D:\\other\\demo'));
  });

  it('分隔符 / 尾部分隔符 / 盘符大小写不影响结果', () => {
    const id = projectSessionId('E:\\aaaa\\t1');
    expect(projectSessionId('e:/aaaa/t1/')).toBe(id);
    expect(dirHash('E:\\AAAA\\T1\\')).toBe(dirHash('e:/aaaa/t1'));
  });

  it('非盘符路径保留大小写', () => {
    expect(normalizeDir('/home/A/b/')).toBe('/home/A/b');
    expect(dirHash('/home/A')).not.toBe(dirHash('/home/a'));
  });

  it('空目录返回 null', () => {
    expect(projectSessionId('')).toBeNull();
    expect(projectSessionId(undefined)).toBeNull();
  });
});
