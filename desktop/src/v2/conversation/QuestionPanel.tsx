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
  const elicit = !isAsk && row.elicit ? row.elicit : undefined;
  // 表单字段（elicit.mode=form 且 schema 声明了 properties）；空 = 走自由输入
  const fields: Array<{ name: string; type: string; title: string; required: boolean }> = (() => {
    if (!elicit || elicit.mode !== 'form' || !elicit.schema || typeof elicit.schema !== 'object') return [];
    const props = (elicit.schema as { properties?: Record<string, unknown> }).properties ?? {};
    const required = Array.isArray((elicit.schema as { required?: unknown }).required)
      ? (elicit.schema as { required: unknown[] }).required : [];
    return Object.entries(props).map(([name, p]) => {
      const o = typeof p === 'object' && p !== null ? p as Record<string, unknown> : {};
      return {
        name,
        type: typeof o.type === 'string' ? o.type : 'string',
        title: typeof o.title === 'string' ? o.title : name,
        required: required.includes(name),
      };
    });
  })();
  const itemCount = choices.length + 1; // 末项 = 自由输入

  const [hi, setHi] = useState(-1); // 键盘高亮：0..choices.length-1 选项，choices.length = 自由输入
  const [sel, setSel] = useState<number[]>([]); // 已选选项（单选存一个，多选存多个）
  const [custom, setCustom] = useState(''); // 自由输入内容
  const [inputOpen, setInputOpen] = useState(isAsk); // ask 行只有自由输入，直接展开
  const [form, setForm] = useState<Record<string, string>>({}); // elicit 表单值（字符串存，提交时按类型转换）
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 挂载即聚焦：阻塞式面板，键盘导航立即可用
  useEffect(() => { rootRef.current?.focus(); }, []);

  const submitText = inputOpen && custom.trim()
    ? custom.trim()
    : sel.length ? sel.map((i) => choices[i]).join('、') : '';

  const submit = (): void => { if (submitText) void answer(sid, row.id, row.requestId, submitText); };
  // elicitation 的「忽略」= 空回答 = 取消（引擎语义）；非空文本会被当表单
  // 内容校验并附原因重问，不能用旧跳过文案
  const skip = (): void => { void answer(sid, row.id, row.requestId, elicit ? '' : '（用户跳过了这个问题）'); };
  const toggle = (i: number): void =>
    setSel((s) => (multi ? (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]) : [i]));

  // elicit 表单提交：字段值按 schema 类型转换成 JSON 对象（表单内容是 JSON
  // 对象即接受）；没有字段声明时退化为自由文本
  const formReady = elicit?.mode === 'url'
    ? true
    : fields.length === 0
      ? !!custom.trim()
      : fields.every((f) => !f.required || (form[f.name] ?? '') !== '');
  const submitElicit = (): void => {
    if (elicit?.mode === 'url') { void answer(sid, row.id, row.requestId, '同意'); return; }
    if (!formReady) return;
    if (fields.length === 0) { void answer(sid, row.id, row.requestId, custom.trim()); return; }
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = form[f.name] ?? '';
      if (f.type === 'boolean') out[f.name] = v === 'true';
      else if (f.type === 'number' || f.type === 'integer') out[f.name] = v === '' ? 0 : Number(v);
      else out[f.name] = v;
    }
    void answer(sid, row.id, row.requestId, JSON.stringify(out));
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { skip(); return; }
    if (elicit) return; // 表单/链接模式：输入框自管 Enter，Tab 走默认焦点移动
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
    }
  };

  return (
    <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}
      className="rounded-lg border border-border-hover bg-card px-3 py-2.5 outline-none">
      {/* 头部：模式标签 + 问题 + 批次计数（引擎下发 1-based index） */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded border border-border bg-surface px-1.5 py-0.5 text-ui-sm text-foreground-subtle">
          {isAsk ? '提问' : elicit ? (elicit.mode === 'url' ? 'MCP 链接' : 'MCP 表单') : multi ? '多选' : '选择'}
        </span>
        <div className="min-w-0 flex-1 text-ui-base font-medium text-foreground">{row.question}</div>
        {row.kind === 'confirm' && row.total && row.total > 1 && (
          <span className="shrink-0 text-ui-sm tabular-nums text-foreground-subtlest">
            {row.index ?? 1}/{row.total}
          </span>
        )}
      </div>
      {row.kind === 'confirm' && row.detail && <div className="mt-1 text-ui-base text-foreground-subtle">{row.detail}</div>}
      {elicit?.error && <div className="mt-1 text-ui-sm text-destructive">{elicit.error}</div>}

      {/* MCP elicitation：表单字段 / 链接确认 */}
      {elicit && fields.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {fields.map((f) => (
            <div key={f.name} className="flex items-center gap-2">
              <span className="w-28 shrink-0 truncate text-ui-sm text-foreground-subtle" title={f.title}>{f.title}</span>
              {f.type === 'boolean' ? (
                <span className="flex min-w-0 flex-1 gap-1">
                  {['true', 'false'].map((v) => (
                    <button key={v} type="button"
                      onClick={() => setForm((m) => ({ ...m, [f.name]: v }))}
                      className={`rounded-md border px-2.5 py-1 text-ui-sm transition-colors ${form[f.name] === v ? 'border-brand bg-hover text-foreground' : 'border-border text-foreground-subtle hover:bg-hover'}`}>
                      {v === 'true' ? '是' : '否'}
                    </button>
                  ))}
                </span>
              ) : (
                <Input
                  value={form[f.name] ?? ''}
                  onChange={(e) => { setForm((m) => ({ ...m, [f.name]: e.target.value })); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && formReady) { e.preventDefault(); submitElicit(); }
                    e.stopPropagation();
                  }}
                  type={f.type === 'number' || f.type === 'integer' ? 'number' : 'text'}
                  placeholder={f.required ? '必填' : '可留空'}
                  className="h-7 min-w-0 flex-1 bg-surface text-ui-base"
                />
              )}
            </div>
          ))}
        </div>
      )}
      {elicit?.mode === 'url' && elicit.url && (
        <div className="mt-2 flex items-center gap-2 text-ui-sm">
          <a href={elicit.url} target="_blank" rel="noreferrer"
            className="min-w-0 truncate text-brand underline underline-offset-2">{elicit.url}</a>
          <span className="shrink-0 text-foreground-subtlest">打开后在此确认</span>
        </div>
      )}

      {/* 编号选项列表（末项 = 自由输入入口）；elicitation 有字段声明或链接模式时不渲染 */}
      {(!elicit || fields.length === 0) && elicit?.mode !== 'url' && (
        <div className="mt-2 space-y-0.5">
        {choices.map((c, i) => {
          const selected = sel.includes(i);
          return (
            <button key={`${i}-${c}`} type="button" onMouseEnter={() => setHi(i)}
              onClick={() => { if (multi) toggle(i); else void answer(sid, row.id, row.requestId, c); }}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-ui-base transition-colors ${hi === i ? 'bg-hover' : ''}`}>
              <span className={`w-4 shrink-0 text-right text-ui-sm tabular-nums ${selected ? 'text-brand' : 'text-foreground-subtlest'}`}>
                {i + 1}
              </span>
              <span className={`min-w-0 flex-1 ${selected ? 'text-foreground' : 'text-foreground-subtle'}`}>{c}</span>
              {selected && <CheckIco className="size-3 shrink-0 text-brand" />}
            </button>
          );
        })}
        {inputOpen ? (
          <div className="flex items-center gap-2.5 px-2.5 py-1">
            <span className="w-4 shrink-0 text-right text-ui-sm tabular-nums text-foreground-subtlest">{itemCount}</span>
            <Input ref={inputRef} value={custom} onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) { e.preventDefault(); submit(); }
                e.stopPropagation();
              }}
              placeholder="输入你的回答…" className="h-7 min-w-0 flex-1 bg-surface text-ui-base" />
          </div>
        ) : (
          <button type="button" onMouseEnter={() => setHi(choices.length)}
            onClick={() => { setInputOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-ui-base ${hi === choices.length ? 'bg-hover' : ''}`}>
            <span className="w-4 shrink-0 text-right text-ui-sm tabular-nums text-foreground-subtlest">{itemCount}</span>
            <span className="text-foreground-subtlest">输入你的回答…</span>
          </button>
        )}
        </div>
      )}

      {/* 底部：操作提示 + 忽略/提交 */}
      <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
        <span className="min-w-0 flex-1 truncate text-ui-sm text-foreground-subtlest">
          {elicit
            ? (elicit.mode === 'url' ? '打开链接后确认；忽略 = 取消本次请求' : '填写后提交；忽略 = 取消本次请求')
            : 'ⓘ 使用 Tab / 上下键选择，回车或空格选中'}
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={skip}>忽略</Button>
        {elicit ? (
          <Button type="button" size="sm"
            disabled={elicit.mode !== 'url' && !formReady}
            onClick={submitElicit}>
            {elicit.mode === 'url' ? '同意并继续' : '提交'}
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={!submitText} onClick={submit}>提交</Button>
        )}
      </div>
    </div>
  );
}
