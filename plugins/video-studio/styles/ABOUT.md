# 风格库（Lemo-Opuscar 风格资产）

本目录是 [Lemo-Opuscar](https://github.com/lemomo-ai/lemo-opuscar)（作者 Lemomo，@lemomo_ai）的
风格资产抽取版：每个 `styles/<slug>/` 含 `STYLE.md`（该风格的完整设计语言：本质、材质、
色彩逻辑、字体排印、动效质量、镜头语法）、`style.json`（元数据：中英名/类别/适用场景/示意短片）、
`poster.jpg`（海报参考帧）。原仓库 MIT（代码）· CC BY 4.0（风格文本）；未包含其演示影片源码与
渲染工具，此处风格用于在我们的 Remotion 管线中实现同款视觉。

注意：原作者提示风格提示词按 Claude Opus 5.5 调校，其他模型复现度可能下降——实现时以
STYLE.md 的条目为准逐条落实，不要凭印象。

用户自己的风格：项目根目录 `styles/<slug>/STYLE.md`（同结构），与库内风格同权重。
