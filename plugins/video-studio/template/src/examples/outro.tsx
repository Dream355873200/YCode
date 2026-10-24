import React from "react";
import { ArrowRight } from "lucide-react";
import { Background, Button, Divider, GradientText, Stage, Text, Title, Vignette, Grain, LightSweep, type SceneProps } from "../studio";

// 示例：片尾（品牌名渐变 + 口号 + 行动按钮 + 光扫过）

export default function Outro({ data }: SceneProps<{ brand?: string; slogan?: string; cta?: string; url?: string }>) {
  return (
    <>
      <Background variant="mesh" />
      <LightSweep start={18} duration={36} />
      <Stage gap={34}>
        <Title text={data.brand ?? "Nova"} size={168} reveal="blur" delay={0} gradient letterSpacing="-0.03em" />
        <Divider width={200} delay={14} />
        <Text text={data.slogan ?? "写下来，剩下的交给 AI"} size={44} delay={18} color={undefined} />
        <div style={{ marginTop: 26 }}>
          <Button label={data.cta ?? "免费开始使用"} icon={<ArrowRight />} delay={30} />
        </div>
        <Text size={28} delay={44}>
          <GradientText>{data.url ?? "nova.app"}</GradientText>
        </Text>
      </Stage>
      <Vignette strength={0.5} />
      <Grain opacity={0.05} />
    </>
  );
}
