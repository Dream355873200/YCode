# 电子表格纪律

- 任何 .xlsx/.xlsm/.csv/.tsv 的创建 / 编辑 / 分析 / 转换任务，必须先调用技能 `xlsx`（Skill 工具），按它的场景路由（create / edit / analyze / convert / finance / vba）走，不要徒手写 openpyxl 一次性脚本。
- 环境缺失（Python / openpyxl 等）时按技能里的 env_setup 脚本先装环境再继续。
- 产出验收闭环：表格生成后按技能的 quality/pipeline 落地检查，涉及版面与图表的用 LibreOffice/Excel 渲染成图片并调用子代理 `Agent_visual-judge` 做视觉验收，verdict 不通过就修到通过。
- 公式要真实可算（recalc 校验），不要写死结果冒充公式；给用户的文件要经 `xlsx.py` 的 recalc/验证管线。
