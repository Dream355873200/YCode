// Markdown — 对话 / 面板共用的渲染器（Streamdown 栈，与 ZCode 同源）：
//   GFM 表格 + CJK 友好排版 + 流式未闭合标记修补；代码块走本地 highlight.js
//   （语言头 + 换行开关 + 复制）；链接分流：工作区文件 → 右栏文件 tab，
//   http(s) → 内置浏览器，其余协议不可点击。
// streaming=true 仅用于直播中的正文（mode=streaming + parseIncompleteMarkdown），
// 完成态一律 static（ZCode 生产教训：长消息常驻 streaming 会触发 React #185）。
import { Component, memo, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { CheckIcon, CopyIcon, WrapTextIcon } from 'lucide-react';
import { Streamdown, type CjkPlugin, type Components } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { highlightCode, escapeHtml } from '../../../lib/hljs';
import { useApp } from '../../app/appState';
import { cn } from '../lib/utils';

// CJK 删除线扩展默认 singleTilde：`~单波浪~` 也算删除线，与 GFM 标准冲突，
// 统一收紧为双波浪（ZCode 同款处理）。
const cjkPlugin: CjkPlugin = {
  ...cjk,
  remarkPluginsAfter: cjk.remarkPluginsAfter.map((p) => (Array.isArray(p)
    ? [p[0], { ...(typeof p[1] === 'object' && p[1] !== null ? p[1] : {}), singleTilde: false }]
    : p)) as CjkPlugin['remarkPluginsAfter'],
};

// ---------- 标题 / 列表 / 引用（ZCode markdown 字号刻度） ----------

const HEADING_CLS: Record<string, string> = {
  h1: 'mt-6 mb-4 text-ui-xl font-semibold',
  h2: 'mt-6 mb-4 text-ui-lg font-semibold',
  h3: 'mt-6 mb-4 text-ui-base font-semibold',
  h4: 'mt-6 mb-4 text-ui-base font-semibold',
  h5: 'mt-6 mb-4 text-ui-base font-medium',
  h6: 'mt-6 mb-4 text-ui-base font-normal',
};

function Heading({ tag, className, children, ...props }: {
  tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
} & ComponentProps<'h1'>) {
  const Tag = tag;
  return <Tag className={cn(HEADING_CLS[tag], className)} {...props}>{children}</Tag>;
}

// ---------- 代码块 ----------

function MdCodeBlock({ code, language, streaming }: { code: string; language: string; streaming: boolean }) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(0);
  // 直播中不做同步高亮（每 token 都会重排，先裸文本，落定再上色）
  const html = useMemo(() => (streaming ? escapeHtml(code) : highlightCode(code, language || undefined)), [code, language, streaming]);
  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <div data-streamdown="code-block" className="my-4 w-full overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex h-8 items-center gap-1 border-b border-border/60 pl-3 pr-1.5">
        <span className="min-w-0 truncate font-mono text-ui-sm lowercase text-foreground-subtlest">{language || 'text'}</span>
        <span className="ml-auto flex shrink-0 items-center">
          <button type="button" aria-label="切换换行" title="切换换行"
            className={cn('rounded-md p-1 text-foreground-subtle hover:bg-hover hover:text-foreground', wrap && 'bg-selected text-foreground')}
            onClick={() => setWrap(!wrap)}>
            <WrapTextIcon className="size-3.5" />
          </button>
          <button type="button" aria-label={copied ? '已复制' : '复制代码'} title={copied ? '已复制' : '复制代码'}
            className="rounded-md p-1 text-foreground-subtle hover:bg-hover hover:text-foreground"
            onClick={copy}>
            {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
          </button>
        </span>
      </div>
      <pre className={cn('scroll-fine overflow-x-auto p-3 font-mono text-ui-sm leading-[1.6] text-foreground', wrap && 'whitespace-pre-wrap break-words')}>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}

// ---------- 表格（工具条复制 + 横向滚动卡片） ----------

function tableText(table: HTMLTableElement | null): string {
  if (!table) return '';
  const rows = Array.from(table.querySelectorAll('tr'))
    .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()))
    .filter((r) => r.length > 0);
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')));
  return [norm[0]!, Array.from({ length: width }, () => '---'), ...norm.slice(1)]
    .map((r) => `| ${r.join(' | ')} |`).join('\n');
}

type MdNode = { node?: unknown };

function MdTable({ className, children, ...props }: ComponentProps<'table'> & MdNode) {
  const [copied, setCopied] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const copyTimer = useRef(0);
  const copy = (): void => {
    void navigator.clipboard.writeText(tableText(tableRef.current)).then(() => {
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };
  return (
    <div data-streamdown="table" className="my-4 flex min-w-0 flex-col gap-1">
      <div className="flex justify-end">
        <button type="button" aria-label={copied ? '已复制' : '复制表格'} title={copied ? '已复制' : '复制表格'}
          className="rounded-md p-1 text-foreground-subtlest hover:bg-hover hover:text-foreground"
          onClick={copy}>
          {copied ? <CheckIcon className="size-3.5 text-success" /> : <CopyIcon className="size-3.5" />}
        </button>
      </div>
      <div className="scroll-fine w-full overflow-x-auto rounded-xl border border-border">
        <table ref={tableRef} className={cn('w-max min-w-full border-separate border-spacing-0 text-ui-base', className)} {...props}>
          {children}
        </table>
      </div>
    </div>
  );
}

// ---------- 链接分流 ----------

// 有扩展名的引用按工作区文件处理；file:// 与 Windows 绝对路径直接认。
const WIN_PATH_RE = /^[a-zA-Z]:[\\/]/;
const EXT_RE = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;

function resolveFileLink(workspaceDir: string, href: string): string | null {
  const raw = href.trim().replace(/^["']|["']$/g, '');
  if (!raw) return null;
  const fileUri = /^file:\/\/\/(.*)$/i.exec(raw);
  if (fileUri) return decodeURIComponent(fileUri[1]!).replace(/\//g, '\\');
  if (WIN_PATH_RE.test(raw)) return raw.replace(/\//g, '\\');
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // 其它协议不是本地文件
  const rel = raw.replace(/^\.\//, '').split('#')[0]!.split('?')[0]!;
  if (!rel || !EXT_RE.test(rel) || !workspaceDir) return null;
  return `${workspaceDir.replace(/[\\/]+$/, '')}\\${rel.replace(/\//g, '\\')}`;
}

// ---------- 解析失败兜底（防白屏） ----------

class MarkdownBoundary extends Component<{ text: string; className?: string; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <div className={cn(this.props.className, 'whitespace-pre-wrap break-words')}>{this.props.text}</div>;
    }
    return this.props.children;
  }
}

// ---------- 组件组装 ----------

function useMarkdownComponents(streaming: boolean): Components {
  const { project, openViewerFile } = useApp();
  return useMemo(() => ({
    a: ({ children, className, href, node: _node }) => {
      const path = resolveFileLink(project?.dir ?? '', typeof href === 'string' ? href : '');
      const label = children;
      if (path) {
        return (
          <button type="button" className={cn('wrap-anywhere inline text-brand font-medium no-underline decoration-dotted underline-offset-4 hover:underline', className)}
            onClick={() => {
              void window.amc.fs.exists(path).then((r) => {
                if (r.ok) openViewerFile(path);
              }).catch(() => {});
            }}>
            {label}
          </button>
        );
      }
      if (typeof href === 'string' && /^https?:\/\//i.test(href)) {
        return (
          <button type="button" title={href}
            className={cn('wrap-anywhere inline text-brand font-medium no-underline decoration-dotted underline-offset-4 hover:underline', className)}
            onClick={() => { void window.amc.browser.open(href); }}>
            {label}
          </button>
        );
      }
      return <span className={cn('text-foreground-subtle', className)} title={typeof href === 'string' ? href : undefined}>{label}</span>;
    },
    strong: ({ className, node: _node, ...props }) => <strong className={cn('font-medium', className)} {...props} />,
    code: ({ children, className, node: _node, ...codeProps }) => {
      // Streamdown 的默认 pre 给块级代码注入 data-block 后原样传给这里
      if (!('data-block' in codeProps)) {
        return (
          <code className={cn('mx-0.5 rounded-md bg-tag/50 px-1.5 py-0.5 font-mono text-ui-sm', className)} {...codeProps}>
            {children}
          </code>
        );
      }
      const text = extractCodeText(children).replace(/\n+$/, '');
      const language = /(?:^|\s)language-([^\s]+)/.exec(className ?? '')?.[1] ?? '';
      return <MdCodeBlock code={text} language={language} streaming={streaming} />;
    },
    h1: (p) => <Heading tag="h1" {...p} />,
    h2: (p) => <Heading tag="h2" {...p} />,
    h3: (p) => <Heading tag="h3" {...p} />,
    h4: (p) => <Heading tag="h4" {...p} />,
    h5: (p) => <Heading tag="h5" {...p} />,
    h6: (p) => <Heading tag="h6" {...p} />,
    ul: ({ className, node: _node, ...props }) => (
      <ul className={cn('my-3 list-outside list-disc space-y-1.5 pl-5 marker:text-foreground-subtlest [&_ol]:my-1.5 [&_ul]:my-1.5', className)} {...props} />
    ),
    ol: ({ className, node: _node, ...props }) => (
      <ol className={cn('my-3 list-inside list-decimal space-y-1.5 pl-0 marker:text-foreground-subtlest [&_ol]:my-1.5 [&_ul]:my-1.5', className)} {...props} />
    ),
    li: ({ className, node: _node, ...props }) => (
      <li className={cn('pl-1 [&>p]:inline [&>p]:my-0', className)} {...props} />
    ),
    blockquote: ({ className, node: _node, ...props }) => (
      <blockquote className={cn('my-4 border-l-2 border-border pl-3 text-foreground-subtle [&_p]:my-0 [&_p+p]:mt-2', className)} {...props} />
    ),
    table: MdTable,
    thead: ({ className, node: _node, ...props }) => <thead className={className} {...props} />,
    tbody: ({ className, node: _node, ...props }) => <tbody className={className} {...props} />,
    tr: ({ className, node: _node, ...props }) => (
      <tr className={cn('transition-colors last:[&>td]:border-b-0 hover:bg-hover/20', className)} {...props} />
    ),
    th: ({ className, node: _node, ...props }) => (
      <th className={cn('min-w-16 max-w-md whitespace-normal break-words border-b border-border px-3 py-2 text-left font-normal text-foreground-subtlest', className)} {...props} />
    ),
    td: ({ className, node: _node, ...props }) => (
      <td className={cn('min-w-16 max-w-md whitespace-normal break-words border-b border-border px-3 py-2 align-top text-foreground', className)} {...props} />
    ),
  }), [project?.dir, openViewerFile, streaming]);
}

function extractCodeText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractCodeText).join('');
  if (typeof children === 'object' && children !== null && 'props' in children) {
    const props = (children as { props?: { children?: ReactNode } }).props;
    return extractCodeText(props?.children);
  }
  return '';
}

// ---------- 对外组件 ----------

export const Markdown = memo(function Markdown({ text, streaming = false, className }: {
  text: string;
  streaming?: boolean;
  className?: string;
}) {
  const components = useMarkdownComponents(streaming);
  return (
    <MarkdownBoundary text={text} className={className}>
      <Streamdown
        mode={streaming ? 'streaming' : 'static'}
        parseIncompleteMarkdown={streaming}
        animated={false}
        isAnimating={false}
        linkSafety={{ enabled: false }}
        lineNumbers={false}
        controls={{ table: false, code: { copy: false, download: false }, mermaid: false, image: false }}
        plugins={{ cjk: cjkPlugin }}
        components={components}
        className={cn('size-full text-ui-base leading-[1.75] text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
      >
        {text}
      </Streamdown>
    </MarkdownBoundary>
  );
});
