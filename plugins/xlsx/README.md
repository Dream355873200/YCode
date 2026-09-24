# xlsx — 电子表格插件

创建、编辑与审阅电子表格（XLSX）。移植自 ZCode spreadsheets 插件的 xlsx 技能包。

## 提供

- 技能 `xlsx`：场景驱动工作台（create / edit / analyze / convert / finance / vba / advanced）+ 引擎参考（图表 / 设计 / VBA 模板）+ `xlsx.py`、`templates/base.py`、`templates/palettes.py` 脚本 + quality 管线
- 子代理 `Agent_visual-judge`：渲染页 PNG 的视觉验收裁决
- 规范：场景路由强制 + recalc 验证 + 渲染验收闭环

## 环境

Python + openpyxl 等按技能内 `env_setup/` 脚本安装；Windows 用 `setup_windows.ps1`。
