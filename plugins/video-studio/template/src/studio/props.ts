import type { Palette, Theme } from "./theme";
import type { ManifestScene } from "./manifest";

// SceneProps —— 场景组件契约：src/scenes/*.tsx 默认导出 (props: SceneProps) => JSX。
// film 按 manifest 注入；data 是 manifest 里该场景的 data 字段（文案/数字/列表）。

export interface SceneProps<D extends Record<string, unknown> = Record<string, any>> {
  id: string;
  index: number;
  title: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  theme: Theme;
  /** = theme.palette（v1 兼容） */
  palette: Palette;
  data: D;
  voiceover?: { text?: string; src?: string; delay: number };
  /** = voiceover.text（v1 兼容） */
  narration?: string;
  /** v1 兼容字段 */
  characters: { name: string; role: string; color: string }[];
  dialogues?: { speaker: string; text: string }[];
  assets?: { id: string; url: string }[];
  /** manifest 场景项原文（读取自定义字段） */
  scene: ManifestScene;
}
