// 设置页编辑器共享件：用户资产的「写文件 → 引擎 reload → 刷新目录」提交管线，
// 以及表单行 / 多选胶囊 / 保存栏 / 来源徽标 / 复制为自定义 / 二次确认删除。
// 内置资产（origin=bundled）只读，复制到用户资产目录后再编辑；用户资产可删除。
import { useCallback, useEffect, useState } from 'react';
import { CopyIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { engine } from '../../protocol';
import { useApp } from '../appState';
import { Button } from '../../components/ui/button';
import { cn } from '../../components/lib/utils';
import { useCatalog, type AssetOrigin, type LoadError } from './catalog';
import type { FileWrite } from './manifest';
import { Chip, ErrorBox } from './ui';

/** 一步资产操作（路径相对用户资产根；copy 的 src 为绝对路径）。 */
export type AssetOp =
  | { write: FileWrite }
  | { rm: string }
  | { mkdir: string }
  | { copy: { src: string; dest: string } };

export interface CommitResult {
  ok: boolean;
  error?: string;
  /** reload 后仍存在的加载错误（坏项被引擎跳过）。 */
  errors?: LoadError[];
}

/** 提交用户资产改动：顺序执行文件操作 → POST /reload → 刷新能力目录与模式清单。 */
export function useAssetCommit(): (ops: AssetOp[]) => Promise<CommitResult> {
  const catalog = useCatalog();
  const { refreshModes } = useApp();
  return useCallback(async (ops: AssetOp[]) => {
    const assets = window.amc.assets;
    for (const op of ops) {
      const r = 'write' in op ? await assets.write(op.write.path, op.write.content)
        : 'rm' in op ? await assets.rm(op.rm)
        : 'mkdir' in op ? await assets.mkdir(op.mkdir)
        : await assets.copy(op.copy.src, op.copy.dest);
      if (!r.ok) return { ok: false, error: r.error || '写入失败' };
    }
    try {
      const res = await engine.post('/reload') as { status?: number; body?: unknown };
      const body = res.body as { ok?: boolean; error?: string; errors?: LoadError[] } | undefined;
      if (!body?.ok) return { ok: false, error: `文件已保存，但引擎重载失败：${body?.error || `HTTP ${res.status ?? '?'}`}` };
      return { ok: true, errors: body.errors ?? [] };
    } catch (e) {
      return { ok: false, error: `文件已保存，但引擎不可达：${e instanceof Error ? e.message : String(e)}` };
    } finally {
      catalog.refresh();
      refreshModes();
    }
  }, [catalog, refreshModes]);
}

/** 读取文件文本（编辑器预填）；path 为空时直接给空串。 */
export function useFileText(path: string | undefined): { text: string; loaded: boolean; error: string } {
  const [state, setState] = useState({ text: '', loaded: !path, error: '' });
  useEffect(() => {
    if (!path) { setState({ text: '', loaded: true, error: '' }); return; }
    let alive = true;
    setState({ text: '', loaded: false, error: '' });
    (window.amc.fs.readFile(path) as Promise<{ ok: boolean; content?: string; error?: string }>)
      .then((r) => { if (alive) setState({ text: r.content ?? '', loaded: true, error: r.ok ? '' : r.error || '读取失败' }); })
      .catch((e: unknown) => { if (alive) setState({ text: '', loaded: true, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [path]);
  return state;
}

/** 表单行：标签 + 控件 + 提示。 */
export function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-ui-xs font-medium text-foreground-subtle">{label}</span>
      {children}
      {hint && <span className="block text-ui-2xs text-foreground-subtlest">{hint}</span>}
    </label>
  );
}

/** 多选胶囊（选中顺序即声明顺序）。 */
export function ToggleChips({ options, value, onChange, empty = '无可选项' }: {
  options: Array<{ id: string; label: string; title?: string }>;
  value: string[];
  onChange(v: string[]): void;
  empty?: string;
}) {
  if (!options.length) return <div className="text-ui-xs text-foreground-subtlest">{empty}</div>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button key={o.id} type="button" title={o.title} aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={cn(
              'rounded-full border px-2.5 py-1 text-ui-xs transition-colors',
              on ? 'border-brand/50 bg-brand/15 text-brand' : 'border-border bg-surface text-foreground-subtle hover:bg-hover',
            )}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 编辑器外壳：表单区 + 错误 + 取消 / 保存。 */
export function EditorFrame({ title, error, saving, onCancel, onSave, children }: {
  title: string;
  error: string;
  saving: boolean;
  onCancel(): void;
  onSave(): void;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h3 className="text-ui-base font-semibold text-foreground">{title}</h3>
      <div className="space-y-4 rounded-xl border border-border/50 bg-surface px-4 py-4">{children}</div>
      {error && <ErrorBox message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>取消</Button>
        <Button type="button" size="sm" onClick={onSave} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
      </div>
    </section>
  );
}

/** 保存状态机：busy / error + 执行提交，成功回调。 */
export function useSaver() {
  const commit = useAssetCommit();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (ops: AssetOp[] | { error: string }, onDone?: () => void): Promise<boolean> => {
    if (!Array.isArray(ops)) { setError(ops.error); return false; }
    setSaving(true);
    setError('');
    const r = await commit(ops);
    setSaving(false);
    if (!r.ok) { setError(r.error || '保存失败'); return false; }
    onDone?.();
    return true;
  }, [commit]);
  return { saving, error, setError, run };
}

/** 来源徽标：内置 / 自定义。 */
export function OriginChip({ origin }: { origin?: AssetOrigin }) {
  if (origin !== 'user') return <Chip>内置</Chip>;
  return <Chip tone="brand">自定义</Chip>;
}

/** 详情页操作：内置 →「复制为自定义」；自定义 →「编辑」+「删除」（二次确认）。 */
export function AssetActions({ origin, onCopy, onEdit, onDelete, busy }: {
  origin?: AssetOrigin;
  onCopy?(): void;
  onEdit?(): void;
  onDelete?(): void;
  busy?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);
  if (origin !== 'user') {
    return onCopy ? (
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCopy}>
        <CopyIcon className="size-3.5" />复制为自定义
      </Button>
    ) : null;
  }
  return (
    <>
      {onEdit && (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onEdit}>
          <PencilIcon className="size-3.5" />编辑
        </Button>
      )}
      {onDelete && (
        <Button type="button" size="sm" variant={confirm ? 'destructive' : 'ghost'} disabled={busy}
          onClick={() => (confirm ? (setConfirm(false), onDelete()) : setConfirm(true))}>
          <Trash2Icon className="size-3.5" />{confirm ? '确认删除' : '删除'}
        </Button>
      )}
    </>
  );
}

/** 加载错误列表（坏项已被引擎跳过）。 */
export function LoadErrors({ errors }: { errors: LoadError[] }) {
  if (!errors.length) return null;
  return (
    <div className="space-y-1.5">
      {errors.map((e, i) => (
        <ErrorBox key={`${e.kind}:${e.id}:${i}`} message={`${e.id ? `${e.id}：` : ''}${e.error}`} />
      ))}
    </div>
  );
}
