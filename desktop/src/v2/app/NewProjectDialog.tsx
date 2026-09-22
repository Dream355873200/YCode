// NewProjectDialog — 新建项目弹窗。
// 创建项目 = 新开一个会话：填想法 → projects:create（flutter 脚手架 +
// SPEC 草稿 + git init）→ 直接进入会话首条消息已备好。
import { useState } from 'react';
import { useApp, type Project } from './appState';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../components/lib/utils';

export function NewProjectDialog() {
  const { createDialogOpen, setCreateDialogOpen, openProject, refreshProjects } = useApp();
  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [idea, setIdea] = useState('');
  const [kind, setKind] = useState('app');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const close = (open: boolean): void => {
    if (!busy) { setCreateDialogOpen(open); if (!open) setError(''); }
  };

  const pickDir = async (): Promise<void> => {
    const d = await window.amc.projects.pickDir();
    if (d) {
      setDir(d);
      if (!name) setName(d.split(/[\\/]/).filter(Boolean).pop() || '');
    }
  };

  const create = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const r = await (window.amc.projects.create as (p: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>)({ name, dir, idea, kind });
      if (!r.ok) { setError(r.error || '创建失败'); return; }
      await refreshProjects();
      // registry 里刚创建的项目（list 第一项）直接打开
      const list = await (window.amc.projects.list as () => Promise<Project[]>)( );
      const created = list.find((p) => p.dir === dir);
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
          <DialogDescription>写下你的想法，其余交给 AI。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-ui-sm font-normal text-foreground-subtle">项目名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：记账小助手" />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-ui-sm font-normal text-foreground-subtle">项目目录</Label>
            <div className="flex gap-2">
              <Input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="选择一个空目录" className="min-w-0 flex-1" />
              <Button variant="outline" onClick={() => void pickDir()} className="shrink-0">浏览</Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-ui-sm font-normal text-foreground-subtle">应用想法</Label>
            <Textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={3}
              placeholder="想做一个什么样的 App？核心功能是什么？" className="min-h-0" />
          </div>
          <div className="flex gap-2">
            {(['app', 'go'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-ui-sm transition-colors',
                  kind === k
                    ? 'border-brand bg-accent text-brand'
                    : 'border-border text-foreground-subtle hover:bg-hover hover:text-foreground',
                )}>
                {k === 'app' ? '纯移动 App' : 'App + Go 后端'}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="text-ui-sm text-destructive">{error}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>取消</Button>
          <Button onClick={() => void create()} disabled={busy || !name.trim() || !dir.trim()}>
            {busy ? '创建中…（flutter 脚手架）' : '创建并开始'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
