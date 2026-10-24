import React from "react";
import { Background, Card, Kicker, LineChart, Marker, Stage, Text, Title, useLayout, type SceneProps } from "../studio";

// 示例：趋势图表（标题 + 折线逐帧绘出 + 结论句里用荧光笔强调关键数字）

export default function Trend({ data }: SceneProps<{ title?: string; values?: number[]; labels?: string[] }>) {
  const { isPortrait } = useLayout();
  return (
    <>
      <Background variant="grid" />
      <Stage gap={40}>
        <Kicker text="增长曲线" />
        <Title text={data.title ?? "每个季度都在加速"} size={isPortrait ? 84 : 80} reveal="words" delay={4} />
        <Card variant="glass" padding={40} delay={12}>
          <LineChart
            data={data.values ?? [12, 18, 16, 27, 34, 41, 58, 73]}
            labels={data.labels ?? ["Q1", "Q2", "Q3", "Q4", "Q1", "Q2", "Q3", "Q4"]}
            width={isPortrait ? 860 : 1400}
            height={isPortrait ? 520 : 480}
            delay={20}
            duration={60}
          />
        </Card>
        <Text size={38} delay={70} color={undefined}>
          两年时间，用户规模增长 <Marker delay={78}>6 倍</Marker>
        </Text>
      </Stage>
    </>
  );
}
