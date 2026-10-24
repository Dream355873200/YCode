import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Player, type PlayerRef } from "@remotion/player";
import { Film, project } from "./studio/film";

// 浏览器预览入口（模板固定）：后端把工作区打包成单文件，由前端放进隔离 iframe 运行。
// 与宿主页面只经 postMessage 通信——宿主发播放控制，本页回报就绪/帧号/播放状态/错误。

type HostMessage =
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "seek"; frame: number }
  | { type: "setRange"; range: [number, number] | null }
  | { type: "setLoop"; loop: boolean }
  | { type: "setMuted"; muted: boolean }
  | { type: "setRate"; rate: number };

interface InitState {
  frame?: number;
  muted?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
}

const init: InitState = (window as unknown as { __STUDIO_INIT__?: InitState }).__STUDIO_INIT__ ?? {};

const post = (msg: Record<string, unknown>) => {
  try {
    window.parent?.postMessage({ source: "studio-player", ...msg }, "*");
  } catch {
    /* 宿主不可达时静默 */
  }
};

(window as unknown as { __studioReportError?: (e: { sceneId?: string; message: string; stack?: string }) => void }).__studioReportError = (e) =>
  post({ type: "error", ...e });
window.addEventListener("error", (e) => post({ type: "error", message: e.message, stack: e.error?.stack }));
window.addEventListener("unhandledrejection", (e) => post({ type: "error", message: String((e.reason && e.reason.message) || e.reason) }));

const ErrorFallback = ({ error }: { error: Error }) => (
  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "6%", background: "#14080A", color: "#FCA5A5", fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}>
    <div style={{ fontSize: 18, color: "#F87171", marginBottom: 12 }}>预览运行出错</div>
    <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{error.message}</div>
  </div>
);

const App: React.FC = () => {
  const ref = useRef<PlayerRef>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [loop, setLoop] = useState(init.loop ?? false);
  const [rate, setRate] = useState(1);
  const lastPosted = useRef(-1);

  const info = useMemo(
    () => ({
      title: project.title,
      durationInFrames: project.durationInFrames,
      fps: project.fps,
      width: project.width,
      height: project.height,
      theme: { background: project.theme.palette.background, primary: project.theme.palette.primary, mode: project.theme.mode },
      scenes: project.scenes.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        component: s.component,
        from: s.from,
        durationInFrames: s.durationInFrames,
        transition: s.transition,
      })),
    }),
    [],
  );

  const postFrame = useCallback((frame: number) => {
    if (frame === lastPosted.current) return;
    lastPosted.current = frame;
    post({ type: "frame", frame });
  }, []);

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => postFrame(e.detail.frame);
    const onPlay = () => post({ type: "state", playing: true });
    const onPause = () => post({ type: "state", playing: false });
    const onEnded = () => post({ type: "ended" });
    const onError = (e: { detail: { error: Error } }) => post({ type: "error", message: e.detail.error.message, stack: e.detail.error.stack });
    const onMute = (e: { detail: { isMuted: boolean } }) => post({ type: "muted", muted: e.detail.isMuted });
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("seeked", onFrame);
    p.addEventListener("play", onPlay);
    p.addEventListener("pause", onPause);
    p.addEventListener("ended", onEnded);
    p.addEventListener("error", onError);
    p.addEventListener("mutechange", onMute);
    if (init.frame && init.frame > 0) p.seekTo(Math.min(init.frame, project.durationInFrames - 1));
    if (init.muted) p.mute();
    post({ type: "ready", info, frame: p.getCurrentFrame() });
    if (init.autoPlay) p.play();
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("seeked", onFrame);
      p.removeEventListener("play", onPlay);
      p.removeEventListener("pause", onPause);
      p.removeEventListener("ended", onEnded);
      p.removeEventListener("error", onError);
      p.removeEventListener("mutechange", onMute);
    };
  }, [info, postFrame]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const m = e.data as HostMessage & { source?: string };
      if (!m || m.source !== "studio-host") return;
      const p = ref.current;
      if (!p) return;
      switch (m.type) {
        case "play":
          p.play();
          break;
        case "pause":
          p.pause();
          break;
        case "toggle":
          p.toggle();
          break;
        case "seek":
          p.seekTo(Math.max(0, Math.min(project.durationInFrames - 1, Math.round(m.frame))));
          break;
        case "setRange":
          setRange(m.range);
          if (m.range) p.seekTo(m.range[0]);
          break;
        case "setLoop":
          setLoop(m.loop);
          break;
        case "setMuted":
          if (m.muted) p.mute();
          else p.unmute();
          break;
        case "setRate":
          setRate(m.rate);
          break;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const p = ref.current;
      if (!p) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? project.fps : 1;
        const next = p.getCurrentFrame() + (e.key === "ArrowLeft" ? -step : step);
        p.seekTo(Math.max(0, Math.min(project.durationInFrames - 1, next)));
      }
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <Player
      ref={ref}
      component={Film}
      durationInFrames={project.durationInFrames}
      fps={project.fps}
      compositionWidth={project.width}
      compositionHeight={project.height}
      style={{ width: "100%", height: "100%" }}
      controls={false}
      clickToPlay
      doubleClickToFullscreen
      spaceKeyToPlayOrPause
      loop={loop}
      playbackRate={rate}
      inFrame={range ? range[0] : null}
      outFrame={range ? range[1] : null}
      moveToBeginningWhenEnded={false}
      initialFrame={init.frame && init.frame > 0 ? Math.min(init.frame, project.durationInFrames - 1) : 0}
      errorFallback={ErrorFallback}
      numberOfSharedAudioTags={8}
    />
  );
};

const el = document.getElementById("root");
if (el) createRoot(el).render(<App />);
