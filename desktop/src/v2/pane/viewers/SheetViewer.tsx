// SheetViewer — 电子表格预览（SheetJS）：工作表页签 + 前 N 行×M 列网格。
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

const MAX_ROWS = 200;
const MAX_COLS = 30;

export default function SheetViewer({ b64, file }: { b64: string; file: string }) {
  const [names, setNames] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [grid, setGrid] = useState<{ rows: string[][]; total: number } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const wb = XLSX.read(raw, { type: 'array' });
      setNames(wb.SheetNames);
      const ws = wb.Sheets[wb.SheetNames[0] ?? ''];
      if (!ws) throw new Error('空工作簿');
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false });
      setGrid({ rows: rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((c) => String(c ?? ''))), total: rows.length });
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [b64]);

  useEffect(() => { load(); }, [load]);

  const pick = useMemo(() => async (idx: number) => {
    setActive(idx);
    try {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const wb = XLSX.read(raw, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[idx] ?? ''];
      if (!ws) throw new Error('空工作表');
      const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false });
      setGrid({ rows: rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).map((c) => String(c ?? ''))), total: rows.length });
    } catch (e) {
      setError(String((e as Error).message || e));
    }
  }, [b64]);

  if (error) return <div className="p-3 text-ui-xs text-destructive">{error}</div>;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {names.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/50 px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {names.map((n, i) => (
            <button key={n} type="button"
              className={`shrink-0 rounded-md px-2 py-0.5 text-ui-2xs ${i === active ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover'}`}
              onClick={() => pick(i)}>
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!grid ? <div className="text-ui-xs text-foreground-subtlest">解析中…</div> : (
          <table className="border-collapse text-ui-2xs">
            <tbody>
              {grid.rows.map((row, r) => (
                <tr key={r} className={r === 0 ? 'bg-selected/60 font-medium' : 'hover:bg-hover/40'}>
                  <td className="sticky left-0 select-none border border-border/40 bg-panel px-1.5 py-0.5 text-foreground-subtlest">{r + 1}</td>
                  {row.map((cell, c) => (
                    <td key={c} className="max-w-56 truncate border border-border/40 px-2 py-0.5 text-foreground">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {grid && grid.total > MAX_ROWS && (
          <div className="p-2 text-ui-2xs text-foreground-subtlest">仅预览前 {MAX_ROWS} 行（共 {grid.total} 行）——{file}</div>
        )}
      </div>
    </div>
  );
}
