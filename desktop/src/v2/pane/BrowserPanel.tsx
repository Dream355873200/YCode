// BrowserPanel — 右栏「浏览器」面板：实例池的 tab 条 + 工具栏 + 浏览区。
// 实例（WebContentsView）活在主进程（browserctl），面板只画 chrome：
//   - tab 条：全部实例（含挂起的，标「已挂起」），点击激活（挂起实例恢复重建）
//   - 工具栏：后退/前进/刷新 + 地址栏（Enter 打开）+ 关闭当前实例
//   - 浏览区：只留一个空矩形，主进程把激活实例的 WebContentsView 盖上来
//     （位置经 browser:rect 上报；ResizeObserver 跟随面板宽度动画）
import { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, PlusIcon, RotateCwIcon, XIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';

interface Inst { id: string; url: string; title: string; active: boolean; suspended: boolean }

export default function BrowserPanel() {
  const [insts, setInsts] = useState<Inst[]>([]);
  const [urlInput, setUrlInput] = useState('');
  const hostRef = useRef<HTMLDivElement>(null);

  const apply = (s: { instances: Inst[] }) => {
    setInsts(s.instances);
    const cur = s.instances.find((i) => i.active);
    if (cur && document.activeElement?.tagName !== 'INPUT') setUrlInput(cur.url);
  };

  useEffect(() => {
    const amc = (window as any).amc;
    amc?.browser?.list?.().then(apply);
    const off = amc?.browser?.onChanged?.(apply);
    // 浏览区矩形上报：面板尺寸/位置变化时跟随（w-84 宽度动画期间 RO 持续触发）
    const host = hostRef.current;
    const ro = host && new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      amc?.browser?.setRect?.({ x: Math.round(r.left), y: Math.round(r.top), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) });
    });
    if (host && ro) ro.observe(host);
    return () => { off?.(); ro?.disconnect(); };
  }, []);

  const open = (raw: string) => {
    const u = raw.trim();
    if (!u) return;
    const url = /^https?:\/\//.test(u) || u === 'about:blank' ? u : `https://${u}`;
    (window as any).amc?.browser?.open?.(url);
  };

  const amc = () => (window as any).amc;
  const cur = insts.find((i) => i.active);

  return (
    <div className="flex h-full flex-col">
      {/* tab 条 */}
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/50 px-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {insts.map((i) => (
          <button key={i.id} type="button" title={i.title || i.url}
            onClick={() => amc().browser.activate(i.id)}
            className={cn(
              'group flex min-w-24 max-w-40 shrink-0 items-center gap-1 rounded-t-md px-2 py-1 text-ui-xs',
              i.active ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover',
            )}>
            <span className="truncate">{i.title || i.url || i.id}{i.suspended ? ' · 已挂起' : ''}</span>
            <XIcon className="size-3 shrink-0 opacity-0 group-hover:opacity-100"
              onClick={(e) => { e.stopPropagation(); amc().browser.close(i.id); }} />
          </button>
        ))}
        <Button variant="ghost" size="icon-sm" aria-label="新建标签"
          className="shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => amc().browser.open('about:blank')}>
          <PlusIcon />
        </Button>
      </div>

      {/* 工具栏 */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="后退" disabled={!cur}
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => open(cur!.url)}>
          <ArrowLeftIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="前进" disabled={!cur}
          className="text-foreground-subtle hover:bg-hover hover:text-foreground">
          <ArrowRightIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="刷新" disabled={!cur}
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => cur && open(cur.url)}>
          <RotateCwIcon />
        </Button>
        <input
          className="h-6 min-w-0 flex-1 rounded-md border border-border/60 bg-input px-2 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtle focus:border-ring"
          placeholder="输入网址，Enter 打开"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') open(urlInput); }}
        />
      </div>

      {/* 浏览区：主进程 WebContentsView 盖在此矩形上 */}
      <div ref={hostRef} className="relative min-h-0 flex-1 bg-panel">
        {insts.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ui-sm text-foreground-subtle">
            <span>还没有打开的网页</span>
            <span>在上方输入网址，或让 Agent 用 browser-use 工具打开页面</span>
          </div>
        )}
      </div>
    </div>
  );
}
