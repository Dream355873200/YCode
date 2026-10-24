// diff — 统一 diff（git diff 输出）→ 渲染行：hunk 头 / 上下文 / 新增 / 删除，带新旧行号。
export interface DiffLine {
  type: 'hunk' | 'ctx' | 'add' | 'del';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface ParsedDiff {
  lines: DiffLine[];
  added: number;
  deleted: number;
  binary: boolean;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parseUnifiedDiff(text: string): ParsedDiff {
  const lines: DiffLine[] = [];
  let added = 0;
  let deleted = 0;
  let binary = false;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) { binary = true; continue; }
    const h = HUNK_RE.exec(raw);
    if (h) {
      oldNo = Number(h[1]);
      newNo = Number(h[2]);
      inHunk = true;
      lines.push({ type: 'hunk', text: (h[3] ?? '').trim() });
      continue;
    }
    if (!inHunk) continue; // 文件头（diff --git / index / --- / +++）
    if (raw.startsWith('\\') || raw === '') continue; // \ No newline at end of file；git 的上下文行恒以空格开头
    if (raw.startsWith('+')) {
      lines.push({ type: 'add', text: raw.slice(1), newNo: newNo++ });
      added++;
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'del', text: raw.slice(1), oldNo: oldNo++ });
      deleted++;
    } else if (raw.startsWith(' ')) {
      lines.push({ type: 'ctx', text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return { lines, added, deleted, binary };
}

/** 路径拆成文件名与目录（列表行：文件名醒目、目录淡）。 */
export function splitPath(p: string): { name: string; dir: string } {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i < 0 ? { name: s, dir: '' } : { name: s.slice(i + 1), dir: s.slice(0, i) };
}
