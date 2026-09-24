# docx — Word 文档插件

创建、编辑与审阅 Word 文档（DOCX）。移植自 ZCode documents 插件的 docx 技能包。

## 提供

- 技能 `docx`：create / edit / format / read / comment 五条路由 + 场景模板（报告 / 简历 / 合同 / 公文 / 试卷 / 文案 / 学术）+ OOXML / docx-js 参考 + Python 脚本（TOC 占位、页脚字段修复、后置校验等）
- 子代理 `Agent_visual-judge`：渲染页 PNG 的视觉验收裁决
- 规范：技能路由强制 + 渲染验收闭环

## 环境

Node（docx 库）与 Python（python-docx 等）按技能内 `env_setup/` 脚本安装；Windows 用 `setup_windows.ps1`。
