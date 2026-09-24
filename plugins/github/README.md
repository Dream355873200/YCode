# github — GitHub 插件

GitHub 工作流技能包，全部基于 `gh` CLI。移植自 ZCode github 插件的技能集。

## 提供

- 技能：`commit` / `pr` / `issue` / `repo` / `release` / `gist` / `codespace` / `workflow-run` / `secret` / `setup`
- 参考：`references/github-cli-preflight.md`（gh 安装与认证排查）
- 规范：gh CLI 强制 + Conventional Commits + 破坏性操作确认

## 环境

需要 `gh` 在 PATH 且已认证（`gh auth status`）；没有时技能 `setup` 会引导安装与 `gh auth login`。
