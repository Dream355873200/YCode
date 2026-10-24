// BranchSwitcher — 分支切换浮层：搜索本地分支、切换、基于当前 HEAD 新建并切换。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckIcon, GitBranchIcon, Loader2Icon, PlusIcon, SearchIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { cn } from '../../components/lib/utils';
import { refreshGit } from '../gitChanges';

interface Branch { name: string; current: boolean; when: string }

export function BranchSwitcher({ dir, children, side = 'left' }: {
  dir: string;
  children: ReactNode;
  side?: 'left' | 'bottom';
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError('');
    setBranches(null);
    void window.amc.git.branches(dir).then((r) => {
      if (r.ok) setBranches(r.branches ?? []);
      else setError(r.error || '读取分支失败');
    });
  }, [open, dir]);

  const q = query.trim();
  const shown = useMemo(
    () => (branches ?? []).filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase())),
    [branches, q],
  );
  const canCreate = !!q && !(branches ?? []).some((b) => b.name === q);

  const run = async (name: string, create: boolean): Promise<void> => {
    setBusy(name);
    setError('');
    const r = create ? await window.amc.git.createBranch(dir, name) : await window.amc.git.checkout(dir, name);
    setBusy('');
    if (!r.ok) { setError(r.error || '切换失败'); return; }
    refreshGit(dir);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} align="start" sideOffset={6} className="w-72 p-1.5">
        <div className="flex items-center gap-2 rounded-lg border border-input-border bg-input px-2">
          <SearchIcon className="size-3.5 shrink-0 text-foreground-subtlest" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus
            placeholder="搜索或输入新分支名"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                if (canCreate) void run(q, true);
                else if (shown[0] && !shown[0].current) void run(shown[0].name, false);
              }
            }}
            className="h-7 min-w-0 flex-1 bg-transparent text-ui-sm text-foreground outline-none placeholder:text-foreground-subtlest" />
        </div>
        <div className="mt-1 max-h-56 overflow-y-auto">
          {!branches && !error && (
            <div className="flex items-center gap-2 px-2.5 py-2 text-ui-xs text-foreground-subtlest">
              <Loader2Icon className="size-3.5 animate-spin" />读取分支…
            </div>
          )}
          {shown.map((b) => (
            <button key={b.name} type="button" disabled={b.current || !!busy}
              onClick={() => void run(b.name, false)}
              className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-sm transition-colors',
                b.current ? 'text-foreground' : 'text-foreground-subtle hover:bg-hover hover:text-foreground')}>
              {busy === b.name ? <Loader2Icon className="size-3.5 shrink-0 animate-spin" /> : <GitBranchIcon className="size-3.5 shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {b.current ? <CheckIcon className="size-3.5 shrink-0 text-brand" /> : <span className="shrink-0 text-ui-2xs text-foreground-subtlest">{b.when}</span>}
            </button>
          ))}
          {canCreate && (
            <button type="button" disabled={!!busy} onClick={() => void run(q, true)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ui-sm text-foreground hover:bg-hover">
              {busy === q ? <Loader2Icon className="size-3.5 shrink-0 animate-spin" /> : <PlusIcon className="size-3.5 shrink-0 text-brand" />}
              <span className="min-w-0 flex-1 truncate">新建并切换到 {q}</span>
            </button>
          )}
        </div>
        {error && <div className="mt-1 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-ui-xs text-destructive">{error}</div>}
      </PopoverContent>
    </Popover>
  );
}
