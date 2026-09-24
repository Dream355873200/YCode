# 插件（plugins/）

插件是**能力的打包单位**：把一组原生工具集引用、领域规范、技能、子代理、MCP server 和右栏面板
声明在一个目录里，模式按需引用。插件是纯数据（JSON + Markdown），不写引擎代码。

```
工具集（Go 代码，toolsets.go 注册表）  ←  插件（plugins/<id>/）  ←  模式（modes/<id>/mode.json）
```

每层只引用下一层：模式不直接声明能力，插件不实现工具，只引用注册表里的工具集。

## 目录结构

```
plugins/<id>/
├── plugin.json      # 清单（必需；目录下没有 plugin.json 就不算插件）
├── rules.md         # 领域规范（可选）
├── skills/          # 技能目录（可选）
├── agents/          # 子代理目录（可选）
└── README.md        # 给人看的说明（可选，引擎不读）
```

## 清单 `plugin.json`

```jsonc
{
  "id": "android-device",                 // 必须与目录名一致
  "name": "安卓真机测试",                  // 必填
  "description": "一句话说明提供什么能力",
  "toolsets": ["device", "test-report"],  // 原生工具集引用
  "rules": "rules.md",                    // 领域规范文件（相对插件目录）
  "skills": "skills",                     // 技能目录（相对插件目录）
  "agents": "agents",                     // 子代理目录（相对插件目录）
  "mcpServers": [],                       // MCP server 声明
  "sidePanels": [{ "id": "device", "label": "手机" }]
}
```

除 `id`、`name` 外都是可选字段，按需要写。清单是**严格校验**的，以下情况引擎会拒绝启动，
并报出哪个插件的哪个字段有错：

- 出现未知字段（拼错的字段名不会被静默忽略）
- `id` 与目录名不一致，或缺少 `name`
- `toolsets` 引用了注册表里没有的工具集
- `rules` / `skills` / `agents` 指向的文件或目录不存在
- `mcpServers`、`sidePanels`、子代理定义不合规（规则见下文各节）

清单只在引擎启动时加载，修改后需要重启引擎（设置 → 模型设置 → 保存并重启）。

## 工具集 `toolsets`

引用引擎内置的原生工具集（Go 实现，见 `engine/cmd/flai-engine/toolsets.go`）。插件只能引用，
不能实现工具：

| 工具集 | 工具 | 附带的运行期机制 |
|---|---|---|
| `flutter` | `flutter` | Bash 拦截 `flutter run/attach/daemon`；`flutter test/build` 转为后台任务 |
| `device` | （无工具） | DEVICE.md 设备状态上下文（10s 刷新）；设备独占锁 |
| `test-report` | `ui_tree` `tap` `swipe` `type` `back` `wait_for` `screenshot` `screen_diff` `logcat` `net` `test_report` | — |
| `vision` | `vision_ask` | 仅 `FLAI_VISION=1` 时注册 |

完整明细以 `GET /modes` 返回的 `toolsets` 为准（设置页「工具集」tab 展示同一份数据）。
**base 工具**（Read / Write / Edit / Glob / Grep / Bash / 任务 / 计划 / 提问 / Skill …）
不属于任何工具集，对所有模式可见，不需要引用。

需要新的原生工具时：在 `engine/internal/tools` 实现，在 `toolsets.go` 注册表加一行，
再由插件引用。

## 领域规范 `rules`

一个 Markdown 文件，写这个领域必须遵守的规矩（工作流、禁令、验收标准）。引用该插件的模式，
每轮对话都会把它作为项目上下文注入。多个插件的规范按模式里的插件顺序依次注入。

规范是「每轮都要记住的约束」，篇幅要克制；「某类任务才需要的操作指南」放进技能。

## 技能 `skills`

技能目录下支持两种布局，可以混用：

```
skills/
├── testing.md             # 平铺：文件名即技能名
└── ui-style/              # 目录式：定义文件固定为 SKILL.md，
    ├── SKILL.md           #   同目录可放参考资料供正文引用
    └── styles/apple-clean.md
```

技能文件带 YAML frontmatter：

```markdown
---
name: testing
description: 一句话说明技能做什么、什么任务该用它（模型据此决定是否调用）
when-to-use: 触发时机的补充说明（设置页展示）
---

（正文：给模型的操作指引，不是给用户看的文档）
```

- `name` 缺省取文件名（目录式取目录名），`description` 缺省取正文首行
- 模型只根据 `description` 决定何时调用技能，触发条件要写进 `description`；
  `when-to-use` 可选，只在设置页展示给人看
- 技能文件每 30s 重扫一次，新增、修改、删除不用重启引擎

会话可见的技能按优先级合并：项目 `.yume/commands/` > 模式所引用插件的技能 > 全局 `skills/`。

## 子代理 `agents`

子代理是主 agent 可以委派任务的独立 agent 循环：有自己的历史和工具，跑完只把结论交回主对话。
适合「多步检索 / 探索」这类会撑爆主上下文的任务。目录下每个 `<name>.md` 是一个子代理
（`README.md` 除外），注册为工具 `Agent_<name>`：

```markdown
---
name: explore
description: 只读探索代码库，回答「X 在哪 / 怎么实现的」（主 agent 据此决定何时委派）
tools: Read, Glob, Grep
maxTurns: 30
---
你是代码探索助手……（正文即子代理的系统提示）
```

| 字段 | 规则 |
|---|---|
| `name` | 可选，缺省取文件名；全局唯一，只能含 `[A-Za-z0-9_-]` |
| `description` | 必填 |
| `tools` | 必填，逗号分隔。**只能是只读工具**，且必须是 base 工具或本插件引用的工具集里的工具 |
| `maxTurns` | 可选，正整数 |
| 正文 | 必填，作为系统提示 |

子代理的工具调用不经过主循环的审批，所以引擎启动时会校验它引用的工具全部为只读；
子代理整体因此也是只读工具，计划模式下可用。子代理运行时会被告知当前会话的工作目录。

## MCP server `mcpServers`

接入外部 MCP server，发现的工具注册为 `mcp__<server>__<tool>`。两种形态二选一：

```jsonc
"mcpServers": [
  // stdio：引擎拉起子进程，工作目录为插件目录
  { "name": "docs", "command": "node", "args": ["${PLUGIN_DIR}/mcp/server.js"],
    "env": { "DOCS_TOKEN": "${DOCS_TOKEN}" } },
  // Streamable HTTP
  { "name": "search", "url": "https://example.com/mcp",
    "headers": { "Authorization": "Bearer ${SEARCH_API_KEY}" } }
]
```

- `name` 必填、全局唯一，只能含 `[A-Za-z0-9_-]`（会进入工具名）
- `command` 与 `url` 必须二选一；`args` / `env` 只用于 stdio，`headers` 只用于 HTTP
- 变量展开：`command` / `args` / `env` / `url` / `headers` 中的 `${PLUGIN_DIR}` 展开为插件目录，
  其余 `${VAR}` 取引擎进程的环境变量。**密钥请走环境变量，不要写进清单**
- 引擎启动后在后台并行连接（单个超时 30s），不阻塞启动；连接失败只影响这一个 server，
  状态在设置页「MCP」tab 和 `GET /mcp` 查看

MCP 工具的权限级别为普通工具（按权限模式走审批）。

## 右栏面板 `sidePanels`

`{ "id", "label" }` 列表，两项都必填。引擎不解释面板内容，桌面壳按 `id` 绑定自己的面板组件
（`desktop/src/v2/pane/SidePane.tsx` 的 `MODE_PANELS`，目前有 `spec`、`test-report`、`device`），
未知 `id` 会被忽略。新面板需要在桌面壳写组件并注册。

## 可见性

插件的全部能力都**只对引用它的模式的会话生效**，同一个引擎里不同模式的会话互不干扰：

| 能力 | 生效方式 |
|---|---|
| 工具集工具、`Agent_*`、`mcp__*` | 会话工具过滤：只有模式引用了该插件的会话看得到 |
| 领域规范 | 注入这些会话的项目上下文 |
| 技能 | 进入这些会话的技能清单 |
| 右栏面板 | 当前项目的模式引用了该插件时显示 |

没有被任何模式引用的插件：清单照常校验，但不连接它的 MCP server，也不注册它的子代理。

## 验证

1. 重启引擎：清单有错时引擎拒绝启动，并在错误里指出具体字段
2. 设置 → 插件：能看到新插件和它提供的能力；子代理、MCP、技能各有自己的 tab
3. 在模式的 `modes/<id>/mode.json` 的 `plugins` 里加上插件 id，切到该模式后开始对话

也可以让 Agent 代写：全局技能 [`skill-creator`](../skills/skill-creator/SKILL.md) 知道这些约定。

## 内置插件

| 插件 | 提供 |
|---|---|
| `dev-discipline` | 与语言无关的工作纪律（规范） |
| `explore` | 只读探索子代理 `Agent_explore` |
| `flutter-dev` | `flutter` 工具集 + SPEC 驱动开发规范 + 界面风格 / 导航 / 本地数据等技能 + SPEC 面板 |
| `android-device` | `device` / `test-report` 工具集 + 分层测试技能 + 「手机」「测试报告」面板 |
| `vision` | `vision` 工具集 |
| `docx` | Word 文档技能包（创建/编辑/审阅/转换）+ 视觉验收子代理 `Agent_visual-judge` |
| `xlsx` | 电子表格技能包（场景驱动 openpyxl 工作台）+ `Agent_visual-judge` |
| `pptx` | 演示文档技能包（设计实践 + 制作/渲染管线）+ `Agent_visual-judge` |
| `pdf` | PDF 四条生产线技能包（报告/创意/LaTeX/处理）+ `Agent_visual-judge` |
| `github` | GitHub 工作流技能包（commit/pr/issue/repo/release/gist/codespace/actions/secret/setup） |
| `browser-use` | MCP `browser`（内置浏览器操作：快照引用/点击/输入/截图/console）+ 右栏「浏览器」面板 |
| `computer-use` | MCP `computer`（桌面自动化：UIA 元素树/截图/鼠标键盘，平台后端契约见插件 README） |
