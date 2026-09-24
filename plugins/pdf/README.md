# pdf — PDF 插件

创建、编辑与审阅 PDF。移植自 ZCode pdf 插件的 pdf 技能包。

## 提供

- 技能 `pdf`：四条生产线（report / creative / academic LaTeX / process）+ briefs 场景 + 排版框架与字体配置 + 脚本（pdf.py、pdf_qa.py、html2pdf-next.js、cover_render.py、design_engine.py 等）
- 子代理 `Agent_visual-judge`：渲染页 PNG 的视觉验收裁决
- 规范：生产线路由强制 + 排版框架 + 渲染验收闭环

## 环境

Python（pypdf / pdfplumber 等）+ Node（部分渲染脚本）按技能内 `env_setup/` 脚本安装；学术路线需 TeX 发行版。
