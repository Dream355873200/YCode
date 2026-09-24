# Word 文档纪律

- 任何 .docx 的创建 / 编辑 / 批注 / 转换任务，必须先调用技能 `docx`（Skill 工具），按它的路由（create / edit / format / read / comment）走，不要徒手拼 XML 或凭记忆写 python-docx 代码。
- 环境缺失（缺 Node/npm 的 docx 库或缺 Python 库）时按技能里的 env_setup 脚本先装环境，装完再继续，不要绕开。
- 产出验收闭环：文档生成后必须渲染成图片（docx→PDF→PNG）并调用子代理 `Agent_visual-judge` 做视觉验收，verdict 不通过就修到通过；用户会看到的每一页都要过这道门。
- 编辑现有文档优先走 OOXML 解包编辑（保留格式与修订），不要「重建整个文档」。
- 转换类任务（Word转PDF / doc转docx / 导出图片）同样属于本插件，用技能里对应的转换管线。
