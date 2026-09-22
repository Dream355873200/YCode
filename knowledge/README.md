# knowledge/ — Prompt 知识库

以 goagent skill 格式（Markdown + YAML frontmatter）维护的领域知识库，
是产品的核心资产。

## 目录结构

```
knowledge/
├── skills/                      # 任务型 skill：指导 AI 如何完成一类生成任务
│   ├── design.md                # 原创视觉设计（无参考图/用户放权时）
│   ├── generate-login-screen.md # 登录页生成（安全 + UI + 质量规范）
│   ├── local-data.md            # 本地数据层（选型/建表/迁移/安全基线）
│   ├── navigation.md            # 页面导航与路由
│   ├── testing.md               # 设备测试分层策略
│   └── ui-style.md              # 界面视觉语言决策与一致性
├── styles/                      # 风格定义（被 ui-style/design 引用的参数词典）
│   ├── apple-clean.md
│   └── card-stream.md
└── plugins/                     # 设备能力插件文档（工具链清单 + 使用模型 + 扩展指引）
    ├── README.md
    └── device-testing.md
```

## Skill 格式（SKILL.md 标准）

每个 skill 文件头部带 YAML frontmatter（goagent skill 加载器原生解析，
正文自动剥壳后再注入 prompt）：

```yaml
---
name: testing                  # skill 名（缺省回落文件名）
description: 一句话说明能力     # 展示给 LLM 的描述（缺省回落正文首行）
when-to-use: 什么时机该调用     # 发现层的触发时机判断
allowed-tools: tap, screenshot # 预期用到的工具（逗号分隔）
---
正文 = 注入给模型的 prompt
```

## 使用方式

goagent 的 skill 发现约定：扫描 **目标项目** 下 `.yume/commands/*.md`。

把知识库同步到目标 Flutter 项目：

```bash
# Windows (Git Bash)
cp knowledge/skills/*.md <目标项目>/.yume/commands/
```

后续 engine 会内置 knowledge 目录的自动同步（生成任务开始前将所需 skill
复制到目标项目），并在桌面壳中提供知识库管理界面（Git 版本化 + 审计）。

## 维护约定

- 每个 skill 一个 `.md` 文件，frontmatter 四字段齐备（name/description/
  when-to-use/allowed-tools），新增领域工具时同步更新相关 skill 的
  allowed-tools
- 风格定义与插件文档不放 frontmatter——它们是数据/文档，不是可执行 skill
- 修改后需在真实 Flutter 项目里回归一次「生成 → analyze → 自修复」闭环
