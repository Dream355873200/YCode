# 风格库

本目录是两份 MIT 风格资产的抽取合辑，共 72 种风格。每个 `styles/<slug>/` 含
`STYLE.md`（该风格的完整设计语言：本质、材质、色彩逻辑、字体排印、动效质量、
镜头语法、声音、引擎实现要点）、`style.json`（元数据：中英名/类别/适用场景/示意短片）、
`poster.jpg`（海报参考帧）。风格用于在我们的 Remotion 管线中实现同款视觉。

## 来源一：Lemo-Opuscar（num 01–70）

[Lemo-Opuscar](https://github.com/lemomo-ai/lemo-opuscar)（作者 Lemomo，@lemomo_ai）。
原仓库 MIT（代码）· CC BY 4.0（风格文本）；未包含其演示影片源码与渲染工具。

注意：原作者提示风格提示词按 Claude Opus 5.5 调校，其他模型复现度可能下降——实现时以
STYLE.md 的条目为准逐条落实，不要凭印象。

## 来源二：mg-styles-15（num 71–83，2025-10 增补）

[15 Motion Design Styles](https://github.com/vincentwei1021/mg-styles-15)
（作者 vincentwei1021，MIT），收录 13 种：flat-vector、line-art、isometric-city、
soft-3d、cel-boil、collage、liquid、shape-morph、bauhaus、synthwave、aurora-glass、
sticker-explainer、pixel-mg。原仓库每风格附完整成片源码，此处**只蒸馏风格圣经、
不收 demo 源码**——demo 是带特定故事种子的成片实现，通读易致克隆；其关键技术
参数（缓动曲线、层结构、伪算法配方）已直接写入对应 STYLE.md 章节。原片的
AI 评审标准（rubric）思路已并入工坊的验收清单。

用户自己的风格：项目根目录 `styles/<slug>/STYLE.md`（同结构），与库内风格同权重。
