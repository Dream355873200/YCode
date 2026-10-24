import React from "react";
import { useCurrentFrame } from "remotion";
import { Background, Stage, ThreeStage, Title, Kicker, useTheme, useLayout, type SceneProps } from "../studio";

// 示例：3D 主体（@remotion/three）——旋转的环面纽结 + 标题。
// 模式要点：rotation 等一切动画量都从 useCurrentFrame() 计算；3D 层在下、文字层在上。

const Knot: React.FC = () => {
  const frame = useCurrentFrame();
  const theme = useTheme();
  return (
    <mesh rotation={[frame * 0.012, frame * 0.02, 0]} position={[0, 0.2, 0]}>
      <torusKnotGeometry args={[1.15, 0.36, 220, 36]} />
      <meshStandardMaterial color={theme.palette.primary} metalness={0.55} roughness={0.22} />
    </mesh>
  );
};

export default function Orb({ data }: SceneProps<{ title?: string }>) {
  const { isPortrait } = useLayout();
  return (
    <>
      <Background variant="spotlight" />
      <ThreeStage camera={{ position: [0, 0, isPortrait ? 11 : 8.5] }}>
        <Knot />
      </ThreeStage>
      <Stage align="end" gap={16}>
        <Kicker text="3D" />
        <Title text={data.title ?? "每个细节都值得被看见"} size={isPortrait ? 72 : 76} reveal="rise" delay={10} shadow />
      </Stage>
    </>
  );
}
