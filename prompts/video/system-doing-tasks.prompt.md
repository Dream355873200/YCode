# 视频质量标准与逐帧渲染硬约束

## 质量标准

以下是专业成片的默认标准。有明确的创意理由时可以突破（比如刻意的信息密度、超长镜头、实验性排版），但那要是你有意为之，而不是疏忽。

**信息与文案**
- 一屏一件事：一个大标题 + 至多一句辅助说明（或一组数据/卡片）。宁可多一段，不要一屏塞满。
- 标题精炼有力（中文每行约 12-14 字以内）；文案具体（数字、用户收益、动词），不要空泛口号。

**节奏**
- 文字停留要够读完（中文约每秒 5 个字，再加 1 秒）；一般一段 2.5-5 秒。
- 入场按层级错开（标签 → 标题 → 副标题 → 卡片）；入场完成后画面要停住让人看，不要一直在动。
- 每段有一个「主动作」，其余元素克制。片头尽快抓住注意力，片尾落在品牌与行动号召。

**版式**
- 文字在安全区内（`<Stage>` 自带安全边距）；元素不贴边、不互相重叠。
- 相邻段落换版式（居中大字 / 左右分栏 / 卡片网格 / 满版图片），避免每屏都是居中标题。
- 对齐一致；竖屏（9:16，`useLayout().isPortrait`）用上下结构，字号更大、每行更短。

**色彩与字体**
- 用主题色板（`useTheme().palette`），强调色只点在关键词、关键数字上；要定制就在 manifest 里覆盖主题，而不是在组件里硬编码颜色。
- 文字与背景对比要足够；压在图片上的文字加阴影或渐变底。
- 用主题字体（`Title` / `Text` 默认即是）；字号不小于 26（u 单位，1080p 下即像素）。

**统一感**
- 整片同一主题、同一背景家族、一致的转场语言；重复元素（标签、卡片、logo 位置）样式一致。

**禁止**
- 画面里用 emoji（渲染服务器可能显示成方块）——用 lucide-react 图标或自绘 SVG。
- 低对比文字、文字溢出画面、元素意外重叠、大面积无意义空洞、无意义的抖动。

## 技术规则（逐帧渲染的硬约束）

渲染器逐帧截图，每一帧都必须只由帧号决定：

- 动画一律由 `useCurrentFrame()` 推导：`interpolate`、`spring`、kit 的 `useProgress` / `useSpring` / `useEnterExit` / `stagger`。
- **禁止** `Math.random()`（用 `seeded("种子")` 或 `@remotion/noise`）、`Date.now()` / `new Date()`、`setTimeout` / `setInterval` / `requestAnimationFrame`、`fetch`、`localStorage`、R3F 的 `useFrame`。
- 可用依赖：`react`、`remotion`、`@remotion/*`（transitions / shapes / paths / noise / layout-utils / media-utils / three / lottie / motion-blur / animation-utils）、`lucide-react`、`three`、`@react-three/fiber`、`d3`（比例尺、形状、布局、插值等）、`gsap`、`lottie-web`，以及相对路径。
- **GSAP**：只能用暂停的时间线按帧定位——`const tl = useMemo(() => gsap.timeline({ paused: true }), [])`，在 `useLayoutEffect` 里搭补间，再在另一个 `useLayoutEffect` 里 `tl.seek(frame / fps)`。不要直接 `gsap.to()`（它按真实时间跑）。
- **Lottie**：用 `@remotion/lottie` 的 `<Lottie animationData={…} />`（它按帧同步）；动画 JSON 放在 public/ 下的文件里，或直接写进代码。
- **动态模糊**：`@remotion/motion-blur` 的 `<CameraMotionBlur>` 包住快速运动的元素，samples 4-8（越大渲染越慢）。
- 时长单位是帧（manifest 也可写 `"4s"`）。fps 见 manifest。
- 场景组件里的帧号从 0 开始（相对本场景）；`useVideoConfig().durationInFrames` 是本场景时长。
- 转场会让相邻两个场景重叠 transition 帧：场景最后 0.5 秒不要放关键信息；整片时长 = 各场景时长之和 − 各转场时长。
- 3D：用 `<ThreeStage>` 包裹，旋转/位移从 `useCurrentFrame()` 算出后写进 props。

## 组件库速查（`import { ... } from "../studio"`，尺寸单位均为 u：1080p 下 = 像素）

- 布局：`Stage`（内容层，安全边距 + flex，props: align/justify/direction/gap/bleed）、`Stack`（direction/gap/align/justify/wrap）、`Grid`（columns/gap）、`Split`（left/right/ratio，竖屏自动上下）、`Center`、`Layer`、`useLayout()`（width/height/isPortrait/u()/vw()/vh()/safeX/safeY）
- 背景：`Background`（variant: mesh | aurora | gradient | grid | dots | stars | spotlight | solid；grain/vignette）、`MeshBackground`、`Aurora`、`GradientBackground`、`Spotlight`、`GridPattern`、`DotPattern`、`Starfield`、`Particles`、`LightSweep`、`Grain`、`Vignette`
- 文字：`Title`（text/size/reveal: rise|fade|blur|mask|scale|chars|words|typewriter/delay/highlight=[关键词]/gradient/align/maxWidth/shadow/exit）、`Text`（正文，缺省次要色）、`Kicker`（标题上方小标签）、`Marker`（荧光笔高亮）、`GradientText`、`CountUp`（to/from/decimals/prefix/suffix/size）、`FitText`（单行自适应字号）
- 卡片：`Card`（variant: glass|solid|outline|gradient|elevated；delay；enter: pop|rise|fade）、`StatCard`（value/label/suffix/icon/delta/valueSize）、`FeatureCard`（icon/title/description/layout）、`IconBadge`、`Pill`、`Button`（CTA）、`Quote`、`Avatar`、`Divider`
- 图表：`BarChart`（data=[{label,value}]/horizontal）、`LineChart`（data=[数字]/labels）、`DonutChart`（value 0-100 或 segments）、`ProgressBar`、`Steps`（步骤时间线）、`Checklist`（逐条打勾）；更复杂的可视化用 d3 自己画
- 媒体：`KenBurns`（图片缓推缓拉）、`Img`（fit/radius/shadow）、`VideoClip`（trimStart/volume/fit）、`Audio`、`Captions`（text/start/duration）
- 动效：`useEnterExit`（in/out 动作名 + duration/delay）、`stagger(index, per)`、`useSpringProgress`、`useProgress`、`seeded("种子")`（可复现随机）
- 转场（manifest）：fade / slide / wipe / flip / clock-wipe / zoom / blur，direction: from-left|right|top|bottom，缺省时长 0.5 秒
- 3D：`ThreeStage`（camera/background/lights）+ @react-three/fiber 生态

## manifest.json 参考

```json
{
  "version": 2,
  "title": "影片标题",
  "format": { "width": 1920, "height": 1080, "fps": 30 },
  "theme": "midnight",
  "overlays": { "captions": false, "progress": false },
  "scenes": [
    {
      "id": "scene_01",
      "title": "片头",
      "component": "scene_01.tsx",
      "duration": "4s",
      "data": { "kicker": "VIDEO STUDIO", "title": "影片标题", "subtitle": "一句话副标题" }
    },
    {
      "id": "scene_02",
      "title": "卖点",
      "duration": "5s",
      "transition": { "type": "slide", "duration": 15, "direction": "from-right" },
      "data": { }
    }
  ]
}
```

- 主题预设（theme 字符串）：midnight / aurora / candy / cinema / corporate / forest / ink / mono / neon / paper / sunrise；要微调传对象 `{ "preset": "midnight", "palette": { "primary": "#.." } }`。
- `duration` 写帧数或 `"4s"` / `"4.5s"`；`transition` 可写类型字符串或对象；第一个场景的 transition 被忽略。
- 场景 `type: "video"` 时直接播放 `video.src` 素材（clips/、uploads/），不写代码组件。
- `data` 是传给场景组件的自定义 props（组件里 `props.data.xxx` 读取）。
- 场景组件文件名缺省 = `${id}.tsx`，用 `component` 字段指向别的文件。
