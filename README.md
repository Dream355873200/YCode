# YCode — 模式化的桌面 AI 开发 Agent

一个引擎，多种「模式」。**code 模式**是通用代码 Agent：打开任意目录，读写代码、跑命令、调试、重构。
**flutter 模式**在通用能力之上叠加领域能力，把一句产品想法变成可运行的 Flutter App：SPEC 驱动开发、
真机实测、视觉验收。

模式、插件、技能、工具集、提示词都是**声明式清单 + 注册表**。新增一个领域（Web、数据分析、
小程序……）主要靠写清单和 Markdown，不用改内核。

本地桌面产品：Electron + React 桌面壳，Go 单二进制引擎（基于 [GoAgent](https://github.com/Dream355873200/GoAgent)），
接任意 OpenAI 兼容模型端点。

> UI 蓝图（可交互原型，浅/深双主题）：[docs/mockup/index.html](docs/mockup/index.html)，浏览器直接打开

---

## 特性

- **会话级多模式**：一个引擎进程同时服务多个项目，每个项目绑定自己的模式；切换模式只改会话绑定，
  **不重启引擎**。工具、提示词、领域规范和技能清单会在下一轮对话生效。
- **分层元组件**：原生工具集 → 插件 → 模式，职责单一、依赖单向。清单严格校验，写错直接拒绝启动，
  不会静默降级。
- **对话即过程**：思考块、工具调用和 diff 统计按真实执行顺序交错直播，连续的探索动作自动折叠成组。
  运行中可以插话或排队，提问可以中断，重载后未答的提问和进行中的流都能恢复。
- **声明式新建项目**：新建表单由模式的 `projectFields` 渲染，模式声明了 `scaffold` 就生成工程，
  否则打开已有目录。
- **flutter 模式专属**：L1–L6 复合自动化测试、自研 scrcpy 4.1 Web 投屏、`flutter run` 部署与
  Hot Reload、设备状态注入、测试报告面板。
- **设置页即能力目录**：模式、工具集、插件、技能、提示词、MCP 分 tab 展示，每个元件都标出被谁引用。

## 内置模式

| 模式 | 定位 | 插件 | 提示词 | 新建项目 |
|---|---|---|---|---|
| `code` | 通用代码 Agent | `dev-discipline` | 内置通用 Agent 提示词 | 打开已有目录 |
| `flutter` | 自然语言 → Flutter App | `flutter-dev` · `android-device` · `vision` | `prompts/flutter` | `flutter-app` 脚手架（flutter create + SPEC + git init） |

| 插件 | 提供 |
|---|---|
| `dev-discipline` | 与语言无关的工作纪律：反偷懒、批量编辑、验证闭环、测试完整性、提交纪律 |
| `flutter-dev` | `flutter` 工具集 + SPEC 驱动开发规范 + 界面风格、导航、本地数据等技能 + SPEC 面板 |
| `android-device` | `device` / `test-report` 工具集 + 分层测试技能 + 「手机」「测试报告」面板 |
| `vision` | `vision` 工具集（`vision_ask` 多模态目视裁决，需 `FLAI_VISION=1`） |

## 能力分层

```
┌────────────────────────────────────────────────────────────────┐
│ 模式 modes/<id>/mode.json                                      │
│   = 提示词组（可选） + 插件列表 + 新建项目字段 + 脚手架（可选） │
└──────────────┬─────────────────────────────────────────────────┘
               │ 引用
┌──────────────┴─────────────────────────────────────────────────┐
│ 插件 plugins/<id>/plugin.json                                  │
│   = 工具集引用 + 领域规范 rules.md + 技能目录 + 右栏面板       │
│     + MCP / 子代理声明位                                       │
└──────────────┬─────────────────────────────────────────────────┘
               │ 引用
┌──────────────┴─────────────────────────────────────────────────┐
│ 原生工具集  engine/cmd/flai-engine/toolsets.go 注册表（Go 代码）│
│   flutter · device · test-report · vision                       │
└────────────────────────────────────────────────────────────────┘
  base 工具（Read/Write/Edit/Glob/Grep/Bash/Task/Plan/AskUser…）不属于任何工具集，对所有模式可见
  提示词组 prompts/<name>/：只放需要覆盖的段落，缺的段落回退 GoAgent 内置默认值
  全局技能 skills/：对所有模式生效（如 skill-creator）
```

**依赖方向**：模式 → 插件 → 工具集，内核不 import 任何具体模式；模式之间互不感知。
**机制进内核，内容进清单**：引擎只提供注册表和会话级过滤，工具集、技能、规范、面板都由清单挑选。

### 清单示例

```jsonc
// modes/flutter/mode.json
{
  "id": "flutter",                      // 必须与目录名一致
  "name": "Flutter 开发",
  "description": "自然语言 → 可运行的 Flutter 应用",
  "prompts": "flutter",                 // prompts/flutter/；省略 = 内置通用提示词
  "plugins": ["flutter-dev", "android-device", "vision"],
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

### 扩展：新增一个模式

1. **只用现有能力**：新建 `modes/<id>/mode.json`，挑选插件、写 `projectFields`。不用改代码。
2. **需要新的领域知识**：新建 `plugins/<id>/`，写 `rules.md` 和 `skills/*.md`（可以用全局技能
   `skill-creator` 让 Agent 帮你写），然后在模式里引用它。
3. **需要新的提示词风格**：新建 `prompts/<name>/`，只放要覆盖的段落，例如 `system-identity.prompt.md`。
4. **需要新的原生工具**：在 `engine/internal/tools` 实现工具，在 `toolsets.go` 注册表加一行，再让插件引用它。
5. **需要新的右栏面板或脚手架**：面板组件注册到 `desktop/src/v2/pane/SidePane.tsx` 的 `MODE_PANELS`，
   脚手架注册到 `desktop/electron/lib/scaffolds.js`。

引擎启动时会一次性加载并严格校验全部模式和插件：未知字段、id 与目录名不一致、引用不存在，
都会拒绝启动，并报出具体哪个清单的哪个字段有错。

## 架构

```
┌─ 桌面壳 desktop/ ── Electron + React 18 + Vite + Tailwind 4 ────────┐
│ 主进程：引擎子进程生命周期 · 项目注册表 · 会话绑定（session-map.json）│
│         adb 设备轮询与自愈 · scrcpy 4.1 双通道桥接 · flutter daemon │
│         脚手架注册表（scaffolds.js）                                 │
│ 渲染层：侧栏项目列表 │ 对话 │ 右栏面板（Git/任务/计划 + 模式面板）  │
└──────────────┬──────────────────────────────────────────────────────┘
               │ HTTP + SSE（统一信封协议，goagent-client TS SDK）
┌──────────────┴──────────────────────────────────────────────────────┐
│ 引擎 engine/ ── flai-engine（Go 单二进制，基于 GoAgent）            │
│ 能力目录：加载 modes/ plugins/ prompts/ skills/，严格校验           │
│ 会话级解析：会话 → {项目目录, 模式}                                 │
│   → 工具过滤 · 提示词目录 · 规范/上下文注入 · 技能注册表            │
│ 通用机制：会话持久化 · 任务/计划 · 后台任务 · 运行中插话/排队       │
│           未决提问恢复 · 权限模式 · 上下文压缩与重注入              │
│ 发现端点：GET /modes /plugins /skills /prompts（设置页数据源）      │
└──────────────┬──────────────────────────────────────────────────────┘
               │ git / Bash / flutter / adb …
      目标项目（.yume/：sessions · tasks · plans · shots · test-reports）
```

### 桌面 UI

- **标题栏**：项目名 + 模式切换器（切换即生效、不重启）
- **侧栏**：项目列表，新建项目（按模式声明渲染表单）
- **对话**：流式渲染思考、工具卡和 diff 统计，探索组可折叠；支持插话、排队、中断，
  提问卡可以跨重载恢复
- **右栏**：通用面板（Git、任务、计划），加上当前模式声明的面板（flutter：SPEC、测试报告、手机）；
  切换模式后，原先选中的 tab 在切回来时会恢复
- **设置**：常规、模型、模式、工具集、插件、技能、提示词、MCP

## flutter 模式

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
| `engine/` | Go 引擎：`cmd/flai-engine`（能力目录、会话映射、工具集注册表、HTTP 路由），`internal/tools`（领域工具） |
| `desktop/` | Electron 桌面壳：`electron/`（主进程）、`src/v2/`（当前 UI）、`src/`（legacy UI，逐步下线） |
| `modes/` | 模式清单（`code`、`flutter`） |
| `plugins/` | 插件包（清单 + 规范 + 技能） |
| `prompts/` | 提示词组（只放覆盖段落） |
| `skills/` | 全局技能（对所有模式生效） |
| `tools/` | 随应用分发的第三方二进制（scrcpy server） |
| `docs/` | 设计文档、UI 原型、[GOAGENT_CHANGES.md](docs/GOAGENT_CHANGES.md)（对 GoAgent 库的改动记录） |

## 快速开始

依赖：Go 1.25+，Node 18+，一个支持 tool calling 的 OpenAI 兼容模型端点。flutter 模式另需 Flutter SDK 和 adb。

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

模型、端点、API Key 可以在应用内「设置 → 模型设置」配置，保存在 Electron userData 目录下的
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
| `FLAI_MODE` | `flutter` | 默认模式（适用于未绑定模式的会话） |
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
- [ ] 子代理会话注入（pipeline 路径）、MCP 客户端接入、插件内子代理
- [ ] 更多模式包（Web 前端等）与第三方插件分发
- [ ] 多 Agent 协作（pipeline / team）作为独立于模式的平台能力
- [ ] 模拟器自动拉起兜底（无真机时）
