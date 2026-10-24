import React from "react";
import { Background, Grain, Kicker, Stage, Text, Title, Vignette, useLayout, type SceneProps } from "../studio";

// 起始场景：新工作区的片头占位。AI 制作时会改写或替换本文件。
export default function Scene01({ data }: SceneProps<{ kicker?: string; title?: string; subtitle?: string }>) {
  const { isPortrait } = useLayout();
  return (
    <>
      <Background variant="mesh" />
      <Stage gap={28}>
        <Kicker text={data.kicker ?? "VIDEO STUDIO"} delay={6} />
        <Title text={data.title ?? "未命名影片"} size={isPortrait ? 104 : 128} reveal="chars" delay={12} maxWidth={isPortrait ? 900 : 1500} />
        {data.subtitle ? <Text text={data.subtitle} size={isPortrait ? 40 : 38} delay={34} maxWidth={1200} /> : null}
      </Stage>
      <Vignette strength={0.45} />
      <Grain opacity={0.05} />
    </>
  );
}
