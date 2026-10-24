// CommitDialog — 提交改动：提交说明（可让模型据 diff 起草）+ 提交 / 提交并推送。
// 状态面板「工作区」区块与右栏变更面板共用。
import { useEffect, useState } from 'react';
import { ArrowUpFromLineIcon, GitCommitHorizontalIcon, Loader2Icon, WandSparklesIcon } from 'lucide-react';
import { engine } from '../../protocol';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Textarea } from '../../components/ui/textarea';
import { refreshGit, useGitChanges } from '../gitChanges';

export function CommitDialog({ dir, open, onOpenChange }: {
  dir: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const changes = useGitChanges(open ? dir : null);
  const [message, setMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState<'' | 'commit' | 'push'>('');
  const [error, setError] = useState('');

  useEffect(() => { if (open) setError(''); }, [open]);

  const generate = async (): Promise<void> => {
    setGenerating(true);
    setError('');
    try {
      const d = await window.amc.git.diffAll(dir);
      const r = await engine.post('/assist/commit-message', { stat: d.stat ?? '', diff: d.diff ?? '' });
      const body = r.body as { message?: string; error?: string } | undefined;
      if (body?.message) setMessage(body.message);
      else setError(body?.error || '生成失败');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const submit = async (push: boolean): Promise<void> => {
    setBusy(push ? 'push' : 'commit');
    setError('');
    try {
      const c = await window.amc.git.commit(dir, message);
      if (!c.ok) { setError(c.error || '提交失败'); return; }
      if (push) {
        const p = await window.amc.git.push(dir);
        if (!p.ok) { setError(`已提交，但推送失败：${p.error || ''}`); refreshGit(dir); return; }
      }
      setMessage('');
      refreshGit(dir);
      onOpenChange(false);
    } finally {
      setBusy('');
    }
  };

  const summary = changes?.ok
    ? `${changes.files.length} 个文件 · +${changes.added} -${changes.deleted}${changes.branch ? ` · 分支 ${changes.branch}` : ''}`
    : '';
  const disabled = !!busy || generating;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-125">
        <DialogHeader>
          <DialogTitle>提交改动</DialogTitle>
          {summary && <DialogDescription className="text-ui-base tabular-nums">{summary}</DialogDescription>}
        </DialogHeader>
        <div className="grid gap-2">
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} autoFocus
            placeholder="提交说明：首行写摘要，空一行后写细节"
            className="min-h-28 font-mono text-ui-base"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && message.trim()) { e.preventDefault(); void submit(false); }
            }} />
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void generate()}>
              {generating ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
              {generating ? '起草中…' : '让模型起草'}
            </Button>
            <span className="text-ui-xs text-foreground-subtlest">Ctrl+Enter 提交</span>
          </div>
          {error && <div className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-ui-sm text-destructive">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={!!busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="outline" disabled={disabled || !message.trim()} onClick={() => void submit(true)}>
            {busy === 'push' ? <Loader2Icon className="animate-spin" /> : <ArrowUpFromLineIcon />}
            提交并推送
          </Button>
          <Button disabled={disabled || !message.trim()} onClick={() => void submit(false)}>
            {busy === 'commit' ? <Loader2Icon className="animate-spin" /> : <GitCommitHorizontalIcon />}
            提交
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
