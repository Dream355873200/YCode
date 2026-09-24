---
name: skill-creator
description: 创建或修改本应用的能力插件（plugins/<id>/：清单、领域规范、技能、只读子代理、MCP server），或把插件接入模式。用户说「做一个插件」「把这套流程沉淀成技能」「加一个子代理」「接一个 MCP server」「新建一个模式」时使用。
when-to-use: 用户要求创建/修改插件、技能、子代理、MCP 接入或模式
---

# 创建能力插件

插件是能力的打包单位，纯数据（JSON + Markdown），不写引擎代码。位置：`<应用根>/plugins/<id>/`
（应用根 = 含 `modes/`、`plugins/`、`skills/` 的目录，即仓库根或引擎 exe 所在目录）。
完整约定见 `<应用根>/plugins/README.md`，动手前先读它；本文是操作要点。

## 先判断放哪一层

| 需求 | 放在 |
|---|---|
| 每轮都必须遵守的领域约束（禁令、流程、验收标准） | 插件 `rules.md` |
| 某类任务才需要的操作指南 | 插件技能 `skills/<name>.md` |
| 会撑爆主上下文的多步只读检索 | 插件子代理 `agents/<name>.md` |
| 需要真实逻辑的新工具（API 调用、解析、循环） | 插件 `mcpServers` 接一个 MCP server |
| Agent 的身份 / 工作方式 | 提示词组 `prompts/<name>/`（见 `prompts/README.md`） |
| 需要引擎内部状态的原生工具（设备锁、任务系统） | 不能做成插件——告诉用户需要在引擎 `toolsets.go` 注册新工具集 |

## 1. 清单 plugin.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "description": "一句话说明提供什么能力",
  "toolsets": [],
  "rules": "rules.md",
  "skills": "skills",
  "agents": "agents",
  "mcpServers": [],
  "sidePanels": []
}
```

- 只有 `id`、`name` 必填；**不用的字段整行删掉**，不要留空字符串
- `id` 必须等于目录名，kebab-case
- 只允许上面这些字段：清单严格校验，多写一个字段（比如 `tools`）引擎就拒绝启动
- `toolsets` 只能引用已注册的工具集：`flutter`、`device`、`test-report`、`vision`
  （最新列表以 `GET http://127.0.0.1:8420/modes` 的 `toolsets` 为准）。base 工具
  （Read/Write/Edit/Glob/Grep/Bash 等）对所有模式可见，不用引用
- `rules` / `skills` / `agents` 指向的文件或目录必须存在
- `sidePanels` 只能用桌面壳已有的面板 id：`spec`、`test-report`、`device`；需要新面板就告诉用户要写前端组件

## 2. 技能 skills/

平铺 `skills/<name>.md`，或目录式 `skills/<name>/SKILL.md`（同目录可放参考资料）：

```markdown
---
name: my-skill
description: 做什么 + 什么任务该用它（模型只凭这一句决定是否调用）
when-to-use: 触发时机补充（只在设置页展示）
---

正文是给模型的操作指引：步骤、判断标准、易错点。不是给用户看的文档。
```

## 3. 子代理 agents/

每个 `agents/<name>.md` 注册为工具 `Agent_<name>`：

```markdown
---
name: my-agent
description: 主 agent 据此决定何时委派（写清适用 / 不适用的场景）
tools: Read, Glob, Grep
maxTurns: 30
---
正文即子代理的系统提示：职责、检索方法、结论格式（路径 + 行号 + 要点）。
```

- `description`、`tools`、正文必填；`name` 只能含 `[A-Za-z0-9_-]`，全局唯一
- `tools` **只能是只读工具**（子代理的工具调用不经审批），且必须是 base 工具或本插件
  `toolsets` 里的工具。Write/Edit/Bash 都不行

## 4. MCP server

```json
"mcpServers": [
  { "name": "docs", "command": "node", "args": ["${PLUGIN_DIR}/mcp/server.js"], "env": { "TOKEN": "${DOCS_TOKEN}" } },
  { "name": "search", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${SEARCH_KEY}" } }
]
```

- `name` 必填、全局唯一、只能含 `[A-Za-z0-9_-]`；工具名为 `mcp__<name>__<tool>`
- `command` 与 `url` 二选一；`args`/`env` 只配 command，`headers` 只配 url
- `${PLUGIN_DIR}` 展开为插件目录，其他 `${VAR}` 取环境变量——**密钥一律走环境变量**，
  不要写进清单，也不要替用户把密钥写进任何文件

## 5. 接入模式

插件的能力只对引用它的模式生效。在 `<应用根>/modes/<mode>/mode.json` 的 `plugins`
数组里加上插件 id（顶层字段，顺序决定规范的注入顺序）。

新建模式时，`mode.json` 只允许这些字段：`id`（= 目录名）、`name`、`description`、
`prompts`（提示词组名，可省略）、`plugins`、`projectFields`（必须含 `"type": "folder"`
的 `dir` 字段；类型只有 text / textarea / folder / choice）、`scaffold`（可省略）。

## 6. 验证

1. 清单和子代理定义在引擎启动时加载：改完请用户到「设置 → 模型设置」保存并重启引擎。
   清单有错时引擎拒绝启动，会报出哪个文件的哪个字段有问题——照着修
2. 技能文件 30 秒内自动重扫，不用重启
3. 让用户在设置页查看：插件 tab 能看到新插件；子代理、MCP、技能各有自己的 tab
   （MCP tab 显示连接状态和发现的工具）
4. 把项目切到引用该插件的模式，新开一轮对话实测

## 约定

- 资产只放应用目录（`plugins/`、`skills/`、`modes/`、`prompts/`），不写用户家目录
- 插件之间不互相依赖；需要共享的逻辑抽成 MCP server
- 改内置插件前先确认用户要改的是内置插件，而不是新建一个
