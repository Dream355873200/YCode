# goagent 库变更记录

> goagent（github.com/Dream355873200/GoAgent）被另一个项目共用。
> **任何对本库的修改都必须记录在此文档**，并注明版本、动机与兼容性影响。
>
> 引擎引用方式：Go module（GitHub），当前锁定 commit `ddad5c2`（v0.0.0-20260826134450）
> 本地开发参考副本：`E:\claude-code-rev-study-main\claude-code-rev-study-main\goagent`

## 变更条目格式

```
## [YYYY-MM-DD] 简短标题
- 改动文件: xxx.go
- 动机: 为什么改（关联本项目哪个需求）
- 兼容性: 是否影响既有 API / 另一个项目的用法
- 状态: 已推送 GitHub / 本地未推送
```

---

## [2026-08-26] 初始化 — 未做任何库改动

- 本项目以 Go module 方式从 GitHub 引入 goagent，**零修改直接使用**
- engine 侧新增的 Flutter 领域工具（`flutter` ToolDef）全部写在本项目
  `engine/internal/tools/` 下，通过公开 API `app.Tool()` 注册，不侵入库
- 结论：当前无需 fork 或本地 replace，保持库的独立性

---

## [2026-08-26] 发现库的隐性使用陷阱（未改库，建议上游修复）

**现象**：调用 `goagent.WithBuiltinTools()` 后，App 实际一个内置工具都没注册
（`/tools` 只剩自注册的 flutter），且无任何告警。

**根因**：内置工具通过依赖注入模式注册 —— `builtin` 包的 `init()` 调用
`RegisterBuiltinToolsProvider`；`WithBuiltinTools()` 只是置位标志，运行时取
`builtinToolsProvider`（nil 则静默跳过）。**若使用方未 import `builtin` 包，
该 provider 永远为 nil**，`WithBuiltinTools()` 变成静默 no-op。

**本项目修复**（engine/cmd/flai-engine/main.go）：加空导入

```go
_ "github.com/Dream355873200/GoAgent/builtin" // 注册内置工具 provider
```

**给上游的建议**（待反馈给库作者，暂未改动库代码）：
1. `WithBuiltinTools()` 在 provider 为 nil 时应 log.Printf 警告，或
2. 在 README/options.go 文档中明确「必须空导入 builtin 包」——
   库自带 examples/web-api 已用此写法，但公开文档未提及。

**兼容性**：不影响另一项目（若它已在用且工具正常，说明它已 import builtin）。
**状态**：本项目侧已修复；上游建议待提交 issue。

---

## [2026-08-26] 修复 L2 micro 压缩层每轮无条件剥离工具结果（导致模型失忆打转）

- 改动文件: `compaction/compaction.go`
- 动机: P0-c 最小闭环验证发现模型 59 轮里重复 Read/Glob 同一批文件 128+ 次、
  始终走不到 Write —— 根因是 micro 层 Pass 2（剥离已消费工具结果）**每轮无条件
  执行**：模型刚读完文件、刚说下一步计划，上一轮读到的内容就被替换成
  `[内容已处理，移除 N 字符]`，于是每轮失忆、从头再来。Claude Code 只在接近
  上下文上限时才做这种剥离。
- 改动内容:
  1. `Config` 新增 `MicroStripThreshold float64`（默认 0.5，负数=禁用剥离）
  2. `microCompressor.apply` Pass 2 加门槛：估算 token ≥
     `contextWindow × MicroStripThreshold` 才剥离；未达阈值直接返回
  3. Pass 1（截断 >50K 字符的超长结果）不受影响，仍每轮执行
- 兼容性: **API 向后兼容** —— 新字段零值时 NewManager 填默认 0.5，已有调用
  无需改动；行为变化：小上下文场景不再每轮剥离（这正是修复目的）。
- 状态: 已推送 GitHub（commit `0e39b2d`，engine go.mod 已锁定该版本）

---

## [2026-08-26] L1 snip / L3 collapse 同样门槛化（修复同源失忆问题的另两层）

- 改动文件: `compaction/compaction.go`
- 动机: micro 层门槛化后复测，仍每轮出现 ~90 token 的压缩事件且模型仍在重复
  读取 —— 检查发现另两层同样**无条件**破坏历史：
  - **L1 snip**：每轮把倒数第 4 条消息之前所有 >200 字符的文本块截到头尾
    各 100 字符（模型的推理文本、计划陈述全被切碎）
  - **L3 collapse**：每轮把倒数第 6 条消息之前的**全部消息对**折叠成
    80 字符摘要（等于直接扔掉几乎全部历史）
- 改动内容: 两层 apply 均加同一门槛 —— 估算 token ≥ `contextWindow × 0.5`
  才生效；collapse 的 `drain()`（413 溢出恢复路径）以 contextWindow=0 调用，
  保留强制折叠语义不受影响
- 兼容性: 行为变化仅限低压力场景（不再提前截断/折叠），高压力时各层行为
  与之前一致；无 API 变化
- 状态: 已推送 GitHub（commit `3318a05`，engine go.mod 已锁定该版本）

---

## [2026-08-26] SSE `tool_start` 事件补上 `tool_input` 字段

- 改动文件: `http.go`
- 动机: 桌面壳对话流需要在工具开始执行时立即显示调用对象（Read 的文件路径、
  Bash 的命令、Glob 的模式）。loop 层的 `EventToolStart` 一直携带完整
  `ToolInput`，但 http.go 的 `sseEvent` 结构体漏了该字段，序列化时被丢弃 ——
  前端只能等 `tool_done` 才能从结果倒推对象。
- 改动内容: `sseEvent` 增加 `ToolInput json.RawMessage` 字段并在 `/chat`
  序列化时填充。
- 兼容性: 纯增量字段（`omitempty`），既有消费方不受影响。
- 状态: 已推送 GitHub（commit `ddad5c2`，engine go.mod 已锁定该版本）

---

## [2026-08-26] 会话消息逐条即时落盘 + interrupted 状态（断点续传基础）

- 改动文件: `goagent.go`、`internal/loop/loop.go`、`http.go`
- 动机: Claude Code 式进程级恢复 —— 应用关闭（引擎进程被杀）后重开，
  需要完整对话记录（含每个工具调用步骤）+ 「上次执行到哪」+ 从断点继续。
  原先消息只在整轮结束才落盘，中途被杀 = 本轮历史全丢。
- 改动内容:
  1. `goagent.run` 事件循环中每次出现新最终消息立即 `AppendMessage`
     （persistMsgs 增量落盘，循环结束含 error 退出时兜底补齐）
  2. `loop` 每轮迭代末尾同步 `finalMessages = state.messages`，
     支持运行中调用 `FinalMessages()`（原仅 defer 时赋值）
  3. `GET /sessions` 把磁盘遗留 `running` 修正为 `interrupted`：
     当前进程内存无活跃会话，running 必为上个进程被杀时残留
- 兼容性: 持久化时机提前，写放大可接受（JSONL append）；API 无变化。
- 状态: 本地 commit `2ecfac7`，待推送 GitHub（连同此前 5 个）

---

## [2026-08-26] HTTP 新增会话端点（重开项目可回放对话历史）

- 改动文件: `http.go`
- 动机: 桌面壳「重新打开项目看不到历史对话」——历史已落盘在
  `.yume/sessions/*.jsonl`（bcdaad7 引入），但 HTTP 层没有任何读取入口，
  前端无从恢复。
- 改动内容: 新增 `GET /sessions`（会话摘要列表：id/state/turn_count/
  created_at/updated_at/first_message）与 `GET /sessions/{id}/messages`
  （完整消息历史，message.Message 数组）。均带 SessionManager nil 守卫。
- 兼容性: 纯增量端点，未启用会话系统时返回 503。
- 状态: 本地 commit `0674dd9`，待推送 GitHub（连同 `8acac39`、`3f77904`、`bcdaad7`、`7c5135e`）

---

## [2026-08-26] task ListSummaries 按 ID 排序（任务条目轮询时乱跳）

- 改动文件: `task/task.go`
- 动机: 桌面壳每 5s 轮询 `GET /tasks` 渲染任务卡；`ListSummaries` 遍历
  内部 `map[string]*Task`，Go map 遍历顺序随机 → 每次轮询任务条目
  顺序都变，UI 上来回跳动。
- 改动内容: 结果按 ID 升序（自增 ID 即创建顺序）排序后返回。
- 兼容性: 无 API 变化，仅增加确定性排序。
- 状态: 本地 commit `7c5135e`，待推送 GitHub（连同 `8acac39`、`3f77904`、`bcdaad7`）

---

## [2026-08-26] HTTP /chat 支持 session_id 多轮对话（此前每条消息都是全新会话）

- 改动文件: `http.go`
- 动机: 桌面壳实测「对话没有记忆」——每发一条消息，模型都从零重新探索
  项目（Glob/Read 一遍 → 停），用户追问「你怎么不开始」时它完全不知道
  上一轮说过什么。根因：`/chat` 调的是无状态的 `App.Run`（每次调用
  创建全新会话），前端传的 `session_id` 只被用于审批路由，历史从未加载。
- 改动内容:
  1. `runHTTP` 未配置 SessionManager 时自动创建 `.yume/sessions` FileStore
     （对齐 RunCLI 的既有行为；HTTP 模式此前从不初始化）
  2. `/chat` 带 `session_id` 时改调 `RunSession`（自动加载历史 + 结束后
     持久化新消息），未传 session_id 时保持无状态 `App.Run` 旧行为
- 兼容性: 纯增量 —— 既有调用方不传 session_id 则行为完全不变；传了则从
  「无记忆」变为「有持久记忆」（这正是修复目的）。同一 session_id 并发
  请求会被 Acquire 拒绝并返回错误事件（库既有语义）。
- 状态: 本地 commit `bcdaad7`，待推送 GitHub（连同 `8acac39`、`3f77904`）

---

## [2026-08-26] openai provider 解析 delta.reasoning_content + loop 思考空回复恢复护栏

- 改动文件: `provider/openai/openai.go`、`internal/loop/loop.go`
- 动机: 桌面壳实测 DeepSeek-V4-Flash「探索完直接停止、零输出」——该模型把
  大部分回复（规划、与用户确认 SPEC 的内容）经 `delta.reasoning_content`
  下发，而 `streamDelta` 结构体没有该字段，JSON 反序列化时**静默丢弃**。
  content 常为空 → 助手消息为空 → loop 判定「无工具调用」正常收尾 →
  用户侧看到回合静默结束、模型自认为已回答。
- 改动内容:
  1. `streamDelta` 增加 `ReasoningContent *string` 字段；`consumeStream`
     将其转发为 `EventThinkingDelta`（loop 层已有完整的 thinking 事件
     流转：SSE `thinking` 事件 + 历史以 `<thinking>` 标签回填）
  2. loop 新增恢复护栏：`assistantText == "" && thinkingText != ""` 且无
     工具调用时，注入 meta 提示要求模型在正文通道重述（最多 2 次），
     对齐既有 maxOutputRecovery 模式；新增 `TransThinkingOnlyRecovery`
     转移与 `thinkingOnlyRecoveryCount` 状态
- 兼容性: 非推理模型不产生 reasoning_content，行为不变；推理模型从
  「思考被丢弃」变为「思考可见且入历史」，属修复目标本身。
- 状态: 本地 commit `3f77904`，待推送 GitHub（连同 `8acac39` 一起）

---

## [2026-08-26] 修复 GET /plan 空指针 panic（桌面壳对话流「卡死」元凶）

- 改动文件: `http.go`
- 动机: 桌面壳每 5s 轮询 `GET /plan` 刷新 Agent 计划页签；引擎未启用 Plan 系统
  时 `app.PlanStore()` 返回 nil，而该 handler 直接调 `store.IsActive()` →
  每次轮询都 panic。http 包虽会捕获 per-request panic，但连接被破坏，
  与 `/chat` SSE 流竞争连接池时表现为对话流中途卡死（前端空白卡片停滞）。
  其余 Task/BgTask 端点均有 nil 守卫，唯独此端点遗漏。
- 改动内容: nil 时返回 `{"active":false,"state":"disabled",...}`。
- 兼容性: 行为变化仅限原本会 panic 的场景；正常启用 Plan 的用法不变。
- 状态: 本地 commit `8acac39`，待推送 GitHub（连同 `3f77904`）

---

## [2026-08-26] OpenAI provider 支持 tool_result 内联图片（多模态视觉通道）

- 改动文件: `provider/openai/openai.go`
- 动机: amobileCreater 复合测试方案的 L5 视觉裁决层——截图需进入模型上下文。
  goagent 的 message.ContentBlock 本就有 image 类型（anthropic provider 已处理），
  但 OpenAI 兼容流的 toOpenAIMessages 只取 tool_result 的 Text，图片被丢弃。
- 改动内容:
  - 新增约定协议 `splitImagePrefix`：工具结果以 `[IMAGE <media> <base64>]\n` 开头时，
    转成 OpenAI 多模态 content 数组（text part + image_url data URI part）
  - 新增 `chatContentPart` / `chatImageURL` 类型（content-parts 格式）
  - 应用层（engine/internal/tools/vision.go）在 vision_ask 工具结果中按此协议内联截图
- 兼容性: 不带该前缀的 tool_result 行为完全不变；非视觉模型不会收到 image_url
  （vision 工具由引擎侧 FLAI_VISION=1 开关控制注册，模型不支持时工具不存在）。
- 状态: 本地 commit 待做，待推送 GitHub
