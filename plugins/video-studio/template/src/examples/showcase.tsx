import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { Background, Card, Checklist, DeviceFrame, Kicker, Split, Stage, Title, alpha, ease, useTheme, useLayout, type SceneProps } from "../studio";

// 示例：产品演示（手机样机 + 屏内用组件拼出的界面 + 右侧卖点清单）
// 模式要点：没有截图素材时，用 Card 等组件在样机里「画」出界面，同样精致；有素材时传 screen="uploads/xxx.png"。

const FakeApp: React.FC = () => {
  const theme = useTheme();
  const frame = useCurrentFrame();
  const scroll = interpolate(frame, [36, 120], [0, -84], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease.inOut });
  const rows = ["周会纪要 · 自动生成", "产品灵感 · 3 张图片", "读书笔记 · 《设计心理学》", "旅行清单 · 已完成 8/10", "灵感草图 · 无限画布", "健身计划 · 第 12 周", "播客摘录 · 4 段高亮"];
  return (
    <div style={{ padding: 26, paddingTop: 92, display: "flex", flexDirection: "column", gap: 16, transform: `translateY(${scroll}px)` }}>
      <div style={{ fontSize: 34, fontWeight: 800, color: theme.palette.text }}>我的笔记</div>
      {rows.map((r, i) => (
        <div key={r} style={{ borderRadius: 18, padding: "18px 20px", background: i === 0 ? alpha(theme.palette.primary, 0.22) : alpha(theme.palette.text, 0.06), color: theme.palette.text, fontSize: 22 }}>
          {r}
        </div>
      ))}
    </div>
  );
};

export default function Showcase({ data }: SceneProps<{ title?: string; points?: string[] }>) {
  const { isPortrait } = useLayout();
  return (
    <>
      <Background variant="spotlight" />
      <Stage>
        <Split
          ratio={isPortrait ? 0.55 : 0.45}
          left={
            <div style={{ display: "flex", justifyContent: "center" }}>
              <DeviceFrame type="phone" width={isPortrait ? 400 : 430} delay={4}>
                <FakeApp />
              </DeviceFrame>
            </div>
          }
          right={
            <Card variant="glass" padding={56} delay={14}>
              <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
                <Kicker text="核心体验" align="left" delay={18} />
                <Title text={data.title ?? "打开就能写"} align="left" size={76} reveal="rise" delay={22} />
                <Checklist items={data.points ?? ["语音转文字，开会不用抄", "图片自动识别文字", "一键生成摘要与待办"]} delay={36} />
              </div>
            </Card>
          }
        />
      </Stage>
    </>
  );
}
