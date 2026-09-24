// 测试报告面板（自 legacy TestReportTab 移植，槽位消费方）：
// 扫 .yume/test-reports/（test_report 工具落盘的 Markdown + frontmatter
// 结构化元数据），列表 → 详情（Markdown 正文 + 内嵌截图证据 + 放大）。
import { useEffect, useState } from 'react';
import { useApp } from '../app/appState';
import { renderMD } from '../../lib/markdown';

interface ReportMeta { [k: string]: string }
interface ReportItem { file: string; meta: ReportMeta }

const fs = window.amc.fs as unknown as {
  listDir(p: string): Promise<{ ok: boolean; files?: string[] }>;
  readFile(p: string): Promise<{ ok: boolean; content?: string }>;
  readImage(p: string): Promise<{ ok: boolean; dataUrl?: string }>;
};

// frontmatter 解析：--- key: value / 列表 ---（test_report 工具的固定格式）
function parseFM(md: string): { meta: ReportMeta; body: string } {
  const meta: ReportMeta = {};
  if (!md.startsWith('---')) return { meta, body: md };
  const end = md.indexOf('\n---', 3);
  if (end < 0) return { meta, body: md };
  for (const line of md.slice(4, end).split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m && m[1] && m[2] !== undefined) meta[m[1]] = m[2];
    else if (/^\s{2}-\s/.test(line) && meta.shots !== undefined) {
      meta.shots = meta.shots + '\n' + line.trim().replace(/^-\s*/, '');
    }
  }
  return { meta, body: md.slice(end + 4) };
}

// 报告正文图片路径归一化：剥 ../ 前缀（相对报告文件 → 相对项目根）
const normImg = (p: string): string => {
  let s = p;
  while (s.startsWith('../') || s.startsWith('..\\')) s = s.slice(3);
  return s;
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const cls = verdict === 'pass'
    ? 'bg-[var(--color-diff-added)] text-success'
    : verdict === 'fail'
      ? 'bg-[var(--color-diff-removed)] text-destructive'
      : 'bg-surface text-warning';
  const text = verdict === 'pass' ? '✅ PASS' : verdict === 'fail' ? '❌ FAIL' : '◐ 部分';
  return <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-ui-2xs font-medium ${cls}`}>{text}</span>;
}

export default function TestReportPanel() {
  const { project } = useApp();
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [openIdx, setOpenIdx] = useState(-1);
  const [detail, setDetail] = useState<{ file: string; meta: ReportMeta; body: string } | null>(null);
  const [inlineImgs, setInlineImgs] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    let alive = true;
    const load = async () => {
      const r = await fs.listDir(project.dir + '/.yume/test-reports').catch(() => null);
      if (!alive || !r || !r.ok) return;
      const files = (r.files || []).filter((f) => f.endsWith('.md'));
      // 预读 frontmatter（列表徽标：verdict / 统计）
      const metas = await Promise.all(files.slice(0, 30).map((f) =>
        fs.readFile(f)
          .then((fr) => (fr.ok ? parseFM(fr.content || '').meta : null))
          .catch(() => null),
      ));
      if (alive) setReports(files.map((f, i) => ({ file: f, meta: metas[i] || {} })));
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [project]);

  // 打开详情：读全文 → 正文里的 ![alt](path) 引用就地读图转 dataUrl
  useEffect(() => {
    const entry = reports[openIdx];
    if (openIdx < 0 || !entry?.file) { setDetail(null); setInlineImgs({}); return; }
    let alive = true;
    fs.readFile(entry.file).then((r) => {
      if (!alive || !r.ok) return;
      const { meta, body } = parseFM(r.content || '');
      setDetail({ file: entry.file, meta, body });
      // 相对路径按项目根解析；兼容绝对路径（旧报告）
      const paths = [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => normImg(m[1] || ''));
      const uniq = [...new Set(paths)];
      Promise.all(uniq.map((p) => {
        const abs = /^[E-Za-z]:[\\/]/.test(p) ? p : (project?.dir ? project.dir + '/' + p : p);
        return fs.readImage(abs)
          .then((ir) => (ir.ok && ir.dataUrl ? [p, ir.dataUrl] as const : null))
          .catch(() => null);
      })).then((pairs) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const pr of pairs) if (pr) map[pr[0]] = pr[1];
        setInlineImgs(map);
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [openIdx, reports, project]);

  // 渲染正文并把图片占位块替换为真图（data-img 原始路径过 normImg 归一化后对 key）
  const renderedBody = detail
    ? renderMD(detail.body).replace(/<div class="md-img-note" data-img="([^"]*)">[^<]*<\/div>/g,
      (whole, p: string) => inlineImgs[normImg(p)]
        ? `<img class="tr-shot-inline" src="${inlineImgs[normImg(p)]}" alt="${p}">`
        : whole)
    : '';

  if (!project) return null;

  if (openIdx >= 0 && detail) {
    const m = detail.meta;
    return (
      <div
        className="flex min-h-0 flex-1 flex-col"
        onClick={(e) => {
          // 事件委托：点正文里的内嵌截图 → 放大
          const t = e.target as HTMLElement;
          if (t.classList?.contains('tr-shot-inline')) setZoom((t as HTMLImageElement).src);
        }}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2.5 py-1.5">
          <button type="button" onClick={() => { setOpenIdx(-1); setZoom(null); }}
            className="text-ui-xs text-foreground-subtle hover:text-foreground">← 返回报告列表</button>
          <VerdictBadge verdict={m.verdict || ''} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [&_.tr-shot-inline]:max-w-full [&_.tr-shot-inline]:rounded-lg">
          <div className="v2-md" dangerouslySetInnerHTML={{ __html: renderedBody }} />
        </div>
        {zoom && (
          <div className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/80"
            onClick={() => setZoom(null)}>
            <img src={zoom} alt="" className="max-h-[92%] max-w-[92%] rounded-[10px]" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {reports.length === 0 ? (
        <div className="mt-8 text-center text-ui-xs leading-6 text-foreground-subtlest">
          暂无测试报告<br />AI 全量测试后调用 test_report 工具自动生成
        </div>
      ) : reports.map((r, i) => {
        const m = r.meta;
        const name = m.title || r.file.split(/[\\/]/).pop() || r.file;
        return (
          <button key={r.file} type="button" onClick={() => setOpenIdx(i)}
            className="mb-1.5 block w-full rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-hover">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-ui-sm font-medium text-foreground" title={name}>{name}</span>
              {m.verdict && <VerdictBadge verdict={m.verdict} />}
            </div>
            <div className="mt-0.5 flex items-center gap-2.5 text-ui-2xs text-foreground-subtlest">
              {m.date && <span>{m.date}</span>}
              {m.device && <span className="truncate">{m.device}</span>}
              {m.total && <span>✅{m.pass || 0} ❌{m.fail || 0} / {m.total}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
