# pptx — 演示文档插件

创建、编辑与审阅演示文档（PPTX）。移植自 ZCode presentations 插件的 pptx 技能包。

## 提供

- 技能 `pptx`：版式设计最佳实践 + pptxgenjs / python-pptx 两种制作引擎 + 读取（markitdown）/ 编辑 / 渲染（LibreOffice→PDF、pdftoppm→PNG）管线
- 子代理 `Agent_visual-judge`：渲染页 PNG 的视觉验收裁决
- 规范：路由强制 + 设计实践 + 渲染验收闭环

## 环境

Node（pptxgenjs）与 Python（python-pptx、markitdown）按技能指引安装；渲染依赖 LibreOffice / poppler。
