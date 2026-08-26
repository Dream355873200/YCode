// 轻量 Markdown 渲染器：SPEC / Agent 计划页签 / 聊天总结气泡共用。
// 代码块经 highlight.js 着色（语言自动检测，Dart/Go/YAML/JSON 均可）。
import hljs from 'highlight.js/lib/common';
import dart from 'highlight.js/lib/languages/dart';
import go from 'highlight.js/lib/languages/go';
import yaml from 'highlight.js/lib/languages/yaml';

// common bundle 不含 dart/go/yaml（非内置热门语言），手动注册
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('go', go);
hljs.registerLanguage('yaml', yaml);

export function esc(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 高亮一段代码：识别语言则用之，识别不了 hljs 会标 plaintext
export function highlightCode(code, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* fallthrough */ }
  }
  try { return hljs.highlightAuto(code).value; } catch { return esc(code); }
}

function inline(t) {
  return t
    .replace(/`([^`]+)`/g, (_m, c) => '<code>' + c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/^（.+?）$/, '<span class="md-dim">$1</span>');
}

// 表格行解析：| a | b | → [a, b]（去掉首尾空分隔符）
const tableRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

// renderMD: 支持 #/##/### 标题、无序/有序列表、``` 代码块（高亮）、表格、
// 图片语法（渲染为占位块——本地图片由宿主组件经 dataURL 渲染真图）、段落
export function renderMD(src) {
  if (!src) return '';
  const lines = src.split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    // ``` 围栏代码块：收集到闭合围栏（或结尾），整体高亮
    if (/^\s*```/.test(l)) {
      closeList();
      const lang = l.trim().slice(3).trim().toLowerCase();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
      out.push('<pre class="md-code"><code>' + highlightCode(buf.join('\n'), lang) + '</code></pre>');
      continue;
    }
    // 表格：| a | b | 且下一行是 |---|---| 分隔行
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      closeList();
      const head = tableRow(l);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(tableRow(lines[i])); i++; }
      i--; // 回退让外层 for 的 i++ 生效
      let t = '<table class="md-table"><thead><tr>';
      for (const h of head) t += '<th>' + inline(esc(h)) + '</th>';
      t += '</tr></thead><tbody>';
      for (const r of rows) {
        t += '<tr>';
        for (let c = 0; c < head.length; c++) t += '<td>' + inline(esc(r[c] || '')) + '</td>';
        t += '</tr>';
      }
      t += '</tbody></table>';
      out.push(t);
      continue;
    }
    // 图片：![alt](path) → 占位块（真图由宿主组件的 shots 区展示，
    // md 渲染器无法安全引用本地文件路径）
    const img = l.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (img) {
      closeList();
      out.push('<div class="md-img-note">📸 ' + esc(img[1] || '截图') + '</div>');
      continue;
    }
    if (/^### /.test(l)) { closeList(); out.push('<h3>' + inline(esc(l.slice(4))) + '</h3>'); }
    else if (/^## /.test(l)) { closeList(); out.push('<h2>' + inline(esc(l.slice(3))) + '</h2>'); }
    else if (/^# /.test(l)) { closeList(); out.push('<h1>' + inline(esc(l.slice(2))) + '</h1>'); }
    else if (/^- /.test(l)) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(esc(l.slice(2))) + '</li>'); }
    else if (/^\d+\. /.test(l)) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(esc(l.replace(/^\d+\. /, ''))) + '</li>'); }
    else if (/^\s*$/.test(l)) { closeList(); }
    else { closeList(); out.push('<p>' + inline(esc(l)) + '</p>'); }
  }
  closeList();
  return out.join('');
}
