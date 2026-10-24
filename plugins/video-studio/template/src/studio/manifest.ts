import { staticFile } from "remotion";
import { resolveTheme, type Theme, type ThemeInput } from "./theme";

// manifest.json 的类型与归一化：场景清单是整片的「剪辑表」——顺序、时长、转场、配音、字幕、
// 背景音乐都在这里声明，film.tsx 按它搭时间线。兼容 v1 字段（fps/width/height/palette/
// durationInFrames/renderer/narration/videoUrl），老工作区无需迁移。

export type TransitionType = "none" | "fade" | "slide" | "wipe" | "flip" | "clock-wipe" | "zoom" | "blur";
export type Direction = "from-left" | "from-right" | "from-top" | "from-bottom";

export interface TransitionSpec {
  type: TransitionType;
  /** 转场时长（帧）；缺省 0.5 秒 */
  duration?: number;
  direction?: Direction;
}

export interface VoiceoverSpec {
  /** public/ 下的音频路径（如 audio/vo_intro.mp3）或 http(s) URL */
  src?: string;
  /** 配音文案（同时作为字幕文本） */
  text?: string;
  /** 相对场景开头的延迟帧数 */
  delay?: number;
  /** 配音时长（帧或 "3.2s"）：字幕铺满与音乐闪避的区间；缺省到场景结束 */
  duration?: number | string;
  volume?: number;
}

export interface VideoSpec {
  /** public/ 下的视频路径（clips/xxx.mp4 / uploads/xxx.mp4）或 http(s) URL */
  src: string;
  /** 从素材第几帧开始取 */
  trimStart?: number;
  volume?: number;
  fit?: "cover" | "contain";
}

export interface ManifestScene {
  id: string;
  title?: string;
  /** code：场景组件（默认）；video：直接播放一段视频素材 */
  type?: "code" | "video";
  /** src/scenes/ 下的组件文件名，缺省 `${id}.tsx` */
  component?: string;
  /** 时长：帧数，或 "4s" / "4.5s" 这样的秒数字符串 */
  duration?: number | string;
  /** 进入本场景的转场（第一个场景忽略） */
  transition?: TransitionType | TransitionSpec;
  voiceover?: VoiceoverSpec;
  /** 本场景是否显示配音字幕（缺省跟随 overlays.captions） */
  captions?: boolean;
  /** 场景数据：组件经 props.data 读取（文案/数字/列表与表现分离） */
  data?: Record<string, unknown>;
  /** type=video 时的素材 */
  video?: VideoSpec;
  /** 场景内段落标记（只用于编辑器时间线显示）：at 相对场景起点，帧数或 "8s" */
  marks?: { at: number | string; label: string }[];
  // ---- v1 兼容字段 ----
  durationInFrames?: number;
  durationInSeconds?: number;
  renderer?: string;
  narration?: string;
  videoUrl?: string;
  [key: string]: unknown;
}

export interface MusicSpec {
  src: string;
  /** 基础音量 0-1，缺省 0.5 */
  volume?: number;
  /** 淡入/淡出帧数，缺省 1s / 1.5s */
  fadeIn?: number;
  fadeOut?: number;
  /** 有配音时音乐压低到的比例，缺省 0.35；1 = 不闪避 */
  duck?: number;
  /** 从音乐第几帧开始播 */
  startFrom?: number;
  loop?: boolean;
}

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface CaptionSpec {
  style?: "bar" | "outline" | "minimal";
  position?: "bottom" | "top";
}

export interface WatermarkSpec {
  text?: string;
  /** public/ 下的 logo 图片路径 */
  logo?: string;
  position?: Corner;
  opacity?: number;
}

export interface Manifest {
  version?: number;
  title?: string;
  format?: { width?: number; height?: number; fps?: number };
  theme?: ThemeInput;
  audio?: { music?: MusicSpec };
  overlays?: {
    captions?: boolean | CaptionSpec;
    watermark?: WatermarkSpec;
    /** 底部整片进度条 */
    progress?: boolean;
  };
  scenes: ManifestScene[];
  // ---- v1 兼容字段 ----
  fps?: number;
  width?: number;
  height?: number;
  palette?: Record<string, string>;
  [key: string]: unknown;
}

export interface NormalizedScene {
  id: string;
  index: number;
  title: string;
  type: "code" | "video";
  component: string;
  durationInFrames: number;
  /** 进入本场景的转场（已按前后场景时长钳制）；第一个场景为 null */
  transition: { type: TransitionType; duration: number; direction: Direction } | null;
  /** 本场景在整片中的起始帧（已扣除转场重叠） */
  from: number;
  voiceover: (Omit<VoiceoverSpec, "duration"> & { delay: number; duration: number }) | null;
  captions: boolean;
  data: Record<string, unknown>;
  video: VideoSpec | null;
  /** 原始场景项（v1 组件读取自定义字段用） */
  raw: ManifestScene;
}

export interface Project {
  title: string;
  width: number;
  height: number;
  fps: number;
  theme: Theme;
  scenes: NormalizedScene[];
  durationInFrames: number;
  music: (Required<Omit<MusicSpec, "loop">> & { loop: boolean }) | null;
  captions: Required<CaptionSpec> | null;
  watermark: WatermarkSpec | null;
  progress: boolean;
}

const parseDuration = (v: unknown, fps: number): number | null => {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === "string") {
    const m = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|秒)?\s*$/.exec(v);
    if (m) return m[2] ? Math.round(parseFloat(m[1]) * fps) : Math.round(parseFloat(m[1]));
  }
  return null;
};

const TRANSITION_TYPES: TransitionType[] = ["none", "fade", "slide", "wipe", "flip", "clock-wipe", "zoom", "blur"];

const normalizeTransition = (
  t: ManifestScene["transition"],
  fps: number,
): { type: TransitionType; duration: number; direction: Direction } | null => {
  if (!t) return null;
  const spec: TransitionSpec = typeof t === "string" ? { type: t } : t;
  if (!TRANSITION_TYPES.includes(spec.type) || spec.type === "none") return null;
  const duration = parseDuration(spec.duration, fps) ?? Math.round(fps * 0.5);
  return { type: spec.type, duration, direction: spec.direction ?? "from-right" };
};

/** public/ 素材路径 → 可加载 URL（staticFile）；http(s)/data URL 原样 */
export const resolveSrc = (src: string): string => {
  if (/^(https?:|data:|blob:)/.test(src)) return src;
  const clean = src.replace(/^\.?\/+/, "").replace(/^public\//, "");
  return staticFile(clean);
};

export const buildProject = (manifest: Manifest): Project => {
  const fps = manifest.format?.fps ?? manifest.fps ?? 30;
  const width = manifest.format?.width ?? manifest.width ?? 1920;
  const height = manifest.format?.height ?? manifest.height ?? 1080;
  const theme = resolveTheme(manifest.theme, manifest.palette);

  const captionsIn = manifest.overlays?.captions;
  const captions: Required<CaptionSpec> | null = captionsIn
    ? {
        style: (typeof captionsIn === "object" && captionsIn.style) || "bar",
        position: (typeof captionsIn === "object" && captionsIn.position) || "bottom",
      }
    : null;

  const rawScenes = Array.isArray(manifest.scenes) ? manifest.scenes : [];
  const scenes: NormalizedScene[] = [];
  let cursor = 0;
  rawScenes.forEach((s, index) => {
    const id = typeof s.id === "string" && s.id ? s.id : `scene_${String(index + 1).padStart(2, "0")}`;
    const durationInFrames = Math.max(
      1,
      parseDuration(s.duration, fps) ??
        parseDuration(s.durationInFrames, fps) ??
        (typeof s.durationInSeconds === "number" ? Math.round(s.durationInSeconds * fps) : null) ??
        fps * 5,
    );
    const videoSrc = s.video?.src ?? (typeof s.videoUrl === "string" && s.videoUrl ? s.videoUrl : undefined);
    const type: "code" | "video" =
      s.type === "video" || (s.type !== "code" && (s.renderer === "api" || !!s.video)) ? "video" : "code";

    let transition = index === 0 ? null : normalizeTransition(s.transition, fps);
    if (transition) {
      // TransitionSeries 要求转场时长不超过相邻两场景的时长
      const prev = scenes[index - 1];
      const maxT = Math.max(0, Math.min(prev.durationInFrames, durationInFrames) - 1);
      transition = maxT > 0 ? { ...transition, duration: Math.min(transition.duration, maxT) } : null;
    }
    const from = index === 0 ? 0 : cursor - (transition?.duration ?? 0);

    const voText = s.voiceover?.text ?? (typeof s.narration === "string" ? s.narration : undefined);
    const voDelay = Math.max(0, Math.round(s.voiceover?.delay ?? 0));
    const voiceover =
      s.voiceover?.src || voText
        ? {
            ...s.voiceover,
            text: voText,
            delay: voDelay,
            duration: Math.max(1, Math.min(parseDuration(s.voiceover?.duration, fps) ?? durationInFrames, durationInFrames - voDelay)),
          }
        : null;

    scenes.push({
      id,
      index,
      title: s.title ?? id,
      type,
      component: (s.component ?? `${id}.tsx`).replace(/^\.\//, ""),
      durationInFrames,
      transition,
      from,
      voiceover,
      captions: s.captions ?? !!captions,
      data: (s.data as Record<string, unknown>) ?? {},
      video: type === "video" && videoSrc ? { fit: "cover", ...s.video, src: videoSrc } : null,
      raw: s,
    });
    cursor = from + durationInFrames;
  });

  const musicIn = manifest.audio?.music;
  const music =
    musicIn && musicIn.src
      ? {
          src: musicIn.src,
          volume: musicIn.volume ?? 0.5,
          fadeIn: musicIn.fadeIn ?? fps,
          fadeOut: musicIn.fadeOut ?? Math.round(fps * 1.5),
          duck: musicIn.duck ?? 0.35,
          startFrom: musicIn.startFrom ?? 0,
          loop: musicIn.loop ?? true,
        }
      : null;

  return {
    title: manifest.title ?? "",
    width,
    height,
    fps,
    theme,
    scenes,
    durationInFrames: Math.max(1, cursor),
    music,
    captions,
    watermark: manifest.overlays?.watermark ?? null,
    progress: !!manifest.overlays?.progress,
  };
};

/** Remotion Composition ID 只允许字母/数字/CJK/中划线；场景 id 的下划线等转中划线。
 *  渲染 worker 用同一条规则（Go 侧 compIDOf）。 */
export const compIdOf = (sceneId: string): string => sceneId.replace(/[^a-zA-Z0-9\u4e00-\u9fa5-]/g, "-");
