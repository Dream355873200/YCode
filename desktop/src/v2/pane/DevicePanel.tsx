// 设备面板（槽位消费方）：adb 自动检测、scrcpy 投屏（可直接操作 + Android Studio 式设备控制条），
// Flutter 项目另有「运行到手机」：构建安装 → 运行中可热重载 / 热重启，日志尾随手可看。
// 运行由主进程持有（flutter run --machine），状态镜像在 flutterRun store。
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CastIcon, ChevronDownIcon, Loader2Icon, PlayIcon, RotateCwIcon, SmartphoneIcon, SquareIcon, ZapIcon,
} from 'lucide-react';
import { useApp } from '../app/appState';
import { Button } from '../components/ui/button';
import { cn } from '../components/lib/utils';
import MirrorCanvas from './mirror/MirrorCanvas';
import { useFlutterRun, type FlutterRun } from './flutterRun';
import { normalizeDir } from '../app/dirs';

interface Device { id: string; model?: string; state: string; transport?: string }

const amcDevices = window.amc.devices as unknown as {
  list(): Promise<{ devices: Device[]; adbAvailable?: boolean }>;
  onChanged(cb: (p: { devices: Device[]; adbAvailable?: boolean }) => void): () => void;
  onMirrorExited(cb: (p: { deviceId: string; error?: string }) => void): () => void;
  startMirror(id: string): Promise<{ ok: boolean; error?: string }>;
  stopMirror(id: string): Promise<void>;
};

/** 项目根有 pubspec.yaml 即 Flutter 项目。 */
function useIsFlutterProject(dir: string | undefined): boolean {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    if (!dir) { setYes(false); return; }
    let alive = true;
    (window.amc.fs.readFile(`${dir}/pubspec.yaml`) as Promise<{ ok: boolean }>)
      .then((r) => { if (alive) setYes(!!r.ok); })
      .catch(() => { if (alive) setYes(false); });
    return () => { alive = false; };
  }, [dir]);
  return yes;
}

const RESULT_TEXT = { reloaded: '已热重载', restarted: '已热重启', failed: '重载失败' } as const;

function RunStatus({ run }: { run: FlutterRun }) {
  const [, tick] = useState(0);
  const fresh = !!run.resultAt && Date.now() - run.resultAt < 2500;
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => tick((n) => n + 1), 2600);
    return () => clearTimeout(t);
  }, [fresh, run.resultAt]);
  if (run.status === 'building' || run.status === 'reloading' || run.status === 'restarting') {
    const text = run.status === 'building' ? '正在构建并安装' : run.status === 'reloading' ? '正在热重载' : '正在热重启';
    return <span className="flex items-center gap-1 text-ui-xs text-foreground-subtle"><Loader2Icon className="size-3 animate-spin text-brand" />{text}</span>;
  }
  if (run.status === 'running') {
    return (
      <span className="flex items-center gap-1.5 text-ui-xs text-foreground-subtle">
        <span className="size-1.5 rounded-full bg-success" />
        {fresh && run.result ? <span className={run.result === 'failed' ? 'text-destructive' : 'text-success'}>{RESULT_TEXT[run.result]}</span> : '运行中'}
      </span>
    );
  }
  if (run.stopped || run.code === 0) return <span className="text-ui-xs text-foreground-subtlest">已停止</span>;
  return <span className="text-ui-xs text-destructive">运行已结束{run.code != null ? `（退出码 ${run.code}）` : ''}</span>;
}

function RunLog({ run, open }: { run: FlutterRun; open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [open, run.log]);
  if (!open || !run.log.length) return null;
  return (
    <div ref={ref} className="max-h-40 overflow-y-auto rounded-md bg-surface px-2 py-1.5 font-mono text-ui-2xs leading-relaxed">
      {run.log.map((l, i) => (
        <div key={i} className={cn('whitespace-pre-wrap break-all',
          l.level === 'error' ? 'text-destructive' : l.level === 'progress' ? 'text-foreground-subtle' : 'text-foreground-subtlest')}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

/** 运行到手机：未运行 → 运行；构建中 → 停止；运行中 → 热重载 / 热重启 / 停止。 */
function RunBar({ dir, deviceId, onStarted }: { dir: string; deviceId: string | null; onStarted(id: string): void }) {
  const run = useFlutterRun((s) => s.runs[normalizeDir(dir)]);
  const { load, start, stop, reload, autoReload, setAutoReload } = useFlutterRun();
  const [err, setErr] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  useEffect(() => { void load(dir); }, [dir, load]);
  const active = !!run && run.status !== 'exited';
  const failed = !!run && run.status === 'exited' && !run.stopped && run.code !== 0;
  useEffect(() => { if (failed) setLogOpen(true); }, [failed]);
  const lastProgress = useMemo(() => {
    if (!run || run.status !== 'building') return '';
    for (let i = run.log.length - 1; i >= 0; i--) {
      const l = run.log[i];
      if (l && l.level !== 'error') return l.text;
    }
    return '';
  }, [run]);

  const doStart = async () => {
    if (!deviceId) return;
    setErr('');
    const e = await start(dir, deviceId);
    if (e) setErr(e);
    else onStarted(deviceId);
  };
  const doReload = async (full: boolean) => {
    setErr('');
    const e = await reload(dir, full);
    if (e) setErr(e);
  };

  return (
    <div className="grid gap-1.5 border-b border-border/50 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-ui-2xs font-medium uppercase tracking-wider text-foreground-subtlest">应用</span>
        {!active ? (
          <Button type="button" size="sm" variant="ghost" className="text-brand hover:bg-hover" disabled={!deviceId}
            title={deviceId ? '构建、安装并在手机上启动' : '先连接一台设备'} onClick={() => void doStart()}>
            <PlayIcon className="size-3" />运行
          </Button>
        ) : (
          <>
            {run.status !== 'building' && (
              <>
                <Button type="button" size="sm" variant="ghost" title="保留状态，替换改动的代码"
                  disabled={run.status !== 'running'} onClick={() => void doReload(false)}>
                  <ZapIcon className="size-3" />热重载
                </Button>
                <Button type="button" size="sm" variant="ghost" title="重启应用，状态清空"
                  disabled={run.status !== 'running'} onClick={() => void doReload(true)}>
                  <RotateCwIcon className="size-3" />热重启
                </Button>
              </>
            )}
            <Button type="button" size="sm" variant="ghost" className="text-foreground-subtle" onClick={() => void stop(dir)}>
              <SquareIcon className="size-3" />停止
            </Button>
          </>
        )}
        {run && <RunStatus run={run} />}
        {run && run.log.length > 0 && (
          <button type="button" onClick={() => setLogOpen((v) => !v)}
            className="ml-auto flex items-center gap-0.5 text-ui-2xs text-foreground-subtlest hover:text-foreground">
            日志<ChevronDownIcon className={cn('size-3 transition-transform', logOpen && 'rotate-180')} />
          </button>
        )}
      </div>
      {lastProgress && !logOpen && <div className="truncate pl-0.5 text-ui-2xs text-foreground-subtlest" title={lastProgress}>{lastProgress}</div>}
      {active && run.status !== 'building' && (
        <label className="flex w-fit cursor-pointer items-center gap-1.5 pl-0.5 text-ui-2xs text-foreground-subtle">
          <input type="checkbox" className="size-3 accent-[var(--color-brand)]" checked={autoReload}
            onChange={(e) => setAutoReload(e.target.checked)} />
          对话改完 Dart 代码后自动热重载
        </label>
      )}
      {err && <div className="truncate text-ui-2xs text-destructive" title={err}>{err}</div>}
      {run && <RunLog run={run} open={logOpen} />}
    </div>
  );
}

export default function DevicePanel() {
  const { project } = useApp();
  const isFlutter = useIsFlutterProject(project?.dir);
  const [devices, setDevices] = useState<Device[]>([]);
  const [adbOk, setAdbOk] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [mirroring, setMirroring] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    amcDevices.list().then((r) => {
      const ds = r.devices || [];
      setDevices(ds);
      setAdbOk(r.adbAvailable !== false);
      setSel((cur) => cur ?? ds.find((d) => d.state === 'online')?.id ?? null);
    }).catch(() => {});
    const off = amcDevices.onChanged(({ devices: ds, adbAvailable }) => {
      setDevices(ds || []);
      setAdbOk(adbAvailable !== false);
      setSel((cur) => (cur && ds.some((d) => d.id === cur) ? cur : ds.find((d) => d.state === 'online')?.id ?? null));
    });
    const offExit = amcDevices.onMirrorExited(({ deviceId, error }) => {
      setMirroring((m) => (m === deviceId ? null : m));
      if (error) setErr(error);
    });
    return () => { off(); offExit(); };
  }, []);

  const startMirror = async (id: string) => {
    setErr('');
    const r = await amcDevices.startMirror(id);
    if (r.ok) setMirroring(id);
    else setErr(r.error || '投屏启动失败');
  };
  const toggleMirror = async () => {
    if (!sel) return;
    if (mirroring === sel) {
      await amcDevices.stopMirror(sel);
      setMirroring(null);
    } else {
      await startMirror(sel);
    }
  };

  const online = devices.filter((d) => d.state === 'online');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/50 px-2 py-1.5">
        <span className="text-ui-2xs font-medium uppercase tracking-wider text-foreground-subtlest">设备</span>
        {!adbOk ? (
          <span className="text-ui-2xs text-foreground-subtlest">未找到 adb — 安装 Android 平台工具</span>
        ) : online.length === 0 && devices.length > 0 ? (
          <span className="text-ui-2xs text-foreground-subtlest">
            设备待授权/离线 — 在手机上允许「USB 调试」，或重新插拔
          </span>
        ) : online.length === 0 ? (
          <span className="text-ui-2xs text-foreground-subtlest">未检测到设备 — 插入手机（开 USB 调试）或启动模拟器</span>
        ) : (
          <select value={sel || ''} onChange={(e) => setSel(e.target.value)}
            className="min-w-0 max-w-40 rounded-md border border-border bg-input px-1.5 py-0.5 text-ui-xs text-foreground outline-none">
            {online.map((d) => (
              <option key={d.id} value={d.id}>
                {d.model || d.id}{d.transport === 'wifi' ? ' · WiFi' : ''}
              </option>
            ))}
          </select>
        )}
        {online.length > 0 && (
          <Button type="button" variant="ghost" size="sm"
            className={mirroring ? 'text-foreground-subtle hover:bg-hover' : 'text-brand hover:bg-hover'}
            onClick={() => void toggleMirror()} disabled={!sel}>
            {mirroring ? <><SquareIcon className="size-3" />停止投屏</> : <><CastIcon className="size-3" />投屏</>}
          </Button>
        )}
        {err && <span className="max-w-full truncate text-ui-2xs text-destructive" title={err}>{err.slice(0, 80)}</span>}
      </div>
      {isFlutter && project && (
        <RunBar dir={project.dir} deviceId={sel && online.some((d) => d.id === sel) ? sel : null}
          onStarted={(id) => { if (!mirroring) void startMirror(id); }} />
      )}
      <div className="min-h-0 flex-1 p-2">
        {mirroring ? (
          <div className="mx-auto h-full max-w-sm overflow-hidden rounded-xl border border-border bg-black">
            <MirrorCanvas deviceId={mirroring} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <SmartphoneIcon className="size-8 text-foreground-subtlest" />
            <div className="text-ui-sm text-foreground-subtle">手机实时预览</div>
            <div className="text-ui-2xs text-foreground-subtlest">
              {isFlutter ? '点「运行」装到手机并自动投屏，可直接操作' : '投屏后此处显示设备画面，可直接操作'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
