import React from "react";
import { Zap, ShieldCheck, Layers } from "lucide-react";
import { Background, FeatureCard, Grid, Kicker, Stack, Stage, Title, stagger, useLayout, type SceneProps } from "../studio";

// 示例：三栏特性（标题区 + 特性卡网格，竖屏自动变单列）
// 模式要点：图标用 lucide-react 组件（不用 emoji）；卡片 delay 用 stagger 错开。

const ICONS = [<Zap key="z" />, <ShieldCheck key="s" />, <Layers key="l" />];

export default function Features({ data }: SceneProps<{ kicker?: string; title?: string; items?: { title: string; description: string }[] }>) {
  const { isPortrait } = useLayout();
  const items = data.items ?? [
    { title: "毫秒级同步", description: "多端编辑实时合并，离线也能继续写" },
    { title: "端到端加密", description: "笔记只属于你，连我们也看不到" },
    { title: "无限画布", description: "文字、图片、思维导图自由排布" },
  ];
  return (
    <>
      <Background variant="dots" />
      <Stage gap={56}>
        <Stack gap={18}>
          <Kicker text={data.kicker ?? "为什么选择 Nova"} delay={0} />
          <Title text={data.title ?? "快、稳、自由"} size={isPortrait ? 96 : 88} reveal="rise" delay={6} />
        </Stack>
        <Grid columns={isPortrait ? 1 : 3} gap={isPortrait ? 28 : 36} style={{ maxWidth: isPortrait ? 900 : 1620 }}>
          {items.map((it, i) => (
            <FeatureCard
              key={it.title}
              icon={ICONS[i % ICONS.length]}
              title={it.title}
              description={it.description}
              delay={stagger(i, 7, 18)}
              layout={isPortrait ? "horizontal" : "vertical"}
            />
          ))}
        </Grid>
      </Stage>
    </>
  );
}
