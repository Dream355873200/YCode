// NewProjectDialog — 新建项目弹窗（模式声明驱动）。
// 先选模式，表单按该模式 mode.json 的 projectFields 渲染；提交走
// projects:create（有 scaffold 的模式生成工程，否则打开已有目录），
// 注册后直接进入该项目会话。
import { useEffect, useMemo, useState } from 'react';
import { useApp, type Project } from './appState';
import { useModes, type ModeDecl, type ProjectField } from './modeRegistry';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../components/lib/utils';

type Values = Record<string, string>;

const initialValues = (m: ModeDecl | undefined): Values =>
  Object.fromEntries((m?.projectFields ?? []).map((f) => [f.id, f.default ?? '']));

const chip = (active: boolean): string => cn(
  'rounded-lg border px-3 py-1.5 text-ui-sm transition-colors',
  active
    ? 'border-brand bg-accent text-brand'
    : 'border-border text-foreground-subtle hover:bg-hover hover:text-foreground',
);

function Field({ field, value, onChange, onPickDir }: {
  field: ProjectField;
  value: string;
  onChange(v: string): void;
  onPickDir(): void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-ui-sm font-normal text-foreground-subtle">
        {field.label}{field.required && <span className="text-destructive"> *</span>}
      </Label>
      {field.type === 'text' && (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
      )}
      {field.type === 'textarea' && (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3}
          placeholder={field.placeholder} className="min-h-0" />
      )}
      {field.type === 'folder' && (
        <div className="flex gap-2">
          <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} className="min-w-0 flex-1" />
          <Button variant="outline" onClick={onPickDir} className="shrink-0">浏览</Button>
        </div>
      )}
      {field.type === 'choice' && (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((o) => (
            <button key={o.value} type="button" className={chip(value === o.value)} onClick={() => onChange(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {field.hint && <span className="text-ui-xs text-foreground-subtlest">{field.hint}</span>}
    </div>
  );
}

export function NewProjectDialog() {
  const { createDialogOpen, setCreateDialogOpen, openProject, refreshProjects, defaultMode } = useApp();
  const modes = useModes();
  const [modeId, setModeId] = useState(defaultMode);
  const mode = useMemo(() => modes.find((m) => m.id === modeId) ?? modes[0], [modes, modeId]);
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 打开时回到默认模式；切模式时按新模式的字段声明重置表单
  useEffect(() => { if (createDialogOpen) setModeId(defaultMode); }, [createDialogOpen, defaultMode]);
  useEffect(() => { setValues(initialValues(mode)); setError(''); }, [mode]);

  const close = (open: boolean): void => {
    if (!busy) { setCreateDialogOpen(open); if (!open) setError(''); }
  };

  const set = (id: string, v: string): void => setValues((s) => ({ ...s, [id]: v }));

  const pickDir = async (id: string): Promise<void> => {
    const d = await window.amc.projects.pickDir();
    if (!d) return;
    set(id, d);
    // 选目录顺手补项目名（名称字段为空时）
    if (id === 'dir' && mode?.projectFields.some((f) => f.id === 'name') && !values.name) {
      set('name', d.split(/[\\/]/).filter(Boolean).pop() || '');
    }
  };

  const missing = (mode?.projectFields ?? []).some((f) => f.required && !values[f.id]?.trim());

  const create = async (): Promise<void> => {
    if (!mode) return;
    setBusy(true);
    setError('');
    try {
      const fields = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
      const r = await window.amc.projects.create({ mode: mode.id, scaffold: mode.scaffold, fields }) as { ok: boolean; error?: string };
      if (!r.ok) { setError(r.error || '创建失败'); return; }
      await refreshProjects();
      const list = await window.amc.projects.list() as Project[];
      const created = list.find((p) => p.dir === fields.dir);
      setCreateDialogOpen(false);
      if (created) openProject(created);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={createDialogOpen} onOpenChange={close}>
      <DialogContent className="max-w-125">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>{mode?.description || '选择模式，其余交给 AI。'}</DialogDescription>
        </DialogHeader>

        {modes.length === 0 ? (
          <div className="text-ui-sm text-foreground-subtle">引擎未就绪，暂无可用模式。</div>
        ) : (
          <div className="grid gap-3">
            {modes.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {modes.map((m) => (
                  <button key={m.id} type="button" className={chip(m.id === mode?.id)}
                    onClick={() => setModeId(m.id)} disabled={busy}>
                    {m.name}
                  </button>
                ))}
              </div>
            )}
            {mode?.projectFields.map((f) => (
              <Field key={`${mode.id}:${f.id}`} field={f} value={values[f.id] ?? ''}
                onChange={(v) => set(f.id, v)} onPickDir={() => void pickDir(f.id)} />
            ))}
          </div>
        )}

        {error && <div className="text-ui-sm text-destructive">{error}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>取消</Button>
          <Button onClick={() => void create()} disabled={busy || !mode || missing}>
            {busy
              ? (mode?.scaffold ? `创建中…（${mode.scaffold}）` : '打开中…')
              : (mode?.scaffold ? '创建并开始' : '打开并开始')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
