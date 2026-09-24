---
name: skill-creator
description: 创建或修改本应用的能力插件（plugins/<id>/）：清单、技能目录、声明式命令工具、MCP server。当用户要求「做一个插件」「新增一个工具」「把这套流程沉淀成技能」时使用。
when-to-use: 用户要求创建插件、封装新工具、把重复流程沉淀为可复用能力
---

# 创建能力插件

本应用的插件 = `plugins/<id>/` 目录（`<应用根>` 即仓库根/engine exe 同级），纯数据 + 可选脚本，不写引擎代码。

## 目录结构

```
plugins/<id>/
├── plugin.json      # 清单（必需）
├── skills/          # 技能目录（可选）
│   └── <skill-name>/SKILL.md
├── tools/           # 声明式命令工具的脚本资产（可选）
└── mcp/             # MCP server 脚本（可选）
```

## plugin.json 清单

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "description": "一句话说明能力",
  "skills": "skills",
  "toolsets": [],
  "tools": [],
  "mcpServers": [],
  "sidePanels": []
}
```

字段说明：
- `id`：目录名一致，kebab-case
- `toolsets`：引用引擎内注册的代码工具集（如 `base-files`、`flutter-device`）——只能引用，不能实现
- `tools`：声明式命令工具（见下），适合「一条命令能搞定」的能力
- `mcpServers`：MCP server 声明，适合有真实逻辑的工具（循环/API 调用/解析）
- `sidePanels`：桌面壳右栏面板槽位 `{"id": "...", "label": "..."}`

## 技能（skills/<name>/SKILL.md）

```markdown
---
name: my-skill
description: 一句话（模型据此决定何时调用）
when-to-use: 什么任务该触发本技能
---

（给模型的操作指引正文，可引用同目录参考文件）
```

frontmatter 必填 `name`/`description`；正文是给模型的指令，不是给用户的文档。

## 声明式命令工具

```json
{
  "name": "device_tap",
  "description": "在手机屏幕坐标处点击",
  "params": {"type": "object", "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}}, "required": ["x", "y"]},
  "run": "adb shell input tap {x} {y}"
}
```

执行 = 参数替换进 `run` 模板，走引擎 Bash 通道（会话工作目录、审批链路复用）。只适合单命令能表达的逻辑。

## MCP server（有真实逻辑的工具）

```json
{ "mcpServers": [{ "command": "python", "args": ["mcp/server.py"] }] }
```

server 脚本是 stdio MCP（stdin/stdout JSON-RPC），可用 Python/Node/bash。截屏类工具用 MCP image content 返回图片。

## 创建后验证

1. `GET http://127.0.0.1:8420/plugins` 能看到新插件（引擎 30s 内重扫，或重启）
2. 技能出现在 Skill 工具列表；声明式工具的参数 schema 能被模型正确填充
3. 模式要引用插件时在 `modes/<mode>/mode.json` 的 `engine.plugins` 里加插件 id

## 约定

- 资产只放应用目录（plugins/ skills/ modes/），不进用户家目录
- 工具需要引擎内部状态（设备共享、任务系统）→ 不做插件，提需求给引擎层
- 插件之间不互相依赖；需要共享逻辑就复制或抽成 MCP server
