// FileViewer — 右栏文件查看（单文件，tab 由 SidePane 顶级管理）：
//   代码/文本 —— 语法高亮只读视图 ⇄ textarea 编辑（Ctrl+S 落盘并 POST
//                /notify/user-edit 通知 AI 重读，防 AI 基于陈旧内容覆盖）
//   图片      —— dataUrl 预览
//   Markdown —— 预览（renderMD）⇄ 源码
// 刷新钮重读磁盘（AI 改文件后看最新版）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { EyeIcon, PencilIcon, RefreshCwIcon, SaveIcon } from 'lucide-react';
import { highlightLines, langOf } from '../../lib/codediff.js';
import { renderMD } from '../../lib/markdown.js';
import { useApp } from '../app/appState';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif)$/i;
const MD_RE = /\.(md|markdown|mdx)$/i;
export const fileBasename = (p: string) => p.split(/[\\/]/).pop() || p;

interface ReadResult { ok: boolean; content?: string; error?: string }
interface ImageResult { ok: boolean; dataUrl?: string; error?: string }

export default function FileView({ file }: { file: string }) {
  const { sid, bumpViewerTick } = useApp();
  const image = IMAGE_RE.test(file);
  const md = MD_RE.test(file);
  const [img, setImg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [mdPreview, setMdPreview] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null); setSaved(false);
    if (image) {
      window.amc.fs.readImage(file).then((r) => (r as ImageResult)).then((r: ImageResult) => {
        if (r.ok) setImg(r.dataUrl ?? null); else setError(r.error || '读取失败');
      }).catch((e: unknown) => setError(String(e)));
      return;
    }
    window.amc.fs.readFile(file).then((r) => (r as ReadResult)).then((r: ReadResult) => {
      if (r.ok) { setCode(r.content ?? ''); setDraft(r.content ?? ''); }
      else setError(r.error || '读取失败');
    }).catch((e: unknown) => setError(String(e)));
  }, [file, image]);

  useEffect(() => {
    setEditing(false); setDirty(false); setMdPreview(true);
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!dirty) return;
    const r = await window.amc.fs.writeFile(file, draft) as { ok: boolean; error?: string };
    if (!r.ok) { setError(r.error || '保存失败'); return; }
    setCode(draft); setDirty(false); setSaved(true); setEditing(false);
    bumpViewerTick();
    if (sid) window.amc.engine.post('/notify/user-edit', { session_id: sid, file }).catch(() => {});
  }, [file, draft, dirty, sid, bumpViewerTick]);

  // 编辑态 Ctrl+S 保存 / Esc 放弃
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.key === 'Escape' && editing && !dirty) setEditing(false);
  };

  const lang = langOf(file);
  const hl: string[] = code !== null && !editing
    ? highlightLines(code.split('\n').slice(-2000).join('\n'), lang) as string[]
    : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKey}>
      {/* 工具条 */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <span className="min-w-0 flex-1 truncate text-ui-2xs text-foreground-subtlest">{file}</span>
        {md && !editing && (
          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-ui-2xs text-foreground-subtle hover:text-foreground"
            onClick={() => setMdPreview((v) => !v)}>
            {mdPreview ? <><PencilIcon className="size-3" /> 源码</> : <><EyeIcon className="size-3" /> 预览</>}
          </Button>
        )}
        {!image && !editing && (
          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-ui-2xs text-foreground-subtle hover:text-foreground"
            onClick={() => { setDraft(code ?? ''); setEditing(true); }}>
            <PencilIcon className="size-3" /> 编辑
          </Button>
        )}
        {!image && editing && (
          <Button variant="ghost" size="sm" className={cn('h-5 px-1.5 text-ui-2xs', dirty ? 'text-brand hover:text-brand' : 'text-foreground-subtlest')}
            onClick={() => save()} disabled={!dirty}>
            <SaveIcon className="size-3" /> {dirty ? '保存 •' : '保存'}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label="重读"
          className="shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => load()}>
          <RefreshCwIcon />
        </Button>
      </div>
      {saved && <div className="shrink-0 px-3 py-1 text-ui-2xs text-success">已保存 · 已通知 AI 重读此文件</div>}
      {error && <div className="shrink-0 px-3 py-1 text-ui-2xs text-destructive">{error}</div>}

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {image ? (
          img
            ? <div className="flex h-full items-center justify-center p-3"><img src={img} alt={fileBasename(file)} className="max-h-full max-w-full object-contain" /></div>
            : <div className="p-4 text-ui-xs text-foreground-subtlest">加载中…</div>
        ) : editing ? (
          <textarea value={draft} spellCheck={false} autoFocus
            onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
            className="h-full min-h-0 w-full resize-none bg-input p-3 font-mono text-ui-xs leading-5 text-foreground outline-none" />
        ) : md && mdPreview ? (
          <div className="max-w-none p-3 text-ui-sm text-foreground [&_a]:text-brand [&_code]:rounded [&_code]:bg-input [&_code]:px-1 [&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-ui-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-ui-base [&_h2]:font-semibold [&_h3]:font-semibold [&_h3]:mt-2 [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-input [&_pre]:p-2 [&_table]:w-full"
            dangerouslySetInnerHTML={{ __html: renderMD(code ?? '') }} />
        ) : (
          <div className="min-h-full py-2 font-mono text-ui-xs leading-5">
            {hl.map((h, i) => (
              <div key={i} className="flex hover:bg-hover/50">
                <span className="w-10 shrink-0 select-none pr-2 text-right text-ui-2xs text-foreground-subtlest">{i + 1}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-3 text-foreground"
                  dangerouslySetInnerHTML={{ __html: h || '&nbsp;' }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
