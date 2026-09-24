# 提示词组（prompts/）

系统提示词由 7 个分段文件按固定顺序拼成。一个**提示词组**就是 `prompts/<name>/` 目录，
里面只放需要改写的分段，缺的分段自动使用 GoAgent 内置的通用 Agent 提示词（随库升级，
不用复制维护）。

模式通过 `mode.json` 的 `prompts` 字段按名引用一个组；省略时整套使用内置提示词
（`code` 模式就是这样）。

```jsonc
// modes/flutter/mode.json
{ "id": "flutter", "prompts": "flutter", "plugins": [ ... ] }
```

## 分段

按拼接顺序：

| 文件 | 内容 |
|---|---|
| `system-identity.prompt.md` | 身份声明：你是谁、服务什么任务 |
| `system-doing-tasks.prompt.md` | 执行任务的方法与纪律 |
| `system-actions.prompt.md` | 谨慎执行有风险的操作 |
| `system-using-tools.prompt.md` | 工具使用策略 |
| `system-tone-style.prompt.md` | 语气与风格 |
| `system-output-efficiency.prompt.md` | 输出效率 |
| `system-reminder.prompt.md` | 系统规则（权限模式、压缩等运行机制说明） |

组里的其他文件会被忽略。分段之后，引擎会追加环境信息（平台、Shell、工作目录）和
Git 状态；模式所引用插件的领域规范则作为项目上下文另行注入。

## 写法建议

- **只覆盖必须变的段**。通常是 `identity`（领域身份），加上一两个需要领域化的方法段；
  其余段保持内置，自动享受库的改进
- 覆盖是**整段替换**，不是追加：写之前先看内置原文（GoAgent 源码 `prompts/` 目录下的同名文件），
  在它的基础上改
- 领域规则（「这个领域必须做 / 不能做什么」）写进插件的 `rules.md`，不要写进提示词组。
  规则跟着插件走，可以被多个模式复用；提示词组只管 Agent 的身份和工作方式

## 生效

提示词组是会话级的：切换项目的模式，下一轮对话就换成新模式的提示词组，不用重启引擎。
分段文件每轮现读，修改后下一轮生效。新增的组要重启引擎后才能被模式引用
（模式引用不存在的组时，引擎拒绝启动）。

## 内置组

| 组 | 覆盖的分段 | 使用者 |
|---|---|---|
| `flutter` | identity · doing-tasks · using-tools · tone-style | `flutter` 模式 |
