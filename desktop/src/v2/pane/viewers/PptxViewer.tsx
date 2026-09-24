// PptxViewer — 演示文稿预览（JSZip 解包 OOXML，逐页提取标题与文本）
import { useCallback, useEffect, useState } from 'react';
import JSZip from 'jszip';

export default function PptxViewer({ b64 }: { b64: string }) {
  const [slides, setSlides] = useState<Array<{ n: number; title: string; lines: string[] }>>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const zip = await JSZip.loadAsync(raw);
      const slideFiles = Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b2) => (parseInt(a.match(/\d+/)![0] ?? '0', 10) - parseInt(b2.match(/\d+/)![0] ?? '0', 10)));
      const out: Array<{ n: number; title: string; lines: string[] }> = [];
      for (let i = 0; i < slideFiles.length; i++) {
        const name = slideFiles[i] as string;
        const entry = zip.files[name];
        if (!entry) continue;
        const xml = await entry.async('string');
        const texts = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)).map((m: RegExpMatchArray) => (m[1] ?? '').trim()).filter(Boolean);
        out.push({ n: i + 1, title: texts[0] || `第 ${i + 1} 页`, lines: texts.slice(1, 12) });
      }
      setSlides(out);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [b64]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="p-3 text-ui-xs text-destructive">{error}</div>;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      {!slides.length && !error && <div className="text-ui-xs text-foreground-subtlest">解析中…</div>}
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {slides.map((s) => (
          <div key={s.n} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded bg-selected px-1.5 py-0.5 text-ui-2xs text-foreground-subtle">{s.n}</span>
              <span className="truncate text-ui-sm font-semibold text-foreground">{s.title}</span>
            </div>
            <ul className="ml-4 list-disc text-ui-xs leading-5 text-foreground-subtle">
              {s.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
