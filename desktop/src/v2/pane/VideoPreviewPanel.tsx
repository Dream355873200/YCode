// VideoPreviewPanel — 视频工坊预览面板（插件 sidePanel）：
//   分镜条（每场景缩略图 + 标题 + 时长 + 转场，宽度按帧数占比，点击跳播到场景开头）
//   + 视频播放器（out/ 渲染产物，AI 渲染落盘后自动出现/自动重载）
//   + 产物列表。
// 数据全部来自工程目录轮询：manifest.json（场景结构）、out/thumbs（缩略图，
// 智能体跑 render_thumbs 生成）、out/*.mp4（渲染产物）。缩略图经 readImage
// dataURL（dev 下 http 源引 file:// 会被拦）；视频经 base64 dataURL。
import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLinkIcon, FileVideoIcon, Loader2Icon } from 'lucide-react';
import { useApp } from '../app/appState';
import { cn } from '../components/lib/utils';

interface VideoArtifact { path: string; name: string; mtimeMs: number; size: number }
interface ThumbMeta { id: string; path: string; mtimeMs: number }
interface Scene {
  id: string; title: string; from: number; duration: number; fps: number;
  transition: string | null;
}

const fmtSize = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDur = (frames: number, fps: number): string => `${(frames / fps).toFixed(1)}s`;
const labelOf = (v: VideoArtifact): string => (v.name === 'film.mp4' ? '成片' : v.name === 'preview.mp4' ? '预览' : v.name);

// manifest → 场景时间线（与 server 端同一套归一化的前端子集）
function parseManifest(raw: string): Scene[] {
  let mf: {
    format?: { fps?: number }; fps?: number;
    scenes?: Array<{ id?: string; title?: string; duration?: number | string; transition?: unknown }>;
  };
  try { mf = JSON.parse(raw); } catch { return []; }
  const fps = mf.format?.fps ?? mf.fps ?? 30;
  const parseDur = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
    if (typeof v === 'string') {
      const m = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|秒)?\s*$/.exec(v);
      if (m) return m[2] ? Math.round(parseFloat(m[1] ?? '0') * fps) : Math.round(parseFloat(m[1] ?? '0'));
    }
    return Math.round(fps * 4);
  };
  const transDur = (t: unknown): number | null => {
    if (!t || t === 'none') return null;
    const spec = typeof t === 'string' ? { type: t } : (t as { type?: string; duration?: number | string });
    if (!spec.type) return null;
    return typeof spec.duration !== 'undefined' ? parseDur(spec.duration) : Math.round(fps * 0.5);
  };
  let from = 0;
  return (mf.scenes || []).map((sc, index) => {
    const duration = parseDur(sc.duration);
    const transition = index > 0 ? transDur(sc.transition) : null;
    const scene: Scene = {
      id: sc.id || `scene_${index + 1}`,
      title: sc.title || sc.id || `场景 ${index + 1}`,
      from, duration, fps, transition: typeof sc.transition === 'string' ? sc.transition : (sc.transition as { type?: string } | null)?.type ?? null,
    };
    from += duration - (transition ?? 0);
    return scene;
  });
}

export default function VideoPreviewPanel() {
  const { project } = useApp();
  const dir = project?.dir ?? '';
  const [videos, setVideos] = useState<VideoArtifact[] | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [thumbs, setThumbs] = useState<Map<string, string>>(new Map()); // 场景id → dataURL
  const [active, setActive] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stampsRef = useRef<Map<string, number>>(new Map()); // path/mtime 缓存：mp4 与缩略图共用
  const videoMtimeRef = useRef<Map<string, number>>(new Map());

  const open = useCallback(async (v: VideoArtifact): Promise<void> => {
    setActive(v.path);
    setLoading(true);
    setSrc(null);
    const r = await window.amc.fs.readFileBase64(v.path).catch(() => null);
    const b64 = (r as { ok: boolean; b64?: string } | null)?.b64;
    if (b64) setSrc(`data:video/mp4;base64,${b64}`);
    setLoading(false);
  }, []);

  // 轮询：产物清单 + manifest + 缩略图；正在看的 mp4 / 已加载的缩略图被重新
  // 渲染（mtime 变化）时自动重载
  useEffect(() => {
    if (!dir) return;
    let alive = true;
    const load = async (): Promise<void> => {
      const r = await window.amc.fs.videoArtifacts(dir).catch(() => null);
      if (!alive || !r) return;
      setVideos(r.videos);
      if (active) {
        const cur = r.videos.find((v) => v.path === active);
        if (!cur) { setActive(null); setSrc(null); }
        else if (videoMtimeRef.current.get(active) !== cur.mtimeMs) void open(cur);
      }
      videoMtimeRef.current = new Map(r.videos.map((v) => [v.path, v.mtimeMs]));

      const mr = await window.amc.fs.readFile(`${dir}\\src\\scenes\\manifest.json`).catch(() => null);
      const content = (mr as { ok: boolean; content?: string } | null)?.content;
      if (alive && content) setScenes(parseManifest(content));

      const next = new Map(thumbs);
      let changed = false;
      for (const t of r.thumbs) {
        if (stampsRef.current.get(t.path) === t.mtimeMs && next.has(t.id)) continue;
        const img = await window.amc.fs.readImage(t.path).catch(() => null);
        const url = (img as { ok: boolean; dataUrl?: string } | null)?.dataUrl;
        if (alive && url) { next.set(t.id, url); changed = true; }
        stampsRef.current.set(t.path, t.mtimeMs);
      }
      const valid = new Set(r.thumbs.map((t) => t.id));
      for (const id of [...next.keys()]) if (!valid.has(id)) { next.delete(id); changed = true; }
      if (alive && changed) setThumbs(new Map(next));
    };
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => { alive = false; clearInterval(t); };
  }, [dir, active, open, thumbs]);

  // 清单首次到达：自动选中最新一个
  useEffect(() => {
    if (!active && videos && videos.length > 0 && videos[0]) void open(videos[0]);
  }, [videos, active, open]);

  const seekScene = (sc: Scene): void => {
    if (!src || !videoRef.current) return;
    videoRef.current.currentTime = sc.from / sc.fps;
    void videoRef.current.play().catch(() => {});
  };

  if (!dir) {
    return <div className="p-6 text-center text-ui-sm text-foreground-subtlest">选择视频项目后查看预览</div>;
  }
  const totalDuration = scenes.reduce((n, s) => n + s.duration, 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 分镜条：有场景结构就展示（缩略图由 AI 跑 render_thumbs 生成） */}
      {scenes.length > 0 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/60 p-1.5 [scrollbar-width:thin]">
          {scenes.map((sc) => (
            <button key={sc.id} type="button"
              title={`${sc.title} · ${fmtDur(sc.duration, sc.fps)}${sc.transition ? ` · 转场 ${sc.transition}` : ''} · 点击跳播`}
              onClick={() => seekScene(sc)}
              className="group relative shrink-0 grow basis-24 overflow-hidden rounded-lg border border-border bg-surface text-left transition-colors hover:border-brand/50"
              style={{ flexGrow: Math.max(1, sc.duration) }}>
              {thumbs.get(sc.id) ? (
                <img src={thumbs.get(sc.id)} alt={sc.title} className="h-16 w-full object-cover" />
              ) : (
                <div className="flex h-16 w-full items-center justify-center text-ui-xs text-foreground-subtlest">{sc.id}</div>
              )}
              <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-0.5 pt-2">
                <span className="min-w-0 flex-1 truncate text-ui-xs text-white">{sc.title}</span>
                <span className="shrink-0 tabular-nums text-ui-xs text-white/70">{fmtDur(sc.duration, sc.fps)}</span>
              </span>
              {sc.transition && (
                <span className="absolute left-0 top-0 rounded-br-md bg-brand/85 px-1 text-ui-xs text-white">{sc.transition}</span>
              )}
            </button>
          ))}
          {totalDuration > 0 && (
            <span className="shrink-0 self-center whitespace-nowrap px-1 text-ui-xs tabular-nums text-foreground-subtlest">
              {fmtDur(totalDuration, scenes[0]?.fps ?? 30)}
            </span>
          )}
        </div>
      )}
      {/* 播放器 */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-neutral-950">
        {src ? (
          <video ref={videoRef} key={active ?? ''} src={src} controls className="max-h-full max-w-full" />
        ) : loading ? (
          <Loader2Icon className="size-5 animate-spin text-neutral-500" />
        ) : (
          <div className="px-6 py-8 text-center text-ui-sm leading-relaxed text-neutral-500">
            还没有渲染产物<br />
            <span className="text-neutral-600">让 AI 渲染预览或导出成片，画面会自动出现在这里</span>
          </div>
        )}
      </div>
      {/* 产物列表 */}
      {videos && videos.length > 0 && (
        <div className="max-h-36 shrink-0 overflow-y-auto border-t border-border/60 p-1.5">
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
