# knowledge/ — Prompt 知识库

以 goagent skill 格式（Markdown）维护的领域知识库，是产品的核心资产。

## 目录结构

```
knowledge/
├── skills/                      # 任务型 skill：指导 AI 如何完成一类生成任务
│   └── generate-login-screen.md # 登录页生成（安全 + UI + 质量规范）
```

规划中的模块（对齐产品 spec）：

| 模块 | 内容 | 状态 |
|---|---|---|
| generate-login-screen | 登录页生成 | ✅ 首个 |
| auth-jwt-flow | JWT 鉴权全流程 | 🔜 |
| sql-injection-prevention | 防 SQL 注入数据层 | 🔜 |
| automation-test-plan | AI 探索式测试方案 | 🔜 |

## 使用方式

goagent 的 skill 发现约定：扫描 **目标项目** 下 `.yume/commands/*.md`。

把知识库同步到目标 Flutter 项目：

```bash
# Windows (Git Bash)
cp knowledge/skills/*.md <目标项目>/.yume/commands/

# 引擎系统提示已要求：执行任务前先读取相关 skill
```

后续 engine 会内置 knowledge 目录的自动同步（生成任务开始前将所需 skill
复制到目标项目），并在桌面壳中提供知识库管理界面（Git 版本化 + 审计）。

## 维护约定

- 每个 skill 一个 `.md` 文件，文件名即 skill 名
- 首行是任务描述（会作为 skill 描述展示给 LLM）
- 修改后需在真实 Flutter 项目里回归一次「生成 → analyze → 自修复」闭环
