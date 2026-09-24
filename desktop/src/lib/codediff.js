// codediff.js — 代码高亮 + 行级 diff（StagePanel 直播 / CodeEditor 编辑器共用）。
import { highlightCode, textCache } from './markdown.js';

// 按文件扩展名给 highlight.js 挑语言
export const LANG_BY_EXT = {
  dart: 'dart', go: 'go', yaml: 'yaml', yml: 'yaml', json: 'json',
  md: 'markdown', js: 'javascript', ts: 'typescript', tsx: 'typescript',
  jsx: 'javascript', html: 'xml', xml: 'xml', css: 'css', sh: 'bash',
  bat: 'bash', cmd: 'bash', ps1: 'bash', sql: 'sql', java: 'java',
  kt: 'kotlin', swift: 'swift', py: 'python', toml: 'ini', cfg: 'ini',
};
export const langOf = (file) => LANG_BY_EXT[(file || '').split('.').pop().toLowerCase()];

// 按行独立高亮（行号内联、跨行 token 退化——Dart/Go 代码行内 token 居多，
// 跨行字符串/注释会退化成纯文本，可接受）
export function highlightLines(code, lang) {
  return code.split('\n').map((l) => highlightCode(l || ' ', lang));
}

// ---- 行级 diff（开发直播/编辑器：AI 改动后新增绿底 / 删除红底叠加在语法高亮上）----
// 简单 LCS（最长公共子序列）按行对比 —— 文件规模（几百行）下完全够用。
// 返回 [{ type: 'same'|'add'|'del', text, oldNo, newNo }]（按输入缓存，调用方勿改返回值）
/** @param {string} oldText @param {string} newText @returns {Array<{type: 'same'|'add'|'del', text: string, oldNo?: number, newNo?: number}>} */
export function diffLines(oldText, newText) {
  return diffCached(`${oldText || ''}\0${newText || ''}`, oldText, newText);
}
const diffCached = textCache(200, diffRaw);

function diffRaw(oldText, newText) {
  const a = (oldText || '').split('\n');
  const b = (newText || '').split('\n');
  const n = a.length, m = b.length;
  // LCS 表（限制规模防卡顿：超大文件退化为整段替换）
  if (n * m > 4_000_000) {
    return [
      ...a.map((t, i) => ({ type: 'del', text: t, oldNo: i + 1 })),
      ...b.map((t, i) => ({ type: 'add', text: t, newNo: i + 1 })),
    ];
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i], oldNo: i + 1, newNo: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i], oldNo: i + 1 }); i++; }
    else { out.push({ type: 'add', text: b[j], newNo: j + 1 }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i], oldNo: i + 1 }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j], newNo: j + 1 }); j++; }
  return out;
}
