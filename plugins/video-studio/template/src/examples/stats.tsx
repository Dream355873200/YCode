import React from "react";
import { Users, Timer, Star } from "lucide-react";
import { Background, Grid, Kicker, Split, Stage, StatCard, Text, Title, stagger, useLayout, type SceneProps } from "../studio";

// 示例：数据背书（左侧论点 + 右侧数据卡，数字自动滚动）
// 模式要点：Split 左右分栏（竖屏自动上下）；StatCard 的 value 传纯数字，单位走 suffix。

export default function Stats({ data }: SceneProps<{ title?: string; body?: string }>) {
  const { isPortrait } = useLayout();
  return (
    <>
      <Background variant="aurora" grain />
      <Stage>
        <Split
          ratio={isPortrait ? 0.4 : 0.42}
          left={
            <div style={{ display: "flex", flexDirection: "column", gap: 24, alignItems: isPortrait ? "center" : "flex-start" }}>
              <Kicker text="用数据说话" align={isPortrait ? "center" : "left"} />
              <Title text={data.title ?? "320 万人\n已经在用"} align={isPortrait ? "center" : "left"} size={isPortrait ? 96 : 104} reveal="mask" delay={6} />
              <Text text={data.body ?? "上线 18 个月，口碑一路领先。"} align={isPortrait ? "center" : "left"} size={36} delay={26} />
            </div>
          }
          right={
            <Grid columns={2} gap={isPortrait ? 22 : 28}>
              <StatCard value={320} suffix="万" label="活跃用户" icon={<Users />} delay={stagger(0, 6, 20)} valueSize={isPortrait ? 72 : 96} />
              <StatCard value={42} suffix="%" label="整理时间减少" icon={<Timer />} delay={stagger(1, 6, 20)} delta="+12% 环比" valueSize={isPortrait ? 72 : 96} />
              <StatCard value={4.9} decimals={1} label="应用商店评分" icon={<Star />} delay={stagger(2, 6, 20)} variant="gradient" valueSize={isPortrait ? 72 : 96} />
              <StatCard value={99.99} decimals={2} suffix="%" label="服务可用性" delay={stagger(3, 6, 20)} valueSize={isPortrait ? 72 : 96} />
            </Grid>
          }
        />
      </Stage>
    </>
  );
}
