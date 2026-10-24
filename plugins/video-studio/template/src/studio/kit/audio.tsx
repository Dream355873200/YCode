import React from "react";
import { Audio, Sequence, interpolate, useVideoConfig } from "remotion";
import { resolveSrc } from "../manifest";

// 音频：背景音乐（淡入淡出 + 人声闪避）、配音、音效。film.tsx 按 manifest.audio 与
// scenes[].voiceover 自动装配；场景内要加音效时直接用 <Sfx/>。

/** 背景音乐：整段淡入淡出；duckRanges 内（有配音的区间）音量压低到 duck 倍 */
export const Music: React.FC<{
  src: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  duck?: number;
  duckRanges?: [number, number][];
  startFrom?: number;
  loop?: boolean;
}> = ({ src, volume = 0.5, fadeIn = 30, fadeOut = 45, duck = 0.35, duckRanges = [], startFrom = 0, loop = true }) => {
  const { durationInFrames } = useVideoConfig();
  const envelope = (f: number): number => {
    const fade = interpolate(f, [0, Math.max(1, fadeIn), Math.max(fadeIn + 1, durationInFrames - fadeOut), durationInFrames], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    let duckK = 1;
    for (const [a, b] of duckRanges) {
      // 8 帧斜坡进出闪避，避免音量突变
      const k = interpolate(f, [a - 8, a, b, b + 8], [1, duck, duck, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      duckK = Math.min(duckK, k);
    }
    return volume * fade * duckK;
  };
  return <Audio src={resolveSrc(src)} startFrom={startFrom} loop={loop} volume={envelope} />;
};

/** 配音：from 帧开始播放 */
export const Voice: React.FC<{ src: string; from?: number; volume?: number }> = ({ src, from = 0, volume = 1 }) => (
  <Sequence from={from} layout="none">
    <Audio src={resolveSrc(src)} volume={volume} />
  </Sequence>
);

/** 音效：at 帧触发一次 */
export const Sfx: React.FC<{ src: string; at?: number; volume?: number }> = ({ src, at = 0, volume = 0.8 }) => (
  <Sequence from={at} layout="none">
    <Audio src={resolveSrc(src)} volume={volume} />
  </Sequence>
);
