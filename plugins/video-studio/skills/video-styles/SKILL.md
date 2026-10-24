---
name: video-styles
description: 视频风格库（59 种，源自 Lemo-Opuscar）：用户点名某种风格（如 油画厚涂、浮世绘、装饰艺术、像素 RPG、蓝图制图、卫星简报）、想要「有风格的片子」、或问有哪些风格可选时使用。含风格选择、STYLE.md 落地到 Remotion 场景的实现方法、看图对照验收与用户自建风格。
---

# 视频风格库

库位置：`<插件目录>/styles/<slug>/`（每个风格：`STYLE.md` 设计语言全本、`style.json` 元数据、
`poster.jpg` 海报参考帧、`DEMO.md` 原作者 demo 的手法记录）。用户自己的风格放项目根
`styles/<slug>/`（同结构），与库内同权重、优先查。

## 什么时候用

- 用户点名风格（中英均可：装饰艺术 / Art Deco、油画厚涂 / Impasto、浮世绘 / Ukiyo-e…）；
- 用户说「想要有风格/有质感的片子」但没点名 → 读 style.json 的 cn/en/uses 字段挑 2-3 个，
  用 view_image 给用户看 poster.jpg 让他选；
- 用户要「把某风格变成自己的」→ 复制库内风格到项目 `styles/` 改名改造。

## 实现方法（落到 Remotion 工程）

1. **通读该风格的 STYLE.md**，把它当验收清单而不是氛围描述：本质（Essence）、「不是什么」、
   材质与渲染、色彩逻辑、字体与字幕、动效质量、镜头语法——每一节都是硬要求。
2. **映射到实现层**：
   - 矢量/排版/几何类（装饰艺术、蓝图、极简键线）→ React + kit 组件 + 自绘 SVG/CSS；
   - 手绘/颗粒/物理材质类（油画厚涂、水彩、risograph、蜡笔）→ `<canvas>` 逐帧程序化绘制
     （useCurrentFrame 驱动，保持确定性；颗粒用 @remotion/noise，禁止 Math.random）；
   - 3D 类（lowpoly、体积全息）→ kit 的 ThreeStage / @react-three/fiber；
   - 字幕卡/标题系统：STYLE.md 若定义了专属字幕卡，自绘组件实现它；未定义则用 kit 的 Captions。
   - 需要的 OFL 字体不在运行时清单里时，改用气质最接近的已装字体并在交付说明里讲清楚。
3. **特供警示的对策——对照验收**：原作者按 Claude Opus 5.5 调校，其他模型复现度会掉。
   对策就是强制闭环：实现后 `inspect_frames` 看图，**逐条对照 STYLE.md 的「本质 / 不是什么 /
   动效质量」小节与 poster.jpg**（用 view_image 看海报，和自己的帧并排比），不像就改，改到
   条目满足为止；DEMO.md 记录了原作者的具体手法，实现某节没把握时先读它。
4. 风格是整体系统：色彩三元组、唯一强调色、动效节拍必须全片一致；不要 A 风格的配色配
   B 风格的动效。

## 边界

- 风格库只管视觉语言；流程（check → inspect → 交付）与工具仍按主规则。
- 库内风格文本 CC BY 4.0：用户成片不需要署名（原作者条款：库外影片无强制 credit）。
