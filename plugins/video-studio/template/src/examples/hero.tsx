import React from "react";
import { Sparkles } from "lucide-react";
import { Background, Kicker, Particles, Pill, Stack, Stage, Text, Title, Vignette, Grain, stagger, useLayout, type SceneProps } from "../studio";

// 示例：开场主视觉（网格渐变底 + 漂浮粒子 + 逐字标题 + 高亮词 + 标签组）
// 模式要点：背景层 → Stage 内容层 → 质感层；入场按「标签 → 标题 → 副标题 → 标签组」错开。

export default function Hero({ data }: SceneProps<{ kicker?: string; title?: string; highlight?: string; subtitle?: string; tags?: string[] }>) {
  const { isPortrait } = useLayout();
  const tags = data.tags ?? ["实时协作", "AI 摘要", "跨端同步"];
  return (
    <>
      <Background variant="mesh" />
      <Particles count={36} speed={0.8} />
      <Stage gap={30}>
        <Kicker text={data.kicker ?? "NEW · 2026"} delay={4} />
        <Title
          text={data.title ?? "让每一次灵感\n都被好好记住"}
          highlight={[data.highlight ?? "灵感"]}
          reveal="chars"
          size={isPortrait ? 110 : 132}
          delay={10}
          lineHeight={1.12}
        />
        <Text text={data.subtitle ?? "Nova 智能笔记 —— 写下来，剩下的交给 AI"} size={isPortrait ? 40 : 40} delay={40} />
        <Stack direction="row" gap={18} style={{ marginTop: 20 }}>
          {tags.map((t, i) => (
            <Pill key={t} delay={stagger(i, 5, 52)}>
              {i === 0 ? <Sparkles size={22} /> : null}
              {t}
            </Pill>
          ))}
        </Stack>
      </Stage>
      <Vignette strength={0.5} />
      <Grain opacity={0.05} />
    </>
  );
}
