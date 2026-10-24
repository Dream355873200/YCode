// VideoPreviewPanel — 视频工坊预览面板（插件 sidePanel）：自动发现工程
// out/ 下的渲染产物（film / preview / renders，新→旧），内嵌播放；AI 渲染
// 完成（文件落盘）后 2.5s 内自动出现并刷新正在看的那个。视频经 base64
// dataURL 播放（dev 下页面是 http 源，直接引 file:// 会被拦）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLinkIcon, FileVideoIcon, Loader2Icon } from 'lucide-react';
import { useApp } from '../app/appState';
import { cn } from '../components/lib/utils';

interface VideoArtifact { path: string; name: string; mtimeMs: number; size: number }

const fmtSize = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const labelOf = (v: VideoArtifact): string => (v.name === 'film.mp4' ? '成片' : v.name === 'preview.mp4' ? '预览' : v.name);

export default function VideoPreviewPanel() {
  const { project } = useApp();
  const dir = project?.dir ?? '';
  const [videos, setVideos] = useState<VideoArtifact[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const stampsRef = useRef<Map<string, number>>(new Map());

  const open = useCallback(async (v: VideoArtifact): Promise<void> => {
    setActive(v.path);
    setLoading(true);
    setSrc(null);
    const r = await window.amc.fs.readFileBase64(v.path).catch(() => null);
    const b64 = (r as { ok: boolean; b64?: string } | null)?.b64;
    if (b64) setSrc(`data:video/mp4;base64,${b64}`);
    setLoading(false);
  }, []);

  // 轮询产物清单；正在看的文件被重新渲染（mtime 变化）时自动重载
  useEffect(() => {
    if (!dir) return;
    let alive = true;
    const load = async (): Promise<void> => {
      const r = await window.amc.fs.videoArtifacts(dir).catch(() => null);
      if (!alive || !r) return;
      setVideos(r.videos);
      if (active) {
        const cur = r.videos.find((v) => v.path === active);
        if (!cur) { setActive(null); setSrc(null); return; }
        if (stampsRef.current.get(active) !== cur.mtimeMs) void open(cur);
      }
      for (const v of r.videos) stampsRef.current.set(v.path, v.mtimeMs);
    };
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => { alive = false; clearInterval(t); };
  }, [dir, active, open]);

  // 清单首次到达：自动选中最新一个
  useEffect(() => {
    if (!active && videos && videos.length > 0 && videos[0]) void open(videos[0]);
  }, [videos, active, open]);

  if (!dir) {
    return <div className="p-6 text-center text-ui-sm text-foreground-subtlest">选择视频项目后查看预览</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-neutral-950">
        {src ? (
          <video key={active ?? ''} src={src} controls className="max-h-full max-w-full" />
        ) : loading ? (
          <Loader2Icon className="size-5 animate-spin text-neutral-500" />
        ) : (
          <div className="px-6 py-8 text-center text-ui-sm leading-relaxed text-neutral-500">
            还没有渲染产物<br />
            <span className="text-neutral-600">让 AI 渲染预览或导出成片，画面会自动出现在这里</span>
          </div>
        )}
      </div>
      {videos && videos.length > 0 && (
        <div className="max-h-44 shrink-0 overflow-y-auto border-t border-border/60 p-1.5">
          {videos.map((v) => (
            <div key={v.path}
              className={cn('group flex min-h-8 items-center gap-2 rounded-lg px-2 py-1 text-ui-sm',
                active === v.path ? 'bg-selected text-foreground' : 'text-foreground-subtle hover:bg-hover')}>
              <button type="button" onClick={() => void open(v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <FileVideoIcon className="size-3.5 shrink-0 text-foreground-subtlest" />
                <span className="min-w-0 flex-1 truncate">{labelOf(v)}</span>
                <span className="shrink-0 tabular-nums text-ui-xs text-foreground-subtlest">{fmtSize(v.size)}</span>
              </button>
              <button type="button" aria-label="用系统播放器打开" title="用系统播放器打开"
                className="shrink-0 rounded p-1 text-foreground-subtlest opacity-0 hover:bg-hover hover:text-foreground group-hover:opacity-100"
                onClick={() => { void window.amc.projects.reveal(v.path); }}>
                <ExternalLinkIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
