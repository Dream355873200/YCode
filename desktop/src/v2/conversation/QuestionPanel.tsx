// QuestionPanel — 提问面板（阻塞式，ZCode 同款交互：出现即接管底部输入区）。
// 头部模式标签 + 问题 + 批次计数（引擎 1-based），编号选项列表（末项 =
// 自由输入入口），底部操作提示 + 忽略/提交。键盘：Tab / 上下键移动高亮，
// 回车选中（单选直接提交）、空格切换勾选，Esc 忽略。多问批次由引擎逐张
// 下发，每张独立成面板。
import { useEffect, useRef, useState } from 'react';
import { Check as CheckIco } from 'lucide-react';
import type { Row } from './projection/rows';
import { useConversation } from './store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export function QuestionPanel({ row, sid }: { row: Extract<Row, { kind: 'confirm' | 'ask' }>; sid: string }) {
  const answer = useConversation((s) => s.answer);
  const isAsk = row.kind === 'ask';
  const choices = !isAsk && row.choices && row.choices.length ? row.choices : [];
  const multi = !isAsk && row.mode === 'multi';
  const itemCount = choices.length + 1; // 末项 = 自由输入

  const [hi, setHi] = useState(-1); // 键盘高亮：0..choices.length-1 选项，choices.length = 自由输入
  const [sel, setSel] = useState<number[]>([]); // 已选选项（单选存一个，多选存多个）
  const [custom, setCustom] = useState(''); // 自由输入内容
  const [inputOpen, setInputOpen] = useState(isAsk); // ask 行只有自由输入，直接展开
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 挂载即聚焦：阻塞式面板，键盘导航立即可用
  useEffect(() => { rootRef.current?.focus(); }, []);

  const submitText = inputOpen && custom.trim()
    ? custom.trim()
    : sel.length ? sel.map((i) => choices[i]).join('、') : '';

  const submit = (): void => { if (submitText) void answer(sid, row.id, row.requestId, submitText); };
  const skip = (): void => { void answer(sid, row.id, row.requestId, '（用户跳过了这个问题）'); };
  const toggle = (i: number): void =>
    setSel((s) => (multi ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i]));

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setHi((h) => (h + 1) % itemCount);
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setHi((h) => (h - 1 + itemCount) % itemCount);
    } else if (e.key === 'Enter') {
      if (e.target === inputRef.current) return; // 输入框自身处理提交
      e.preventDefault();
      if (hi === choices.length) {
        if (inputOpen && custom.trim()) submit();
        else { setInputOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }
      } else if (hi >= 0 && multi) {
        toggle(hi);
      } else if (hi >= 0) {
        void answer(sid, row.id, row.requestId, choices[hi]!); // 单选回车 = 直接提交该选项
      } else if (submitText) {
        submit();
      }
    } else if (e.key === ' ') {
      if (hi >= 0 && hi < choices.length) { e.preventDefault(); toggle(hi); }
    } else if (e.key === 'Escape') {
      skip();
    }
  };

  return (
    <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}
      className="rounded-lg border border-border-hover bg-card px-3 py-2.5 outline-none">
      {/* 头部：模式标签 + 问题 + 批次计数（引擎下发 1-based index） */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 text-ui-xs text-foreground-subtle">
          {isAsk ? '提问' : multi ? '多选' : '选择'}
        </span>
        <div className="min-w-0 flex-1 text-ui-sm font-medium text-foreground">{row.question}</div>
        {row.kind === 'confirm' && row.total && row.total > 1 && (
          <span className="shrink-0 text-ui-xs tabular-nums text-foreground-subtlest">
            {row.index ?? 1}/{row.total}
          </span>
        )}
      </div>
      {row.kind === 'confirm' && row.detail && <div className="mt-1 text-ui-sm text-foreground-subtle">{row.detail}</div>}

      {/* 编号选项列表（末项 = 自由输入入口） */}
      <div className="mt-2 space-y-0.5">
        {choices.map((c, i) => {
          const selected = sel.includes(i);
          return (
            <button key={`${i}-${c}`} type="button" onMouseEnter={() => setHi(i)}
              onClick={() => { if (multi) toggle(i); else void answer(sid, row.id, row.requestId, c); }}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-ui-sm transition-colors ${hi === i ? 'bg-hover' : ''}`}>
              <span className={`w-4 shrink-0 text-right text-ui-xs tabular-nums ${selected ? 'text-brand' : 'text-foreground-subtlest'}`}>
                {i + 1}
              </span>
              <span className={`min-w-0 flex-1 ${selected ? 'text-foreground' : 'text-foreground-subtle'}`}>{c}</span>
              {selected && <CheckIco className="size-3 shrink-0 text-brand" />}
            </button>
          );
        })}
        {inputOpen ? (
          <div className="flex items-center gap-2.5 px-2.5 py-1">
            <span className="w-4 shrink-0 text-right text-ui-xs tabular-nums text-foreground-subtlest">{itemCount}</span>
            <Input ref={inputRef} value={custom} onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) { e.preventDefault(); submit(); }
                e.stopPropagation();
              }}
              placeholder="输入你的回答…" className="h-7 min-w-0 flex-1 bg-surface text-ui-sm" />
          </div>
        ) : (
          <button type="button" onMouseEnter={() => setHi(choices.length)}
            onClick={() => { setInputOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-ui-sm ${hi === choices.length ? 'bg-hover' : ''}`}>
            <span className="w-4 shrink-0 text-right text-ui-xs tabular-nums text-foreground-subtlest">{itemCount}</span>
            <span className="text-foreground-subtlest">输入你的回答…</span>
          </button>
        )}
      </div>

      {/* 底部：操作提示 + 忽略/提交 */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
        <span className="min-w-0 flex-1 truncate text-ui-xs text-foreground-subtlest">
          ⓘ 使用 Tab / 上下键选择，回车或空格选中
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={skip}>忽略</Button>
        <Button type="button" size="sm" disabled={!submitText} onClick={submit}>提交</Button>
      </div>
    </div>
  );
}
