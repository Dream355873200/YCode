// highlight.js 统一入口：common 捆绑包 + 手动注册的热门缺失语言。
// lib/markdown.js（旧 renderMD）与本目录的 Markdown 组件共用这份注册。
import hljs from 'highlight.js/lib/common';
import dart from 'highlight.js/lib/languages/dart';
import go from 'highlight.js/lib/languages/go';
import yaml from 'highlight.js/lib/languages/yaml';

// common bundle 不含 dart/go/yaml（非内置热门语言）
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('go', go);
hljs.registerLanguage('yaml', yaml);

export function escapeHtml(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 高亮一段代码：识别语言则用之，识别不了 hljs 会标 plaintext。 */
export function highlightCode(code: string, lang?: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch { /* fallthrough */ }
  }
  try { return hljs.highlightAuto(code).value; } catch { return escapeHtml(code); }
}

export default hljs;
