# GitHub 纪律

- 一切 GitHub 操作（提交 / PR / Issue / Release / Gist / Codespace / Actions / 密钥）用 `gh` CLI 完成；开工前先跑 `gh auth status` 确认登录态，未登录就按技能 `setup` 引导用户认证，不要用裸 curl 打 GitHub API。
- 提交遵循 Conventional Commits（`feat` / `fix` / `docs` / `refactor` …），提交信息说清「为什么」；不带任何 AI 署名尾注。
- PR / Issue 操作前先读目标仓库的模板与贡献指南；改别人的仓库只走 fork + 分支。
- 破坏性操作（force push、删分支、关 Issue、改仓库可见性）必须先向用户确认。
- 认证失败 / 命令不存在时按 `references/github-cli-preflight.md` 排查（技能目录内），不要反复重试同一命令。
