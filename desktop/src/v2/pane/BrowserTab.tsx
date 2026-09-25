// BrowserTab — 右栏单个浏览器实例 tab 的内容：工具栏（后退/前进/刷新/地址栏/
// 元素选取/DevTools）+ 浏览区。实例（WebContentsView）活在主进程；本组件
// 挂载即激活该实例（主进程把 WebContentsView 盖到浏览区矩形上），卸载/切走
// 时上报空矩形隐藏。「选取元素」注入拾取脚本，点中的元素以引用文本加入对话。
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, CrosshairIcon, RotateCwIcon, SquareTerminalIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { useApp } from '../app/appState';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';
import type { BrowserInst } from './browserStore';

interface PickInfo { selector: string; tag: string; text: string; html: string; rect: { x: number; y: number; w: number; h: number } }

export default function BrowserTab({ inst }: { inst: BrowserInst }) {
  const { injectComposer } = useApp();
  const [urlInput, setUrlInput] = useState(inst.url);
  const [picking, setPicking] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const amc = (window as unknown as { amc?: { browser?: Record<string, (...a: unknown[]) => unknown> } }).amc;

  useEffect(() => {
    setUrlInput(inst.url);
  }, [inst.url, inst.id]);

  // 挂载即激活（主进程 attach WebContentsView）+ 浏览区矩形跟随。
  // 注意 deps 只有 inst.id：amc 对象每轮渲染都是新引用，若入 deps 会在
  // 拖拽调宽等高频重渲染里反复 detach/attach，导致浏览器视图位置冻结。
  useEffect(() => {
    amc?.browser?.activate?.(inst.id);
    const host = hostRef.current;
    // 矩形上报去重 + rAF 合帧：窗口缩放时 RO 每帧触发，裸发 IPC 会造成
    // 主进程 setBounds 风暴（渲染卡顿）。
    let lastKey = '';
    let raf = 0;
    const ro = host && new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (key === lastKey) return;
      lastKey = key;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        amc?.browser?.setRect?.({ x: Math.round(r.left), y: Math.round(r.top), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) });
      });
    });
    if (host && ro) ro.observe(host);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      amc?.browser?.setRect?.(null); // 卸载（切走/关闭）：隐藏视图
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inst.id]);

  const navigate = useCallback((raw: string) => {
    const u = raw.trim();
    if (!u) return;
    const url = /^https?:\/\//.test(u) || u === 'about:blank' ? u : `https://${u}`;
    setUrlInput(url);
    amc?.browser?.navigate?.(inst.id, url);
  }, [amc, inst.id]);

  // 元素选取：注入脚本等用户点选；完成/取消恢复按钮态
  const togglePick = useCallback(async () => {
    if (!amc?.browser) return;
    if (picking) {
      amc.browser.pickCancel?.(inst.id);
      setPicking(false);
      return;
    }
    setPicking(true);
    try {
      const info = await Promise.resolve(amc.browser.pick?.(inst.id)) as PickInfo | null | undefined;
      if (info) {
        const ref = `[网页元素] <${info.tag}>${info.text ? ` "${info.text.slice(0, 60)}"` : ''}（selector: ${info.selector}）`;
        injectComposer(ref);
      }
    } catch { /* 拾取失败静默（超时/导航走掉） */ }
    setPicking(false);
  }, [amc, inst.id, picking, injectComposer]);

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="后退"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => amc?.browser?.back?.(inst.id)}>
          <ArrowLeftIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="前进"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => amc?.browser?.forward?.(inst.id)}>
          <ArrowRightIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="刷新"
          className="text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => amc?.browser?.reload?.(inst.id)}>
          <RotateCwIcon />
        </Button>
        <input
          className="h-6 min-w-0 flex-1 rounded-md border border-border/60 bg-input px-2 text-ui-xs text-foreground outline-none placeholder:text-foreground-subtlest focus:border-ring"
          placeholder="输入网址，Enter 导航"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(urlInput); }}
        />
        <Button variant="ghost" size="icon-sm" aria-label="缩小虚拟宽度" title="缩小页面虚拟宽度（显示更多内容）"
          className="shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => amc?.browser?.viewport?.(inst.id, true, Math.max(640, Math.round((inst.vw || 1280) * 0.8)))}>
          <ZoomOutIcon />
        </Button>
        <button type="button" title="适应宽度：按桌面版式渲染并缩放进面板"
          className={cn('h-6 shrink-0 rounded-md px-1.5 text-ui-2xs',
            inst.fit ? 'bg-brand/15 text-brand' : 'text-foreground-subtle hover:bg-hover hover:text-foreground')}
          onClick={() => amc?.browser?.viewport?.(inst.id, !inst.fit, inst.vw || 1280)}>
          {inst.fit ? `${inst.vw || 1280}` : '1:1'}
        </button>
        <Button variant="ghost" size="icon-sm" aria-label="放大虚拟宽度" title="放大页面虚拟宽度（内容更大）"
          className="shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => amc?.browser?.viewport?.(inst.id, true, Math.min(2400, Math.round((inst.vw || 1280) * 1.25)))}>
          <ZoomInIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="选择元素加入对话" title="选择元素加入对话"
          className={cn('shrink-0', picking ? 'bg-brand/20 text-brand' : 'text-foreground-subtle hover:bg-hover hover:text-foreground')}
          onClick={() => togglePick()}>
          <CrosshairIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="打开 DevTools" title="打开 DevTools"
          className="shrink-0 text-foreground-subtle hover:bg-hover hover:text-foreground"
          onClick={() => amc?.browser?.devtools?.(inst.id)}>
          <SquareTerminalIcon />
        </Button>
        {inst.suspended && <span className="shrink-0 text-ui-2xs text-foreground-subtlest">已挂起 · 操作自动恢复</span>}
      </div>
      {/* 浏览区：主进程 WebContentsView 盖在此矩形上 */}
      <div ref={hostRef} className="relative min-h-0 flex-1 bg-panel" />
    </div>
  );
}
