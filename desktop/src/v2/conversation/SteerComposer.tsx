// SteerComposer — 子代理插话输入（AgentCard 与右栏子代理轨迹共用）：
// 单行起步、随内容增高（field-sizing），Enter 发送 / Shift+Enter 换行。
// 指示在子代理自己的工具批边界送达，不必等它整个结束。
import { useState } from 'react';
import { CornerDownLeft as SendIco } from 'lucide-react';
import { cn } from '../components/lib/utils';

export function SteerComposer({ name, onSend, className, autoFocus = false }: {
  name: string;
  onSend(text: string): void;
  className?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const send = (): void => {
    const t = text.trim();
    if (!t) return;
    setText('');
    onSend(t);
  };
  return (
    <div className={cn('flex items-end gap-1.5 rounded-lg border border-border bg-input px-2 py-1 transition-colors focus-within:border-input-border-focused', className)}>
      <textarea
        value={text}
        autoFocus={autoFocus}
        rows={1}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
          e.stopPropagation();
        }}
        placeholder={`给 ${name} 发指示…（Enter 发送，Shift+Enter 换行）`}
        className="scroll-fine max-h-32 min-h-6 w-full resize-none self-center bg-transparent py-0.5 text-ui-sm leading-5 text-foreground outline-none placeholder:text-foreground-subtlest"
      />
      <button
        type="button"
        aria-label="发送指示"
        title="发送指示"
        disabled={!text.trim()}
        className="shrink-0 rounded p-1 text-foreground-subtlest hover:bg-hover hover:text-foreground disabled:opacity-40"
        onClick={send}
      >
        <SendIco className="size-3.5" />
      </button>
    </div>
  );
}
