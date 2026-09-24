// DocxViewer — Word 文档预览（mammoth：docx → HTML）
import { useCallback, useEffect, useState } from 'react';
import mammoth from 'mammoth/mammoth.browser';

export default function DocxViewer({ b64 }: { b64: string }) {
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const r = await mammoth.convertToHtml({ arrayBuffer: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) });
      setHtml(r.value);
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [b64]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="p-3 text-ui-xs text-destructive">{error}</div>;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div
        className="mx-auto max-w-3xl text-ui-sm leading-6 text-foreground [&_a]:text-brand [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-ui-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-ui-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_img]:max-w-full [&_li]:ml-5 [&_li]:list-disc [&_ol]:my-2 [&_ol]:list-decimal [&_p]:my-2 [&_strong]:font-semibold [&_table]:w-full [&_td]:border [&_td]:border-border/40 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border/40 [&_th]:bg-selected [&_th]:px-2 [&_th]:py-1"
        dangerouslySetInnerHTML={{ __html: html || '<p>空文档</p>' }}
      />
    </div>
  );
}
