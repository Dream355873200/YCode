# PDF 纪律

- 任何以 PDF 为产物的任务（报告 / 海报 / 简历 / 论文 / Office 或 HTML 转 PDF）与既有 PDF 处理（合并 / 拆分 / 抽取 / 表单 / 转图），必须先调用技能 `pdf`（Skill 工具），按它的四条生产线自动路由。
- 排版类产物遵循技能里的版面框架与字体配置（configs/fonts.md、typesetting/），不要凭感觉硬排。
- 环境缺失按技能 env_setup（Windows 用 setup_windows.ps1）先装再继续；LaTeX 路线需要 TeX 发行版，没有时改走 HTML→PDF 路线并在回复里说明。
- 产出验收闭环：PDF 渲染成逐页 PNG，调用子代理 `Agent_visual-judge` 做视觉验收（溢出、截断、字体缺失、乱码逐页检查），verdict 不通过就修到通过。
- 纯处理类（合并 / 拆分 / 抽取）用技能的 `scripts/pdf.py`、`pdf_qa.py`，处理后跑 QA 校验页数与文本完整性。
