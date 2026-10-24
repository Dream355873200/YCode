import React, { useEffect, useState } from "react";
import { AbsoluteFill, Sequence, continueRender, delayRender, getRemotionEnvironment } from "remotion";
import { TransitionSeries } from "@remotion/transitions";
import "./fonts";
import { buildProject, type Manifest, type NormalizedScene, type Project } from "./manifest";
import type { SceneProps } from "./props";
import { FONT_FAMILY, ThemeProvider, alpha, fontFamily, type Theme } from "./theme";
import { Music, Voice } from "./kit/audio";
import { VideoClip } from "./kit/media";
import { Captions, FilmProgress, Watermark } from "./kit/overlays";
import { presentationFor, timingFor } from "./kit/transitions";
import manifestJson from "../scenes/manifest.json";
import { registry } from "./registry.gen";

// 整片时间线：manifest → TransitionSeries（场景 + 转场）+ 配音 + 背景音乐（人声闪避）
// + 字幕/水印/进度条覆盖层。渲染（Root.tsx）与浏览器预览（player.tsx）共用这一份，
// 预览所见即成片所得。

export const project: Project = buildProject(manifestJson as unknown as Manifest);

const isRendering = (): boolean => {
  try {
    return getRemotionEnvironment().isRendering;
  } catch {
    return false;
  }
};

/** 预加载主题用到的字体（含中文回落 Noto Sans SC）；渲染期 delayRender 直到加载完成 */
const useFontsReady = (theme: Theme) => {
  const [handle] = useState(() => (isRendering() ? delayRender("加载主题字体") : null));
  useEffect(() => {
    if (typeof document === "undefined" || !("fonts" in document)) {
      if (handle !== null) continueRender(handle);
      return;
    }
    const wanted = new Set(
      [theme.fonts.heading, theme.fonts.body, theme.fonts.mono, "Noto Sans SC" as const]
        .map((n) => FONT_FAMILY[n].split(",")[0].replace(/"/g, "").trim()),
    );
    const faces: FontFace[] = [];
    document.fonts.forEach((f) => {
      if (wanted.has(f.family.replace(/["']/g, ""))) faces.push(f);
    });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (handle !== null) continueRender(handle);
    };
    const timer = setTimeout(finish, 20000);
    Promise.allSettled(faces.map((f) => f.load())).then(() => {
      clearTimeout(timer);
      finish();
    });
    return () => clearTimeout(timer);
  }, [handle, theme]);
};

/** 场景错误边界：预览中单个场景出错只影响该场景（渲染期不拦截，错误交给渲染器上报） */
class SceneErrorBoundary extends React.Component<
  { sceneId: string; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    const w = window as unknown as { __studioReportError?: (e: { sceneId: string; message: string; stack?: string }) => void };
    w.__studioReportError?.({ sceneId: this.props.sceneId, message: error.message, stack: error.stack });
  }
  render() {
    if (this.state.error) {
      return (
        <AbsoluteFill style={{ background: "#1A0B0E", color: "#FCA5A5", padding: 80, justifyContent: "center", fontFamily: fontFamily("JetBrains Mono") }}>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#F87171", marginBottom: 24 }}>场景 {this.props.sceneId} 运行出错</div>
          <div style={{ fontSize: 28, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{this.state.error.message}</div>
        </AbsoluteFill>
      );
    }
    return this.props.children;
  }
}

const MissingScene: React.FC<{ scene: NormalizedScene; theme: Theme }> = ({ scene, theme }) => (
  <AbsoluteFill
    style={{
      background: `repeating-linear-gradient(135deg, ${theme.palette.background}, ${theme.palette.background} 40px, ${alpha(theme.palette.text, 0.03)} 40px, ${alpha(theme.palette.text, 0.03)} 80px)`,
      justifyContent: "center",
      alignItems: "center",
      color: theme.palette.muted,
      fontFamily: fontFamily(theme.fonts.body),
      gap: 24,
    }}
  >
    <div style={{ fontSize: 30, letterSpacing: "0.2em", textTransform: "uppercase", color: alpha(theme.palette.text, 0.4) }}>Scene {scene.index + 1}</div>
    <div style={{ fontSize: 64, fontWeight: 700, color: theme.palette.text }}>{scene.title}</div>
    <div style={{ fontSize: 28 }}>{scene.type === "video" ? "视频素材未就绪" : `组件 src/scenes/${scene.component} 尚未编写`}</div>
  </AbsoluteFill>
);

const scenePropsOf = (s: NormalizedScene, p: Project): SceneProps => {
  const raw = s.raw as Record<string, unknown>;
  return {
    ...(raw as object),
    id: s.id,
    index: s.index,
    title: s.title,
    durationInFrames: s.durationInFrames,
    fps: p.fps,
    width: p.width,
    height: p.height,
    theme: p.theme,
    palette: p.theme.palette,
    data: s.data,
    voiceover: s.voiceover ? { text: s.voiceover.text, src: s.voiceover.src, delay: s.voiceover.delay } : undefined,
    narration: s.voiceover?.text,
    characters: (raw.characters as SceneProps["characters"]) ?? [],
    dialogues: raw.dialogues as SceneProps["dialogues"],
    assets: raw.assets as SceneProps["assets"],
    scene: s.raw,
  } as SceneProps;
};

/** 单个场景的画面（组件 / 视频素材 / 占位） */
export const SceneBody: React.FC<{ scene: NormalizedScene }> = ({ scene }) => {
  const Comp = registry[scene.component];
  const props = scenePropsOf(scene, project);
  let body: React.ReactNode;
  if (scene.type === "video") {
    body = scene.video ? (
      <>
        <VideoClip src={scene.video.src} fit={scene.video.fit} trimStart={scene.video.trimStart} volume={scene.video.volume ?? 1} />
        {Comp ? <Comp {...props} /> : null}
      </>
    ) : (
      <MissingScene scene={scene} theme={project.theme} />
    );
  } else {
    body = Comp ? <Comp {...props} /> : <MissingScene scene={scene} theme={project.theme} />;
  }
  return isRendering() ? <>{body}</> : <SceneErrorBoundary sceneId={scene.id}>{body}</SceneErrorBoundary>;
};

/** 场景的配音与字幕（相对场景起点） */
const SceneVoice: React.FC<{ scene: NormalizedScene }> = ({ scene }) => {
  const vo = scene.voiceover;
  if (!vo) return null;
  return (
    <>
      {vo.src ? <Voice src={vo.src} from={vo.delay} volume={vo.volume ?? 1} /> : null}
      {scene.captions && vo.text && project.captions ? (
        <Sequence from={vo.delay} durationInFrames={vo.duration} layout="none">
          <Captions text={vo.text} style={project.captions.style} position={project.captions.position} />
        </Sequence>
      ) : null}
    </>
  );
};

const FilmFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = project.theme;
  useFontsReady(theme);
  return (
    <ThemeProvider theme={theme}>
      <AbsoluteFill
        style={{
          background: theme.palette.background,
          color: theme.palette.text,
          fontFamily: fontFamily(theme.fonts.body),
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <style>{`svg text { font-family: inherit; }`}</style>
        {children}
      </AbsoluteFill>
    </ThemeProvider>
  );
};

/** 整片 */
export const Film: React.FC = () => {
  const p = project;
  const duckRanges: [number, number][] = p.scenes
    .filter((s) => s.voiceover?.src)
    .map((s) => [s.from + (s.voiceover?.delay ?? 0), s.from + (s.voiceover?.delay ?? 0) + (s.voiceover?.duration ?? s.durationInFrames)]);
  return (
    <FilmFrame>
      <TransitionSeries>
        {p.scenes.flatMap((s) => {
          const items: React.ReactNode[] = [];
          if (s.transition) {
            items.push(
              <TransitionSeries.Transition
                key={`t-${s.id}`}
                presentation={presentationFor(s.transition.type, s.transition.direction, { width: p.width, height: p.height })}
                timing={timingFor(s.transition.duration)}
              />,
            );
          }
          items.push(
            <TransitionSeries.Sequence key={s.id} durationInFrames={s.durationInFrames} name={s.title}>
              <SceneBody scene={s} />
            </TransitionSeries.Sequence>,
          );
          return items;
        })}
      </TransitionSeries>
      {p.scenes.map((s) =>
        s.voiceover ? (
          <Sequence key={`vo-${s.id}`} from={s.from} durationInFrames={s.durationInFrames} layout="none" name={`配音 ${s.title}`}>
            <SceneVoice scene={s} />
          </Sequence>
        ) : null,
      )}
      {p.music ? (
        <Music
          src={p.music.src}
          volume={p.music.volume}
          fadeIn={p.music.fadeIn}
          fadeOut={p.music.fadeOut}
          duck={p.music.duck}
          duckRanges={duckRanges}
          startFrom={p.music.startFrom}
          loop={p.music.loop}
        />
      ) : null}
      {p.watermark ? <Watermark {...p.watermark} /> : null}
      {p.progress ? <FilmProgress /> : null}
    </FilmFrame>
  );
};

/** 单场景合成（场景预览 / 场景抽帧用）：场景画面 + 本场景配音字幕 */
export const SceneComposition: React.FC<{ sceneId: string }> = ({ sceneId }) => {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  return (
    <FilmFrame>
      <SceneBody scene={scene} />
      <SceneVoice scene={scene} />
      {project.watermark ? <Watermark {...project.watermark} /> : null}
    </FilmFrame>
  );
};
