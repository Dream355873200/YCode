// NewProjectDialog — 添加项目（智能体声明驱动）。
// 先选智能体，表单按其 mode.json 的 projectFields 渲染；提交走
// projects:create（有 scaffold 的智能体生成工程，否则打开已有目录），
// 注册后进入该项目的新对话草稿。
import { useEffect, useMemo, useState } from 'react';
import { useApp, type Project } from './appState';
import { AgentAvatar } from './agentIcon';
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
      <DialogContent className="max-w-150">
        <DialogHeader>
          <DialogTitle>添加项目</DialogTitle>
          <DialogDescription className="text-ui-sm">选择一个智能体：打开已有文件夹，或按它的模板生成新工程。之后在项目里可以随时换智能体。</DialogDescription>
        </DialogHeader>

        {modes.length === 0 ? (
          <div className="text-ui-sm text-foreground-subtle">引擎未就绪，暂无可用智能体。</div>
        ) : (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2">
              {modes.map((m) => (
                <button key={m.id} type="button" disabled={busy} onClick={() => setModeId(m.id)}
                  className={cn(
                    'flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors',
                    m.id === mode?.id ? 'border-brand/60 bg-brand/8' : 'border-border hover:border-border-hover hover:bg-hover',
                  )}>
                  <AgentAvatar icon={m.icon} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-ui-sm font-medium text-foreground">
                      {m.name}
                      {m.scaffold && <span className="rounded bg-info/12 px-1 text-ui-2xs font-normal text-info">生成工程</span>}
                    </span>
                    {m.description && <span className="line-clamp-2 text-ui-xs text-foreground-subtlest">{m.description}</span>}
                  </span>
                </button>
              ))}
            </div>
            <div className="grid gap-3">
              {mode?.projectFields.map((f) => (
                <Field key={`${mode.id}:${f.id}`} field={f} value={values[f.id] ?? ''}
                  onChange={(v) => set(f.id, v)} onPickDir={() => void pickDir(f.id)} />
              ))}
            </div>
          </div>
        )}

        {error && <div className="text-ui-sm text-destructive">{error}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>取消</Button>
          <Button onClick={() => void create()} disabled={busy || !mode || missing}>
            {busy
              ? (mode?.scaffold ? '正在生成工程…' : '打开中…')
              : (mode?.scaffold ? '生成并开始' : '打开并开始')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
