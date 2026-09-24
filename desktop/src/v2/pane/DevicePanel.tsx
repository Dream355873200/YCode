// 设备面板（自 legacy DevicePanel 移植，槽位消费方）：adb 自动检测、
// scrcpy 投屏（可直接操作 + Android Studio 式设备控制条）。
// IPC 全走主进程既有通道（devices.*），此层纯视图。
import { useEffect, useState } from 'react';
import { SmartphoneIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import MirrorCanvas from './mirror/MirrorCanvas';

interface Device { id: string; model?: string; state: string; transport?: string }

const amcDevices = window.amc.devices as unknown as {
  list(): Promise<{ devices: Device[]; adbAvailable?: boolean }>;
  onChanged(cb: (p: { devices: Device[]; adbAvailable?: boolean }) => void): () => void;
  onMirrorExited(cb: (p: { deviceId: string; error?: string }) => void): () => void;
  startMirror(id: string): Promise<{ ok: boolean; error?: string }>;
  stopMirror(id: string): Promise<void>;
};

export default function DevicePanel() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [adbOk, setAdbOk] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [mirroring, setMirroring] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    amcDevices.list().then((r) => {
      setDevices(r.devices || []);
      setAdbOk(r.adbAvailable !== false);
    }).catch(() => {});
    const off = amcDevices.onChanged(({ devices: ds, adbAvailable }) => {
      setDevices(ds || []);
      setAdbOk(adbAvailable !== false);
      setSel((cur) => (cur && ds.some((d) => d.id === cur) ? cur : (ds[0] && ds[0].id) || null));
    });
    const offExit = amcDevices.onMirrorExited(({ deviceId, error }) => {
      setMirroring((m) => (m === deviceId ? null : m));
      if (error) setErr(error);
    });
    return () => { off(); offExit(); };
  }, []);

  const toggleMirror = async () => {
    if (!sel) return;
    setErr('');
    if (mirroring === sel) {
      await amcDevices.stopMirror(sel);
      setMirroring(null);
    } else {
      const r = await amcDevices.startMirror(sel);
      if (r.ok) setMirroring(sel);
      else setErr(r.error || '投屏启动失败');
    }
  };

  const online = devices.filter((d) => d.state === 'online');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 设备操作栏 */}
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
            {mirroring ? '⏹ 停止投屏' : '▶ 投屏'}
          </Button>
        )}
        {err && <span className="max-w-full truncate text-ui-2xs text-destructive" title={err}>{err.slice(0, 80)}</span>}
      </div>
      {/* 投屏区：未投屏提示卡 / MirrorCanvas（可直接操作 + 设备控制条） */}
      <div className="min-h-0 flex-1 p-2">
        {mirroring ? (
          <div className="mx-auto h-full max-w-sm overflow-hidden rounded-xl border border-border bg-black">
            <MirrorCanvas deviceId={mirroring} />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <SmartphoneIcon className="size-8 text-foreground-subtlest" />
            <div className="text-ui-sm text-foreground-subtle">手机实时预览</div>
            <div className="text-ui-2xs text-foreground-subtlest">投屏后此处显示设备画面，可直接操作</div>
          </div>
        )}
      </div>
    </div>
  );
}
