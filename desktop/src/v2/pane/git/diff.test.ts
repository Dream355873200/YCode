import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, splitPath } from './diff';

const SAMPLE = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@ export function a() {',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '+const z = 4;',
  ' return x;',
  '\\ No newline at end of file',
  '@@ -10,2 +11,2 @@',
  ' tail',
  '-old',
  '+new',
  '',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('解析 hunk、行号与增删计数', () => {
    const d = parseUnifiedDiff(SAMPLE);
    expect(d.added).toBe(3);
    expect(d.deleted).toBe(2);
    expect(d.binary).toBe(false);
    expect(d.lines[0]).toEqual({ type: 'hunk', text: 'export function a() {' });
    expect(d.lines[1]).toEqual({ type: 'ctx', text: 'const x = 1;', oldNo: 1, newNo: 1 });
    expect(d.lines[2]).toEqual({ type: 'del', text: 'const y = 2;', oldNo: 2 });
    expect(d.lines[3]).toEqual({ type: 'add', text: 'const y = 3;', newNo: 2 });
    expect(d.lines[4]).toEqual({ type: 'add', text: 'const z = 4;', newNo: 3 });
    expect(d.lines[5]).toEqual({ type: 'ctx', text: 'return x;', oldNo: 3, newNo: 4 });
    const second = d.lines.findIndex((l, i) => i > 0 && l.type === 'hunk');
    expect(d.lines[second + 1]).toEqual({ type: 'ctx', text: 'tail', oldNo: 10, newNo: 11 });
    expect(d.lines.at(-1)).toEqual({ type: 'add', text: 'new', newNo: 12 });
  });

  it('识别二进制文件，忽略文件头', () => {
    const d = parseUnifiedDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n');
    expect(d.binary).toBe(true);
    expect(d.lines).toEqual([]);
  });

  it('新文件（/dev/null）全部为新增', () => {
    const d = parseUnifiedDiff('--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+# 标题\n+正文\n');
    expect(d.added).toBe(2);
    expect(d.lines.filter((l) => l.type === 'add').map((l) => l.newNo)).toEqual([1, 2]);
  });

  it('splitPath', () => {
    expect(splitPath('src/app/x.ts')).toEqual({ name: 'x.ts', dir: 'src/app' });
    expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' });
  });
});
