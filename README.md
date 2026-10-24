# YCode — 对话为中心的多智能体桌面工作台

一个引擎，多个**智能体**。**代码**是通用编程智能体：打开任意目录，读写代码、跑命令、调试、重构、
操作浏览器与桌面。**Flutter 应用**在通用能力之上叠加领域能力，把一句产品想法变成跑在你手机上的 App：
SPEC 驱动开发、真机实测、视觉验收、改完即热重载。另有**办公文档**与**游戏伙伴**。

工作以**对话**为单位：一个项目里可以并行开多段对话，每段对话有自己的智能体、权限与目标；
需要多个智能体配合时组建**团队**，团队本身也是一种对话。

智能体、插件、技能、工具集、提示词都是**声明式清单 + 注册表**。新增一个领域（Web、数据分析、
小程序……）主要靠写清单和 Markdown，不用改内核。

本地桌面产品：Electron + React 桌面壳，Go 单二进制引擎（基于 [GoAgent](https://github.com/Dream355873200/GoAgent)），
接任意 OpenAI 兼容模型端点。设计说明见 [docs/ycode2-design.md](docs/ycode2-design.md)。

---

## 核心概念

| 名词 | 是什么 | 在哪里 |
|---|---|---|
| 插件 | 能力包：工具、技能、子代理、MCP、右栏面板、领域规范 | 设置 > 插件（启停、交给哪些智能体） |
| 智能体 | 一套指令 + 一组插件 = 一种工作者（引擎内部叫 mode，清单是 `mode.json`） | 设置 > 智能体；输入框随时切换 |
| 对话 | 在某个项目里与一个智能体协作的一条任务线，可并行 | 侧栏：项目 → 对话 |
| 团队 | 多个智能体各带身份常驻协作的群聊；队长拆解分派，成员执行汇报 | 侧栏：项目 → 团队 |
| 权限 | 对话级：规划（只读）/ 逐项审批 / 自动编辑 / 完全放行 | 输入框 |
| 目标 | 对话持续推进直到验收通过；每轮结束自动验收，未通过就续跑 | 输入框「目标」开关 |

## 特性

- **项目 → 多对话**：新对话是草稿，发出第一条消息才创建；首轮结束后模型起标题（手动改过的不覆盖）；
  侧栏显示运行中 / 等你回答 / 等你批准 / 未读，支持重命名、归档、删除（右键或「…」）。
- **对话状态胶囊**：对话区右上角一枚胶囊，智能体头像 + 当前最要紧的一条状态（流水线、正在做的任务、
  目标、本轮改动）+ 子代理与后台任务计数；展开是目标 / 进程 / 协作 / 终端 / 计划 / 工作区面板。
- **目标续跑**：把一条消息设为目标，智能体一轮轮推进，每轮由模型验收并给出下一步；叫停或出错即暂停。
- **团队即对话**：群聊占主区，成员时间线在右栏；`@成员` 路由，忙时插话、闲时作为新任务。
- **变更审查**：逐文件 +/−、diff、撤销单文件、提交（可让 AI 写提交说明）、分支切换与推送。
- **运行到手机**：Flutter 项目一键构建安装启动并自动投屏，热重载 / 热重启；对话改完 Dart 代码自动热重载。
- **对话即过程**：思考块、工具调用和 diff 统计按真实执行顺序交错直播，连续的探索动作自动折叠成组。
  运行中可以插话或排队，提问可以中断，重载后未答的提问和进行中的流都能恢复。
- **命令面板 Ctrl+K**：跨项目搜对话、项目与文件，执行常用操作。
- **会话级多智能体**：一个引擎进程同时服务所有项目与对话；切换智能体只改对话绑定，**不重启引擎**。
- **分层元组件**：原生工具集 → 插件 → 智能体，职责单一、依赖单向。清单严格校验，坏清单只跳过该项并报错。
- **插件可扩展**：插件除了规范和技能，还能带只读子代理（注册为 `Agent_<name>`）和 MCP server
  （stdio / Streamable HTTP，工具名 `mcp__<server>__<tool>`），只对拿到它的智能体生效。
- **设置即能力目录**：智能体页逐个开关插件，插件页直接选择交给哪些智能体；内置智能体被改动时
  自动保存为你的自定义版本，可一键恢复默认。

## 内置智能体

| 智能体 | id | 插件 | 添加项目 |
|---|---|---|---|
| 代码 | `code` | `dev-discipline` · `explore` · `orchestration` · `github` · `docx` · `xlsx` · `pptx` · `pdf` · `browser-use` · `computer-use` | 打开已有目录 |
| Flutter 应用 | `flutter` | `flutter-dev` · `android-device` · `vision` · `explore` · `orchestration` | `flutter-app` 脚手架（flutter create + SPEC + git init） |
| 办公文档 | `office` | `docx` · `xlsx` · `pptx` · `pdf` · `browser-use` · `orchestration` | 打开已有目录 |
| 游戏伙伴 | `games` | `minecraft` · `stardew` | 打开已有目录 |

| 插件 | 提供 |
|---|---|
| `dev-discipline` | 与语言无关的工作纪律：反偷懒、批量编辑、验证闭环、测试完整性、提交纪律 |
| `explore` | 只读探索子代理 `Agent_explore`：多步检索在独立上下文里跑完，只把结论交回主对话 |
| `orchestration` | `create_pipeline`（动态 DAG 流水线）、`run_team`（一次性多角色协作）、`team_dispatch`（向常驻团队派活） |
| `github` | GitHub 工作流技能：提交、PR、Issue、Release、Actions 等 |
| `docx` / `xlsx` / `pptx` / `pdf` | Office 文档与 PDF 的制作、编辑、审阅与格式转换 |
| `browser-use` | 操作内置浏览器（右栏可见）：导航、快照引用、点击输入、截图、console 验证 |
| `computer-use` | 自动化桌面应用：UIA 语义树 + 截图 + 键鼠 |
| `flutter-dev` | `flutter` 工具集 + SPEC 驱动开发规范 + 界面风格、导航、本地数据等技能 + SPEC 面板 |
| `android-device` | `device` / `test-report` 工具集 + 分层测试技能 + 「手机」「测试报告」面板 |
| `vision` | `vision` 工具集（`vision_ask` 多模态目视裁决，需 `FLAI_VISION=1`） |
| `minecraft` / `stardew` | 进游戏干活的意图级工具（MCP） |

## 能力分层

```
┌────────────────────────────────────────────────────────────────┐
│ 智能体 modes/<id>/mode.json                                    │
│   = 提示词组（可选） + 插件列表 + 图标 / 开场建议               │
│     + 添加项目表单 + 脚手架（可选）                             │
└──────────────┬─────────────────────────────────────────────────┘
               │ 引用
┌──────────────┴─────────────────────────────────────────────────┐
│ 插件 plugins/<id>/plugin.json                                  │
│   = 工具集引用 + 领域规范 rules.md + 技能目录 + 右栏面板       │
│     + 只读子代理 agents/ + MCP server                          │
└──────────────┬─────────────────────────────────────────────────┘
               │ 引用
┌──────────────┴─────────────────────────────────────────────────┐
│ 原生工具集  engine/cmd/flai-engine/toolsets.go 注册表（Go 代码）│
│   flutter · device · test-report · vision · orchestration …    │
└────────────────────────────────────────────────────────────────┘
  base 工具（Read/Write/Edit/Glob/Grep/Bash/Task/Plan/AskUser…）不属于任何工具集，所有智能体都有
  提示词组 prompts/<name>/：只放需要覆盖的段落，缺的段落回退 GoAgent 内置默认值
  全局技能 skills/：所有智能体可用（如 skill-creator）
```

**依赖方向**：智能体 → 插件 → 工具集，内核不 import 任何具体智能体；智能体之间互不感知。
**机制进内核，内容进清单**：引擎只提供注册表和会话级过滤，工具集、技能、规范、面板都由清单挑选。

### 清单示例

```jsonc
// modes/flutter/mode.json
{
  "id": "flutter",                      // 必须与目录名一致
  "name": "Flutter 应用",
  "description": "从一句想法到可运行的 Flutter 应用：SPEC 驱动开发、真机实测、视觉验收",
  "icon": "smartphone",                 // 图标键（桌面壳映射到 lucide）
  "starters": [                         // 空对话里的开场建议（≤ 6 条，点击填进输入框）
    { "label": "从想法建 App", "prompt": "我想做一个 App：" }
  ],
  "prompts": "flutter",                 // prompts/flutter/；省略 = 内置通用提示词
  "plugins": ["flutter-dev", "orchestration", "android-device", "vision", "explore"],
  "scaffold": "flutter-app",            // desktop/electron/lib/scaffolds.js 注册表；省略 = 打开已有目录
  "projectFields": [                    // text | textarea | folder | choice；必须含 folder 类型的 dir
    { "id": "name", "label": "项目名称", "type": "text", "required": true },
    { "id": "dir",  "label": "项目目录", "type": "folder", "required": true },
    { "id": "kind", "label": "应用形态", "type": "choice", "default": "app",
      "options": [{ "value": "app", "label": "纯移动 App" }, { "value": "go", "label": "App + Go 后端" }] }
  ]
}
```

```jsonc
// plugins/android-device/plugin.json
{
  "id": "android-device",
  "name": "安卓真机测试",
  "toolsets": ["device", "test-report"], // 必须是 toolsets.go 注册表里的词
  "rules": "rules.md",                   // 领域规范，注入启用该插件的会话上下文
  "skills": "skills",                    // 技能目录（YAML frontmatter Markdown）
  "sidePanels": [{ "id": "device", "label": "手机" }, { "id": "test-report", "label": "测试报告" }]
}
```

### 扩展：新增一个智能体

1. **只用现有能力**：在 设置 > 智能体 点「新建智能体」（或手写 `modes/<id>/mode.json`），挑选插件、
   图标与开场建议。不用改代码。
2. **需要新的领域知识**：新建 `plugins/<id>/`，写 `rules.md`、`skills/*.md`，需要时加只读子代理
   `agents/*.md`（可以用全局技能 `skill-creator` 让智能体帮你写），然后把插件交给智能体。
   完整约定见 [plugins/README.md](plugins/README.md)。
3. **需要新的提示词风格**：新建 `prompts/<name>/`，只放要覆盖的段落，例如 `system-identity.prompt.md`。
   分段说明见 [prompts/README.md](prompts/README.md)。
4. **需要新的工具**：外部逻辑优先接 MCP server（插件 `mcpServers`，不用改引擎；回包须带 `"jsonrpc": "2.0"`）；
   需要引擎内部状态的原生工具才在 `engine/internal/tools` 实现，在 `toolsets.go` 注册表加一行，再让插件引用它。
5. **需要新的右栏面板或脚手架**：面板组件注册到 `desktop/src/v2/pane/SidePane.tsx` 的 `MODE_PANELS`，
   脚手架注册到 `desktop/electron/lib/scaffolds.js`。

引擎启动时一次性加载并严格校验全部智能体和插件：未知字段、id 与目录名不一致、引用不存在，
都会报出具体哪个清单的哪个字段有错；坏清单只跳过该项，设置页显示错误。

## 架构

```
┌─ 桌面壳 desktop/ ── Electron + React 18 + Vite + Tailwind 4 ────────┐
│ 主进程：引擎子进程生命周期 · 项目注册表 · git / 文件 / 资产 IPC      │
│         adb 设备轮询与自愈 · scrcpy 4.1 双通道桥接 · flutter daemon │
│         脚手架注册表（scaffolds.js）· 内置浏览器                    │
│ 渲染层：侧栏 项目 → 对话 / 团队 │ 对话 + 状态胶囊 │ 右栏面板         │
└──────────────┬──────────────────────────────────────────────────────┘
               │ HTTP + SSE（统一信封协议，goagent-client TS SDK）
┌──────────────┴──────────────────────────────────────────────────────┐
│ 引擎 engine/ ── flai-engine（Go 单二进制，基于 GoAgent）            │
│ 能力目录：加载 modes/ plugins/ prompts/ skills/，严格校验           │
│ 对话注册表：对话 → {项目目录, 智能体, 标题, 权限, 目标}（唯一写入方）│
│   → 工具过滤 · 提示词目录 · 规范/上下文注入 · 技能注册表            │
│ 协作：常驻团队（群聊 / 插话 / 审批）· 流水线 · 子代理 Agent_*       │
│ 插件扩展：MCP 客户端（后台连接 mcp__*）                             │
│ 通用机制：会话持久化 · 任务/计划 · 后台任务 · 运行中插话/排队       │
│           未决提问恢复 · 对话级权限 · 上下文压缩与重注入            │
│ 发现端点：GET /threads /teams /modes /plugins /skills /prompts /mcp │
└──────────────┬──────────────────────────────────────────────────────┘
               │ git / Bash / flutter / adb …
      目标项目（.yume/：sessions · tasks · plans · shots · test-reports）
```

### 桌面 UI

- **侧栏**：项目分组，组内是对话与团队；新对话、搜索（Ctrl+K）、添加项目（按智能体声明渲染表单）
- **顶栏**：项目 / 对话标题（双击改名）、运行指示、本项目的改动 +/−（点开变更审查）
- **对话**：流式渲染思考、工具卡和 diff 统计，探索组可折叠；支持插话、排队、中断（Esc），
  提问卡可以跨重载恢复；右上角状态胶囊
- **输入框**：智能体、权限、目标、模型与思考强度、上下文用量
- **右栏**：变更、浏览器、任务、计划、流水线，加上当前智能体的插件声明的面板
  （Flutter 应用：SPEC、测试报告、手机）
- **设置**：通用（常规 / 模型）· 能力（智能体 / 插件 / 技能）· 进阶（提示词 / 工具集 / 子代理 / MCP）· 关于

## Flutter 应用智能体

### 运行到手机

「手机」面板：选设备 → 运行（构建、安装、启动并自动投屏）→ 热重载 / 热重启 / 停止，日志尾随手可看。
对话一轮改完 Dart 代码后，若应用正在运行就自动热重载（面板里可关）。

### 复合自动化测试（L1–L6）

| 层 | 工具 | 说明 |
|---|---|---|
| L1 静态 | `flutter analyze` | 语法/类型检查，自修复循环最多 5 轮 |
| L2 测试 | `flutter test` | 单元/Widget 测试（转后台任务，完成后自动回注结果） |
| L3 语义树 | `ui_tree` / `tap` / `swipe` / `type` / `back` / `wait_for` / `logcat` | 真机行为验证，E2E 主力；输入串行、设备独占锁 |
| L4 视觉 | `screenshot`（稳定检测）/ `screen_diff` | 像素对比断言，不需要模型 |
| L5 多模态 | `vision_ask`（`FLAI_VISION=1` 才注册） | 视觉裁决；模型不支持图片输入时该工具不存在 |
| L6 网络 | `net`（reverse / record / mock） | 前后端联调 + 异常分支测试 |

迭代中跑轻量冒烟（每个功能一条核心路径），收尾时全量执行：技能 `testing` 分层策略 → `test_report`
落盘 Markdown 报告 → 在「测试报告」面板展示截图证据。

### Web 原生投屏（自研 scrcpy 4.1 客户端）

`@yume-chan/*` 生态最高只支持 server 3.x，在 Android 16 上不可用，因此本项目自研了 4.1 Web 客户端：

1. 主进程建立 video + control 两条 TCP 通道。
2. 数据按 16ms 攒批，经 IPC 送到 Worker。
3. Worker 零拷贝解析：标志包格式、Annex-B → AVCC、SPS+PPS 构造解码配置。
4. WebCodecs 硬件解码，经 OffscreenCanvas 上屏。
5. 触控、滚轮、返回键从 control 通道注入。

## 目录

| 目录 | 内容 |
|---|---|
| `engine/` | Go 引擎：`cmd/flai-engine`（能力目录、对话注册表、目标、团队、工具集注册表、HTTP 路由），`internal/tools`（领域工具） |
| `desktop/` | Electron 桌面壳：`electron/`（主进程）、`src/v2/`（界面）、`src/lib/`（共用渲染模块） |
| `modes/` | 内置智能体清单（`code`、`flutter`、`office`、`games`） |
| `plugins/` | 插件包（清单 + 规范 + 技能 + 子代理 + MCP），见 [plugins/README.md](plugins/README.md) |
| `prompts/` | 提示词组（只放覆盖段落），见 [prompts/README.md](prompts/README.md) |
| `skills/` | 全局技能（所有智能体可用） |
| `tools/` | 随应用分发的第三方二进制（scrcpy server） |
| `docs/` | 设计文档（[ycode2-design.md](docs/ycode2-design.md)、[mode-platform.md](docs/mode-platform.md)）、UI 原型、[GOAGENT_CHANGES.md](docs/GOAGENT_CHANGES.md)（对 GoAgent 库的改动记录） |

## 快速开始

依赖：Go 1.25+，Node 18+，一个支持 tool calling 的 OpenAI 兼容模型端点。Flutter 应用智能体另需 Flutter SDK 和 adb。

```bash
# ---------- 引擎 ----------
cd engine
go build -o flai-engine.exe ./cmd/flai-engine
FLAI_MODEL=<模型名> FLAI_BASE_URL=<端点> FLAI_API_KEY=<密钥> ./flai-engine.exe
curl http://127.0.0.1:8420/health

# ---------- 桌面壳 ----------
cd desktop
npm install
npm run dev        # vite + electron 热更；壳会自动拉起/重启引擎
```

模型、端点、API Key 可以在应用内「设置 → 模型」配置，保存在 Electron userData 目录下的
`config.json`（Windows：`%APPDATA%/amobilecreater-desktop/`），不会进仓库。

### 引擎配置

每项都可以用环境变量设置，也可以用同名命令行参数设置（如 `--addr`、`--model`）。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `FLAI_ADDR` | `127.0.0.1:8420` | HTTP 监听地址 |
| `FLAI_BASE_URL` | `http://localhost:11434/v1` | OpenAI 兼容端点 |
| `FLAI_MODEL` | `qwen2.5:7b` | 模型名，必须支持 tool calling |
| `FLAI_API_KEY` | 空 | 端点密钥 |
| `FLAI_CONTEXT_WINDOW` | `1000000` | 上下文窗口，决定压缩阈值，须与模型实际窗口一致 |
| `FLAI_MAX_OUTPUT_TOKENS` | `393216` | 最大输出（推理模型的思考也占这部分额度） |
| `FLAI_MODE` | `code` | 默认智能体（适用于没有记录智能体的对话） |
| `FLAI_ROOT` | 自动探测 | 应用资产根目录（含 modes/plugins/skills） |
| `FLAI_MODES_DIR` / `FLAI_PLUGINS_DIR` / `FLAI_PROMPTS_DIR` / `FLAI_GLOBAL_SKILLS` | 资产根下同名目录 | 单独覆盖某类资产目录 |
| `FLAI_VISION` | 未设置 | 设为 `1` 时注册 `vision_ask`（需模型支持图片输入） |
| `FLAI_ADB` / `FLAI_DEVICE` | 自动探测 | adb 路径 / 指定设备序列号 |

## 路线图

- [x] 引擎骨架：GoAgent daemon（HTTP/SSE 全端点）+ flutter 工具，最小闭环验证（生成 → analyze → 自修复）
- [x] 桌面壳：SSE 对话直播、会话持久化与断点续传、任务/计划/文件树
- [x] 设备：adb 自动检测与自愈、自研 scrcpy 4.1 投屏、flutter run 部署 + Hot Reload
- [x] L1–L6 复合自动化测试 + 测试报告
- [x] v2 对话 UI：执行序直播、探索组折叠、插话/排队、提问跨重载恢复
- [x] 模式平台 P1：工具集 → 插件 → 模式三层、会话级多模式（切换不重启）、声明式新建项目、设置页能力目录
- [x] 插件扩展：插件内只读子代理、MCP 客户端（stdio / Streamable HTTP）、项目路径哈希会话 ID
- [x] 多 Agent 协作：流水线（动态 DAG）、一次性团队、常驻团队（群聊 / 插话 / 审批）
- [x] YCode 2.0：项目 → 多对话、对话级权限、AI 标题、状态胶囊、目标续跑、团队即对话、变更审查、
      命令面板、设置页双向开关、运行到手机与自动热重载
- [ ] 子代理会话注入（pipeline 路径）、通用产物（artifact）面板
- [ ] 更多智能体（Web 前端等）与第三方插件分发
- [ ] 模拟器自动拉起兜底（无真机时）
