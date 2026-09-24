import * as React from "react";

import { cn } from "../lib/utils.js";

// 展开/收起动画：grid 行 0fr ↔ 1fr 过渡高度（不用测量内容高度），叠加
// 透明度与轻微位移做渐显渐隐；过渡期间底边加渐隐遮罩，内容从柔边里
// 长出/收进。收起动画结束后才卸载子树，展开时先挂载再下一帧起动画。
// 首次挂载即展开（切会话回到运行中的轮次等）不播动画。

const DURATION = 220;
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const FADE_MASK = "linear-gradient(to bottom, #000 calc(100% - 24px), transparent)";

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Collapse({ open, className, children }: {
  open: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = React.useState(open);
  const [shown, setShown] = React.useState(open);
  const [moving, setMoving] = React.useState(false);
  const prev = React.useRef(open);

  React.useEffect(() => {
    if (prev.current === open) return;
    prev.current = open;
    if (reducedMotion()) {
      setMounted(open);
      setShown(open);
      return;
    }
    setMoving(true);
    let raf1 = 0;
    let raf2 = 0;
    if (open) {
      setMounted(true);
      // 等 0fr 起始态上屏后再切目标态，否则直接跳到展开
      raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)); });
    } else {
      setShown(false);
    }
    const timer = window.setTimeout(() => {
      setMoving(false);
      if (!open) setMounted(false);
    }, DURATION);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, [open]);

  if (!mounted) return null;
  const mask = moving ? FADE_MASK : undefined;
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: shown ? "1fr" : "0fr",
        opacity: shown ? 1 : 0,
        translate: shown ? "0 0" : "0 -4px",
        transition: `grid-template-rows ${DURATION}ms ${EASE}, opacity ${DURATION}ms ${EASE}, translate ${DURATION}ms ${EASE}`,
      }}
    >
      {/* 过渡期裁切 + 遮罩；静止展开时不裁切，避免挡住内部弹层 */}
      <div className={cn("min-h-0", (moving || !shown) && "overflow-hidden")}
        style={{ maskImage: mask, WebkitMaskImage: mask }}>
        <div className={className}>{children}</div>
      </div>
    </div>
  );
}

export { Collapse };
