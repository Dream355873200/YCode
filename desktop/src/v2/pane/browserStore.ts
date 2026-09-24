// browserStore — 浏览器实例的模块级订阅（右栏 tab 需要实例列表，BrowserTab
// 需要单个实例详情；共享一份 amc.browser.onChanged 流）。渲染进程内全局单份。
import { useEffect, useState } from 'react';

export interface BrowserInst {
  id: string; url: string; title: string;
  active: boolean; suspended: boolean;
}

let insts: BrowserInst[] = [];
const subs = new Set<(v: BrowserInst[]) => void>();
let inited = false;

function setNext(v: unknown) {
  // 控制端点的 /browser/status 返回整体对象 {port, activeId, instances}；
  // 只取实例数组（直接把对象当数组用会让 SidePane insts.map 崩成白屏）
  const arr = Array.isArray(v)
    ? v
    : Array.isArray((v as { instances?: BrowserInst[] })?.instances)
      ? (v as { instances: BrowserInst[] }).instances
      : [];
  insts = arr;
  for (const f of subs) f(insts);
}

function init() {
  if (inited) return;
  inited = true;
  const amc = (window as unknown as { amc?: { browser?: { list?: () => Promise<BrowserInst[]>; onChanged?: (cb: (v: BrowserInst[]) => void) => () => void } } }).amc;
  amc?.browser?.list?.().then(setNext).catch(() => {});
  amc?.browser?.onChanged?.(setNext);
}

export function useBrowserInsts(): BrowserInst[] {
  const [v, setV] = useState<BrowserInst[]>(insts);
  useEffect(() => {
    init();
    subs.add(setV);
    return () => { subs.delete(setV); };
  }, []);
  return v;
}
