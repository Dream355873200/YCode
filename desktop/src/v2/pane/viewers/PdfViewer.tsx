// PdfViewer — PDF 预览（pdfjs-dist，对齐 ZCode pdf-viewer 交互）：
// 单页渲染 + 页码导航（‹ n/N › + 页码输入）+ 缩放（±/适配宽度）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/lib/utils';

const MAX_PAGES = 200;

export default function PdfViewer({ b64 }: { b64: string }) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1); // 相对"适配宽度"的倍率
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(1); pageRef.current = page;
  const scaleRef = useRef(1); scaleRef.current = scale;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfRef = useRef<any>(null);
  const pdfjsRef = useRef<typeof import('pdfjs-dist') | null>(null);

  // 加载文档（一次）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const doc = await pdfjs.getDocument({ data: raw.slice() }).promise;
        if (!alive) return;
        pdfjsRef.current = pdfjs;
        pdfRef.current = doc as never;
        setNumPages(Math.min(doc.numPages, MAX_PAGES));
        setPage(1);
      } catch (e) {
        if (alive) setError(String((e as Error).message || e));
      }
    })();
    return () => { alive = false; };
  }, [b64]);

  // 渲染当前页（页码/缩放/容器宽度变化时重绘）
  const draw = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = pdfRef.current as any;
    const host = canvasHostRef.current;
    if (!doc || !host) return;
    try {
      const pg = await doc.getPage(pageRef.current);
      const base = pg.getViewport({ scale: 1 });
      const fit = Math.min((host.clientWidth - 24) / base.width, 1.5);
      const vp = pg.getViewport({ scale: Math.max(0.2, fit * scaleRef.current) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * devicePixelRatio);
      canvas.height = Math.floor(vp.height * devicePixelRatio);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await pg.render({ canvasContext: ctx, viewport: vp });
      host.replaceChildren(canvas);
    } catch { /* 翻页竞态：忽略本次绘制 */ }
  }, [page, scale]);

  useEffect(() => { draw(); }, [draw, numPages]);

  const go = (n: number) => {
    const clamped = Math.min(numPages || 1, Math.max(1, n));
    setPage(clamped);
    setPageInput(String(clamped));
  };

  if (error) return <div className="p-3 text-ui-xs text-destructive">{error}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-neutral-900">
      {/* 工具条：页码导航 + 缩放 */}
      <div className="flex h-8 shrink-0 items-center justify-center gap-1 border-b border-border/50 bg-panel/60 px-2">
        <Button variant="ghost" size="icon-sm" aria-label="上一页" disabled={page <= 1}
          className="size-6 text-neutral-300 hover:bg-neutral-700 hover:text-white" onClick={() => go(page - 1)}>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <input value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') go(parseInt(pageInput, 10) || 1); }}
          className="h-5 w-9 rounded border border-neutral-600 bg-neutral-800 text-center text-ui-2xs text-neutral-200 outline-none" />
        <span className="text-ui-2xs text-neutral-400">/ {numPages || '…'}</span>
        <Button variant="ghost" size="icon-sm" aria-label="下一页" disabled={page >= numPages}
          className="size-6 text-neutral-300 hover:bg-neutral-700 hover:text-white" onClick={() => go(page + 1)}>
          <ChevronRightIcon className="size-4" />
        </Button>
        <span className="mx-1 h-4 w-px bg-neutral-700" />
        <Button variant="ghost" size="icon-sm" aria-label="缩小"
          className="size-6 text-neutral-300 hover:bg-neutral-700 hover:text-white"
          onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)))}>
          <ZoomOutIcon className="size-4" />
        </Button>
        <span className="w-9 text-center text-ui-2xs text-neutral-400">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="icon-sm" aria-label="放大"
          className={cn('size-6 text-neutral-300 hover:bg-neutral-700 hover:text-white')}
          onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(2)))}>
          <ZoomInIcon className="size-4" />
        </Button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-auto">
        <div ref={canvasHostRef} className="mx-auto flex justify-center py-3" />
      </div>
    </div>
  );
}
