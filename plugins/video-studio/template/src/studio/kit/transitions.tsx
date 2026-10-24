import React from "react";
import { AbsoluteFill } from "remotion";
import { linearTiming, type TransitionPresentation, type TransitionPresentationComponentProps } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { flip } from "@remotion/transitions/flip";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import type { Direction, TransitionType } from "../manifest";
import { ease } from "./motion";

// 场景转场：manifest 的 transition 字段 → @remotion/transitions 的 presentation。
// 自定义两种：zoom（推近穿越）与 blur（模糊溶解），其余用官方实现。

type EmptyProps = Record<string, never>;

const ZoomPresentation: React.FC<TransitionPresentationComponentProps<EmptyProps>> = ({ presentationProgress, presentationDirection, children }) => {
  const p = presentationProgress;
  const entering = presentationDirection === "entering";
  const scale = entering ? 1.22 - 0.22 * p : 1 - 0.12 * p;
  const opacity = entering ? Math.min(1, p * 1.6) : 1 - p;
  return <AbsoluteFill style={{ transform: `scale(${scale})`, opacity }}>{children}</AbsoluteFill>;
};

const BlurPresentation: React.FC<TransitionPresentationComponentProps<EmptyProps>> = ({ presentationProgress, presentationDirection, children }) => {
  const p = presentationProgress;
  const entering = presentationDirection === "entering";
  const blur = entering ? (1 - p) * 24 : p * 24;
  const opacity = entering ? p : 1 - p;
  return <AbsoluteFill style={{ filter: blur > 0.3 ? `blur(${blur}px)` : undefined, opacity }}>{children}</AbsoluteFill>;
};

export const zoomTransition = (): TransitionPresentation<EmptyProps> => ({ component: ZoomPresentation, props: {} as EmptyProps });
export const blurTransition = (): TransitionPresentation<EmptyProps> => ({ component: BlurPresentation, props: {} as EmptyProps });

/** manifest 转场声明 → presentation（未知类型回落淡入淡出） */
export const presentationFor = (
  type: TransitionType,
  direction: Direction,
  size: { width: number; height: number },
): TransitionPresentation<Record<string, unknown>> => {
  const p = (() => {
    switch (type) {
      case "slide":
        return slide({ direction });
      case "wipe":
        return wipe({ direction });
      case "flip":
        return flip({ direction });
      case "clock-wipe":
        return clockWipe({ width: size.width, height: size.height });
      case "zoom":
        return zoomTransition();
      case "blur":
        return blurTransition();
      default:
        return fade();
    }
  })();
  return p as unknown as TransitionPresentation<Record<string, unknown>>;
};

export const timingFor = (durationInFrames: number) => linearTiming({ durationInFrames, easing: ease.inOut });
