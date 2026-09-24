# 演示文档纪律

- 任何 .pptx 的创建 / 编辑 / 重排 / 提取 / 转换任务，必须先调用技能 `pptx`（Skill 工具），按它的路由（新建 / 编辑已有 / 读取提取 / 渲染转换）走。
- 新建幻灯片遵循技能第一部分的版式设计最佳实践（网格、字号层级、留白），不要做白底满屏 bullet 的无聊版式。
- 环境缺失（Node 的 pptxgenjs / Python 的 python-pptx / LibreOffice）时按技能指引先装环境再继续。
- 产出验收闭环：deck 生成后渲染成 PDF / 每页 PNG，调用子代理 `Agent_visual-judge` 做视觉验收（溢出、遮挡、对比度、对齐逐页检查），verdict 不通过就修到通过。
