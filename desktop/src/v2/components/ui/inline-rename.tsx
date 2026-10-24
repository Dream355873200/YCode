import * as React from "react";

import { cn } from "../lib/utils.js";

/** 就地改名输入框：Enter 提交、Esc 取消、失焦时有改动则提交。onDone(null) = 不改。 */
function InlineRename({ value, onDone, className }: {
  value: string;
  onDone(next: string | null): void;
  className?: string;
}) {
  const [v, setV] = React.useState(value);
  const ref = React.useRef<HTMLInputElement>(null);
  const done = React.useRef(false);
  const finish = (next: string | null): void => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  React.useEffect(() => { ref.current?.select(); }, []);
  return (
    <input ref={ref} value={v} autoFocus
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.nativeEvent.isComposing) finish(v.trim() && v.trim() !== value ? v.trim() : null);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(v.trim() && v.trim() !== value ? v.trim() : null)}
      className={cn(
        "no-drag h-6 min-w-0 flex-1 rounded-md border border-input-border-focused bg-input px-1.5 text-ui-base text-foreground outline-none",
        className,
      )} />
  );
}

export { InlineRename };
