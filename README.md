# amobileCreater — Flutter AI 自动开发产品

面向「有产品想法、不写代码」的用户：描述想法 → 与 AI 敲定 SPEC → AI 自动开发
（Flutter App + Go 后端）→ AI 自动测试 → 对话反馈迭代。本地桌面产品，专注
Flutter（二期 React Native）。

> 产品效果蓝图（三屏交互原型，浅/深双主题）：**[docs/mockup/index.html](docs/mockup/index.html)**
> —— 浏览器直接打开，所有页签/思考块/行动条目均可交互。

## 核心概念

| 概念 | 说明 |
|---|---|
| **SPEC.md** | 范围契约。由「想法描述 + AI 追问」推导生成，用户可编辑；中途加需求自动升版（v3→v4），变更以 diff 形式出现在对话流 |
| **计划（Plan）** | AI 撰写的原始 Markdown 计划文本（含技术选型理由、文件级变更、验收标准），呈现于对话流等批准；批准后物化为左侧任务流。数据源 = goagent Plan Mode |
| **任务卡** | 计划的执行单元，分 FLUTTER / GO / TEST 三类；每张卡走「生成 → analyze → 自修复（≤5 轮）」循环，零 error 才算完成 |
| **决策点** | engine 在关键节点自动 `git commit`：SPEC 升版 / 任务卡完成 / 缺陷修复 / 用户反馈应用（打 tag）。顶栏 `a3f8c21 · N 个决策点` 可查看与回退 |
| **回流** | 测试发现的缺陷自动生成缺陷卡（#ISS-xxx），对应任务卡自动排回任务流；修复后自动重跑失败用例 |
| **审批** | plan / auto 两模式（Tab 切换）。auto 下常规生成自动执行，安全敏感操作（网络层/存储/权限/安全校验）始终需批准；审批以对话内审批条呈现 |

## 三屏信息架构

```
① 项目列表（首页）        ② 新建项目（一次性）          ③ 工作台（常驻循环）
┌──────────────┐      ┌──────────────────┐      ┌────────────────────────────┐
│ 项目卡片网格    │      │  居中欢迎页：        │      │ 左：任务/测试/网络/问题 四页签   │
│ · 开发中(呼吸灯)│      │  想法描述(自由文本)   │      │     + 「正在测试·意图」横幅     │
│ · 已完成       │ →    │  领域灵感芯片(可选)   │  →   │ 中：工作区（通栏）             │
│ · SPEC 草稿    │      │  应用形态 · 品牌色    │      │     开发直播/SPEC/Agent计划/文件树│
│ · 进度·git决策点│      │  [开始与 AI 敲定需求] │      │ 右：AI 对话（Claude Code 式常驻）│
└──────────────┘      └──────────────────┘      └────────────────────────────┘
```

### ③ 工作台 —— 过程完全透明

**左栏（一卡四页签 + 测试意图横幅）**
- 顶部横幅：`正在测试 · 意图` —— 验证什么、怎么验证、第几步（意图的唯一权威展示位）
- 任务：结构化任务行（状态图标 + 类型标签 FLUTTER/GO/TEST + 轮次/进度）
- 测试：AI 操作 App 的步骤时间线（语义树定位、每步断言）
- 网络：请求捕获（状态码/耗时/接口契约提取；本地 Go 后端 localhost:8080）
- 问题：缺陷卡（严重度 + 违反的规范条款 + 来源 + 处置状态：已回流/待确认/已修复）

**中间工作区（通栏，四页签）**
- 开发直播：左半手机实时预览（Hot Reload 徽标，可直接操作）+ 右半 AI 正在编辑的代码（文件页签、新增行高亮、闪烁光标、动作日志）
- SPEC 规范：Markdown 渲染的产品规格书（历史版本可对比）
- Agent 计划：**AI 自己写的原始计划文本**，Markdown 原样渲染、进度内嵌原文（"已完成 ✓ / 进行中 62%"），不加工
- 文件树：NEW/MOD/编辑中 状态标注

**右栏 —— AI 对话（完整叙事，Claude Code 式）**

对话流 = 过程日志，一切事件在此展开（左栏只是索引）：

```
你：中途加个需求：商品页顶部加搜索框
└ 执行 · 插入搜索功能                ← turn（左侧生命线，进行中呼吸）
  ▸ 思考  范围变更：升版 SPEC…  3.4s   ← 默认折叠，点击展开完整推理
  ▸ Edit   SPEC.md            +8 −0   ← 可展开行动（diff 详情）
    · Task   创建 2 张任务卡…     ✓     ← 无载荷行动（无三角）
  └ 总结气泡

└ 执行 · 商品列表页（进行中）
  ▸ 思考  按 skill 分层生成…    4.2s
  · Read   generate-product-list.md  ✓
  · Write  product_model.dart       +86
  ▸ Edit   products_screen.dart  编辑中…（默认展开，与中间代码直播同步光标）
  ▸ Bash   flutter analyze       No issues（展开看输出）
  · Hot    热重载推送 → 预览更新 #7  0.8s
  ▸ Git    自动保存决策点        a3f8c21（展开看提交）
```

- **行动条目两类**：有载荷（Edit=diff / Bash=输出 / Git=提交 / 失败Step=证据）带 ▶ 可展开；无载荷（Read/Write/Task/Hot/成功Step）无三角
- **思考块**：默认折叠 + 摘要预览 + 计秒；内容是 AI 的真实推理（判断理由与取舍），穿插在行动之间
- **turn 类型**：计划（含技术栈可点击调整）/ 纯问答（不改代码）/ 执行 / 测试 / 反馈修改（审批条）/ 阶段计划（按此执行|要调整）
- 输入框上方 plan/auto 模式切换；随时可插话（提问、加需求、暂停、撤销）

**顶栏**：项目名 · 语境标签 ｜ 任务/token 统计 ｜ git 决策点（`a3f8c21 · 7 个决策点`，点击看历史与回退）｜ 引擎药丸（flai-engine · 模型）｜ 主题切换

## 架构

```
┌─ 桌面壳（desktop/）Electron + React + Vite ─────────────────┐
│  主进程：引擎子进程管理（按项目绑定工作目录）· HTTP/SSE 代理     │
│         adb 设备轮询 + 自愈（多版本 adb 抢占自动恢复）          │
│         scrcpy 4.1 双通道桥接（video+control，攒批 IPC 推流）   │
│         flutter run --machine daemon（部署/Hook Reload）      │
│  渲染层：三屏 UI（项目列表/新建/工作台）+ Worker 视频解码       │
└──────────────┬─────────────────────────────────────────┘
               │ IPC → HTTP + SSE（/chat /tasks /plan /sessions /approve /interrupt）
┌──────────────┴─────────────────────────────────────────┐
│  执行引擎 engine/ — flai-engine（Go 单二进制）             │
│  基于 goagent（GitHub: Dream355873200/GoAgent）           │
│  + 领域工具：flutter（analyze/test/run/…）                │
│  + 复合测试工具集（L1-L6 分层，见下）                        │
│  + 会话持久化（.yume/sessions JSONL 逐条落盘）              │
│  + Skill 系统（全局 knowledge/skills + 项目 .yume/commands）│
│  + Plan 模式（EnterPlanMode/ExitPlanMode + .yume/plans）   │
│  + 设备状态注入（DEVICE.md 每 10s 刷新进会话上下文）          │
└──────────────┬─────────────────────────────────────────┘
               │ flutter CLI / adb / git
     目标项目（.yume/ 内：sessions/plans/shots/test-reports/net-log）
```

### 复合自动化测试（L1-L6 分层）

| 层 | 工具 | 说明 |
|---|---|---|
| L1 静态 | `flutter analyze` | 语法/类型（自修复循环 ≤5 轮） |
| L2 测试 | `flutter test` | 单元/Widget 测试 |
| L3 语义树 | `ui_tree` / `tap` / `swipe` / `type` / `back` / `wait_for` / `logcat` | 真机行为验证（E2E 主力）；输入串行锁 |
| L4 视觉 | `screenshot`（稳定检测）/ `screen_diff` | 像素对比断言，零模型 |
| L5 多模态 | `vision_ask`（FLAI_VISION=1 才注册） | 视觉裁决，模型不支持则工具不存在 |
| L6 网络 | `net`（reverse / record / mock） | 前后端联调 + 异常分支测试 |

测试调度：迭代中轻量冒烟（每功能一条核心路径）/ 收尾全量（skill `testing`
分层策略 → `test_report` 落盘 Markdown 报告 → 报告页签展示截图证据）。

### Web 原生投屏（自研 scrcpy 4.1 客户端）

`@yume-chan/*` 生态最高支持 server 3.x（Android 16 不可用），本项目自研
4.1 Web 客户端：主进程建 video+control 双 TCP 通道（forward 模式 server
顺序 accept 两次）→ 16ms 攒批 IPC → Worker 零拷贝解析（ptsAndFlags 高位
标志包格式 / Annex-B→AVCC / SPS+PPS 构造 AVCC config）→ WebCodecs 硬解 →
`transferControlToOffscreen` 画布移交 → 触控/滚轮/BACK 注入走 control 通道。

### UI 事件 → 引擎能力映射

| 前端功能点 | 引擎/数据源 |
|---|---|
| 对话流行动条目（Read/Write/Edit/Bash/Git…） | goagent 工具调用事件流（SSE） |
| 思考块 | goagent Extended Thinking 输出 |
| 计划卡片 / Agent 计划页签 | goagent Plan Mode（计划 markdown 文件） |
| plan/auto 模式 + 审批条 | `WithPermissionMode` + PermissionRules（安全敏感 = RequireApproval）+ `/approve` 端点 |
| 任务卡 / 任务页签 | goagent Task/Todo V2（依赖管理）+ `/tasks` 端点 |
| git 决策点 | engine 编排：决策点触发 `git commit`（SPEC 升版/卡完成/缺陷修复/反馈前 tag） |
| 开发直播（预览+代码） | scrcpy 投屏 + 文件写事件（新增行高亮/光标） |
| 测试意图横幅 / 测试时间线 | 探索测试 sub-agent 的步骤事件（语义树定位 + 截图 + 断言） |
| 网络页签 | Dio Interceptor 落盘 → engine 读取 |
| 问题页签 / 回流 | 缺陷卡结构（#ISS）+ 任务流编排 |

## 目录

| 目录 | 内容 |
|---|---|
| `engine/` | Go 执行引擎：goagent daemon + 领域工具 |
| `knowledge/` | Prompt 知识库（goagent skill 格式，核心资产） |
| `docs/mockup/` | **三屏交互原型**（UI 蓝图，浅/深双主题） |
| `desktop/` | Electron + React + Vite 桌面壳（P1 已实现，`npm run dev` 启动） |
| `playground/` | 本地测试用 Flutter 项目（不入产品） |
| `docs/` | 文档；**[GOAGENT_CHANGES.md](docs/GOAGENT_CHANGES.md) 记录对 goagent 库的一切改动**（库被多项目共用） |

## 快速开始

```bash
# ============ 引擎（依赖：Go 1.25+、Flutter SDK、OpenAI 兼容 LLM 端点）===========
cd engine
go build -o flai-engine.exe ./cmd/flai-engine

# 配置（环境变量或命令行参数）
#   FLAI_BASE_URL  默认 http://localhost:11434/v1 (Ollama)
#   FLAI_MODEL     —— 必须支持 tool calling 与 function calling
#   FLAI_API_KEY   需要鉴权的端点填写
FLAI_MODEL=DeepSeek-V4-Flash ./flai-engine.exe --addr 127.0.0.1:8420

# 验证
curl http://127.0.0.1:8420/health

# ============ 桌面壳（依赖：Node 18+）===========
cd desktop
npm install
npm run dev        # vite + electron 热更
# 首选项在应用内「设置」配置（模型/BaseURL/API Key），存于
#   %APPDATA%/amobilecreater-desktop/config.json
```

### 桌面壳当前能力（P1+P2）

- **三屏**：项目列表 / 新建（flutter create + git 初始化）/ 工作台
- **工作台**：右栏 AI 对话（SSE 直播：思考块按真实执行序与工具调用交错、
  行动条目可展开、MD 渲染含表格；随时插话 + ⏹ 终止 + 断点续传）；
  中间开发直播（语法高亮 + 行号）/SPEC/Agent 计划/文件树/**测试报告**
  （多份历史、条目表格、截图证据点击放大）；左栏任务/**网络**（请求流
  实时展示）/**问题**页签 + **测试状态卡**（agent 测试动作实时播报）
- **手机投屏（P2）**：Web 原生 scrcpy 4.1（工作台内嵌画布，Worker 解码
  零主线程开销）；触控/滚轮/右键返回注入；画面稳定检测；解码自愈
- **自动部署（P2）**：🚀 部署运行 / ⚡ Hot Reload / 🔄 Restart
  （flutter run --machine daemon）
- **设备自愈**：多版本 adb 抢占 5037 自动检测恢复（强杀+归位+reconnect，
  60s 限频），免插拔
- **会话持久化与断点续传**：消息逐条落盘（`<项目>/.yume/sessions/`）；
  重开项目自动回放；SSE 流断自动转轮询跟踪恢复直播
- **引擎生命周期**：桌面壳自动拉起/健康检查/重启引擎，工作目录随项目切换

## 路线图

- [x] **P0-a** 引擎骨架：goagent daemon（HTTP/SSE 全端点）+ flutter 工具
- [x] **P0-b** 首个知识库 skill（登录页：安全+UI+质量规范）
- [x] **P0-d** UI 蓝图：三屏交互原型（项目列表/新建项目/工作台，含全部功能点）
- [x] **P0-c** 最小闭环验证：生成 → analyze → 自修复（DeepSeek-V4-Flash，21 轮 / 8 Write / 6 analyze，终态零 issue）
- [x] **P1** Electron 壳：三屏 + SSE 对话直播 + 会话持久化/断点续传 + 任务页签 + 文件树 + 语法高亮
- [x] **P2-1** 设备自动检测（adb 轮询 + 设备选择器 + 多版本自愈）
- [x] **P2-2** Web 原生投屏（自研 scrcpy 4.1 客户端：双通道 + Worker 解码 + 输入注入）
- [x] **P2-3** flutter run 自动部署 + Hot Reload/Restart
- [x] **P3-1** 复合自动化测试（L1-L6 分层 + 测试报告页签 + 网络联调/录制/mock + 设备状态注入）
- [ ] **P1.5** 多项目并行（每项目一个引擎实例）；plan/auto 模式接引擎 PermissionMode；决策点 git 自动提交
- [ ] **P2-4** 模拟器自动拉起兜底（无真机时）
- [ ] **P3-2** 反馈回路 + 云协作（协议已本地优先，引擎层零改动）；scrcpy 4.x Web 客户端抽独立开源库
