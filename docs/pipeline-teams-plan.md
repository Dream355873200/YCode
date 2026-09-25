# Pipeline 与 Teams 架构规划

> 基于 GoAgent 实际能力（`pipeline.go` 静态 DAG / `dynpipeline.go` 动态编排）与 YCode
> 现有三层结构（模式 → 插件 → 工具集）的演进规划。所有场景均以源码能力为准，
> 不含未实现的假设功能。

## 0. 引擎已有能力盘点

| 能力 | 说明 | 出处 |
|---|---|---|
| DAG 节点 | 每节点一个独立 agent（Instruction + 工具子集 + Provider 覆写 + MaxTurns） | `PipelineNode` |
| 消息队列 + 并发 worker | 每节点一个队列，Concurrency 控制并行度，worker 消费任务 | `runMultiWorkers` |
| 数据流 | `Injects` 声明可向哪些下游队列 Push；`CloseQueues` 引用计数关闭 | `MessagePusher` |
| 调度依赖 | `DependsOn` 全部满足才启动；`MessageFunc` 在依赖满足后惰性求值（拿到上游真实产出） | `PipelineNode` |
| 类型化消息 | `MessageType` 零值 + 反射，队列元素可以是结构体（默认 string） | `PipelineNode` |
| Supervisor 审核 | `Review=true` 的节点产出须经 supervisor 审核 tool；approve → commit | `PipelineAgentDef` |
| 事务 | `TransactionFactory`：worker 执行前建事务，reject → Rollback + 重试 | `TransactionFactory` |
| 共享数据 | `SharedData` 注入所有节点 context（`GetPipelineData`） | `PipelineConfig` |
| 事件透出 | `OnEvent`：节点 progress（状态行原地更新）/ thinking / error | `PipelineEvent` |
| 会话隔离 | `SessionID`：节点工具的 WorkDir/SessionID 与会话一致 | `PipelineConfig` |
| 动态编排 | `create_pipeline` 工具：LLM 运行时自建 JSON DAG（≤12 节点、工具按名选、无环校验、失败即终止） | `dynpipeline.go` |

**明确没有的（Teams 的真实缺口）**：节点失败后的重规划（L2）、常驻 agent 成员、
团队级事务、成员间点对点通信（现在只有队列 Push）、类型化消息（动态模式）。

## 1. Pipeline 在 YCode 的应用场景

### P0 · 纯声明即可启用（引擎已支持）

**① 多设备并行测试矩阵（flutter 模式）**

```
[用例生成器] ──Injects──▶ [真机执行器 ×N] ──▶ [报告汇总]
  tools: Read,Glob          Concurrency=设备数      tools: test_report
```

复用 `device` / `test-report` 工具集；每个 worker 绑定一台真机跑一组用例；
汇总节点产出 `.yume/test-reports/` 报告并在右栏展示。这是现有 L1–L6
串行流程的直接并行化。

**② 大规模重构流水线（code 模式）**

```
[分析器(只读)] → [规划器] ──Injects──▶ [并行编辑器(按模块)] → [审核器 Review=true] → [diff 汇总]
                                     TransactionFactory = git 事务
```

审核 reject → Rollback → 编辑器重试；手动审批模式下审核卡直接接
`Agent_visual-judge` 或人工确认。

**③ 文档/演示文稿生产线（office 插件组合）**

`[资料收集] → [大纲] ──▶ [并行分节撰写] → [视觉验收 Review] → [打包]`
与 docx/pptx/xlsx 技能和 `Agent_visual-judge` 组合，一篇报告的各章节并行生成。

**④ 动态编排（create_pipeline 已内置）**

主 agent 遇到超大任务时运行时自建 DAG：工具从当前会话工具箱按名选
（含 MCP 工具），护栏（≤12 节点、无环、失败即终止）防失控。适合
"把这三个模块的测试都补齐" 这类模型需要现场拆解的任务。

### 数据载体约定：Markdown 优先（LLM-to-LLM）

节点间消息的下游是另一个 LLM——**LLM 的母语是 Markdown 而非 JSON**。调研/
分析类产出是层级化散文（标题/要点/数据混排），MD 保留语义；硬转 JSON 会
造出脆弱 schema 或把散文塞进巨型字符串字段（转义地狱）。

约定：

- **队列默认载体 = Markdown 片段**（引擎队列默认元素就是 string，无需改动）；
  节点 Instruction 里显式声明产出格式（"输出 MD 报告，包含 XX/YY 小节"）
- **结构化字段用 MD 内嵌 JSON 代码块**（```json 围栏）：消费方 LLM 读得懂
  上下文，代码层（UI 渲染/落库）也能按围栏提取——混合形态而非二选一
- **JSON 独占只在机器-机器边界**：如测试矩阵需要 UI 表格渲染、指标需要
  聚合计算时，该段用 JSON 并由代码转换
- 判据一句话：**下游是 LLM 就用 MD，下游是代码就用 JSON，两边都要就用
  MD + 内嵌围栏**

### 1.5 场景走查与 Pipeline/Team 判据

**判据：队列里流动的是数据还是意图。**

- **Pipeline**：输入可枚举的数据项 + 每项的处理流程可预先描述。队列承载
  **数据**（页面/文件/用例/分块），节点是数据变换器，fan-out/fan-in 就是
  map/reduce。判据三问：数据项能序列化吗？worker 能否独立消费不看其他
  消息？输出能否回灌下游？三个 yes = pipeline。
- **Team**：目标导向、过程需要探索与决策、任务边界在执行中才浮现。队列
  承载**意图**（"去把这个搞定"），成员共享上下文、协商、互相补位。
  例：「去 B 站找极客湾最新视频并播放」——搜索/发现/点击都需要判断，是
  agentic 任务，硬套 pipeline 只会得到"有顺序的 agent 队列"。

**混合形态**：team 的 lead 对执行中新拆出的同构子任务建 pipeline（map 内嵌）
——lead 负责发现与决策，pipeline 负责批量变换；反之 pipeline 节点里跑
mini-team 是滥用。

**场景走查（fan-out/fan-in 全并行）**：任务「整理极客湾最近 5 期视频的卖点，
产出对比 docx」——「5 个 URL → 5 份卖点 JSON → 对比矩阵 → docx」是标准
pipeline（map + reduce）：

```json
{ "nodes": [
  { "name": "fetcher", "instruction": "读取分配到的视频页，提取标题/发布时间/播放数/核心卖点，输出结构化 JSON",
    "tools": ["mcp__browser__browser_navigate", "mcp__browser__browser_snapshot"],
    "concurrency": 5, "injects": ["merger"], "close_queues": ["merger"],
    "message": "待采集清单（5 期视频）已入队" },
  { "name": "merger", "depends_on": ["fetcher"], "instruction": "5 份结构化产出全部收到后，整理成对比矩阵",
    "tools": ["Read", "Write"], "injects": ["writer"] },
  { "name": "writer", "depends_on": ["merger"], "instruction": "按注入的 docx 技能规程把对比矩阵写成报告",
    "tools": ["Read", "Write", "Bash"], "skills": ["docx"], "injects": ["reviewer"] },
  { "name": "reviewer", "depends_on": ["writer"], "review": true,
    "instruction": "对照用户要求逐项核对，不合格打回并说明缺什么" }
]}
```

设计要点：

- **抓取与分析在同一个 worker 里完成**（每视频一个任务、五路并行）——
  不要把采集和分析拆成两个串行节点让分析器串行干 5 份活
- **merger 是 fan-in 汇聚点**：DependsOn 全满足 + 队列引用计数关闭后启动
- **reviewer 打回**：补采任务重新进 fetcher 队列（未关闭即天然支持）
- writer 节点的 docx 技能由宿主注入（见缺口 ⑦）

而「发现哪个是最新视频并播放」中需要探索判断的部分（搜索、识别）属于
agentic 任务——归主 agent 或 team，数据变换部分才进 pipeline。

### P1 · 需要壳/引擎补线（工作量小，体验收益大）

**⑤ 右栏「流水线」面板 + 运行中 DAG 状态图**：

核心缺失 piece：**结构化的 DAG 状态快照输出**——前端不该从事件流里拼图，
引擎直接吐幂等的全量快照，前端整体替换渲染。

```
GoAgent（PipelineConfig 增加回调）
  OnState func(PipelineDAGSnapshot)
  // PipelineDAGSnapshot = {
  //   run_id, updated_at,
  //   nodes: [{ name, status: pending|running|done|failed|review|drained,
  //             workers_active, queued, done_count, error? }],
  //   edges: [{ from, to, kind: "data"(Injects) | "dep"(DependsOn) }],
  // }
  // pipeline 内部本就持有这些状态（pipelineNodeState：队列深度/worker 数/完成数），
  // 每次状态迁移（节点启动/完成/队列 push/close/进审核）后合成全量快照回调一次。

引擎（flai-engine）
  OnState → SSE 帧 type: "pipeline_state"（全量替换，幂等；前端无需 diff）
  + GET /pipelines/<run_id>/state → 同一快照（刷新/重进项目页时拉全量）

前端（右栏 DagPanel）
  - 布局：按 DependsOn 拓扑分层（最长路径分层），层内水平排布；
    edge 画 SVG 折线（数据流实线、依赖虚线）
  - 节点框：状态色（pending 灰 / running 品牌色呼吸 / done 绿 /
    failed 红 / review 黄）+ 队列深度徽标（queued N）
  - 交互：点节点 → 侧栏展示该节点思考流 / 产出 / 审核卡（复用 PermissionCard）
  - 渲染即替换 state（React 状态 = 最新快照），无 diff 逻辑
```

配套事件：`OnEvent` 的 progress/thinking 继续走细粒度流（选中节点的直播），
`OnState` 只负责拓扑与状态——两者职责分离，前端渲染不会被事件流冲垮。

**⑥ 审核接入审批 UI**：Review 节点的 supervisor 审核卡复用
`PermissionCard`/`QuestionPanel`（approve/reject/打回原因），与手动审批模式
共用 `POST /approve` 通道。

**⑦ 声明式 Pipeline 模板**：`plugin.json` 增加 `pipelines` 字段（静态 DAG
定义，纯数据），模式/用户直接引用——机制进引擎，内容进清单的既有原则。
会话级工具过滤沿用工具集机制：pipeline 节点只能引用本插件可见工具。

**⑧ 运行落盘与恢复**：pipeline 状态写入 `.yume/pipelines/<id>.json`
（即 DAG 快照的历史序列），应用重启后可回放/观察（恢复执行依赖引擎 L2）。

### P2 · Teams 架构（基于 pipeline 原语演进）

Teams 与 pipeline 的本质差异：pipeline 是**一次性数据流编排**（DAG 跑完即弃），
teams 是**常驻协作组织**（成员有身份、有记忆、跨任务存活、动态接活）。

```
┌─ Team（.yume/teams/<name>/）
│   ├─ team.json ── 目标/成员表/通信拓扑
│   ├─ members/<role>.md ── 角色卡（复用插件 agents 格式：身份+工具集+记忆指针）
│   ├─ memory/ ── 团队共享记忆（决议/进度/交接）
│   └─ inbox/<member>/ ── 成员任务队列（pipeline 队列的常驻化）
└─ Lead（队长 = 常驻 supervisor）：拆解 → 指派 → 验收 → 仲裁争议
```

**成员 = 带角色的常驻 agent**：角色卡（身份/职责/可用工具集/输出规范）+
独立会话历史 + 记忆目录。引擎侧 = pipeline 节点的常驻化（跨 run 存活）。

**通信**：v1 沿用 `Injects` 队列（lead 指派 + 成员交付）；v2 点对点
（@提及路由）依赖 GoAgent 团队层。

**人类在环**：人类是群里的一员——@提醒、审批卡、进度面板；紧急事务走
`ask_user` 原语。

**试点场景**：flutter 模式「测试团队」——队长（拆需求）+ 测试员 A（真机
功能测试）+ 测试员 B（视觉验收，复用 vision）+ 报告员（汇总报告）。这是
现有 L1–L6 流程的组织化升级，成员角色卡可直接从现有 skills 改写。

### 节点信任等级（trust tier）—— 节点权限的设计决策

轻量节点目前把所有工具硬编码 `LevelReadOnly`（跳过权限门）：对只读节点正确，
但并行编辑器、测试执行器、docx 写手这类**必须写**的节点被堵死。解法不是逐工具
配权限，而是**节点级信任等级**（声明式，进 `PipelineAgentDef` / `DynNodeSpec`）：

| trust | 语义 | 权限行为 | 适用节点 |
|---|---|---|---|
| `readonly`（默认） | 只读调研 | 工具标记 ReadOnly，跳过权限门（现状） | 分析器/采集器/审查员 |
| `workspace` | 工作目录内可写 | Write/Edit/Bash 被宿主包装 cwd 约束（越界路径拒绝）；无审批卡 | 并行编辑器、测试执行器、writer |
| `full` | 完整权限 | 节点 loop 接**会话 Permission Gate**：写操作按当前模式走审批（手动审批 = 弹卡，卡上标注来源节点） | 需要越出工作目录或操作系统的节点 |

配套原则：

- **默认保守**：未声明 trust 的节点一律 readonly；`full` 只能由模式/用户在
  pipeline 模板里显式开启（dyn 模式里 LLM 声明的 `full` 需运行模式允许，
  plan 模式直接拒绝建图）
- **正交机制**：并行写安全由 Review/Transaction 兜底（编辑器节点 workspace 级 +
  reviewer 打回回滚），审批语义由会话 Gate 兜底（full 级节点接现有审批卡）——
  两个机制各管各的，不互相替代
- **实现落点**：`buildLightweightLoop` 按节点 trust 映射工具 Permission 与
  Gate 接线（`PipelineConfig.SessionID` 已有，approver 已存在——是接线活）

### 为什么成员是轻量 loop 而非全量（设计理由）

全量 loop（App.run）带会话持久化、steering、后台任务、全局权限门、全工具可见
——成员接进来会有四个结构性问题：

1. **递归无防护**：全量工具可见 = 成员能调 run_team/create_pipeline，无限
   递归团队。轻量 loop 的显式工具白名单结构性杜绝。
2. **会话写入冲突**：成员是短命 worker（单任务、随分派生灭），接进会话级
   状态机（readstate/持久化/后台任务注册）会产生僵尸状态。
3. **插话语义混乱**：steering 是「用户 → 主 agent」通道；成员接进来后
   用户插话该给谁，信息流不再是清晰的单向。
4. **成本**：一轮团队可能跑几十次分派，每次付全量装配成本不合理。

所以成员的演进路径是**往轻量 loop 挂模块**（压缩已挂、skills/Gate 按缺口
⑥⑦ 挂载），不是换成 App.run——挂完后成员是「准全量」：有压缩、有技能、
有权限分级，但无 steering/递归工具/会话写入，安全边界不破。

**真正需要全量能力的成员**（长期自主执行的复杂子任务）应使用**子代理**
（插件 agents/*.md → Agent_<name>，独立历史独立工具集，如 Agent_explore）
——它的语义是「主 agent 委派的独立执行者」，与 team 成员「leader 管理的
协作者」分工不同。L2 的常驻成员会话 = 成员从每次分派新建升级为跨任务
存活，实现上依然是有界模块组合。

**引擎缺口清单（按依赖顺序）**：① 常驻成员会话（跨 run 历史/记忆）；②
动态重规划（节点失败由 lead 重拆，替代「失败即终止」）；③ 成员间点对点
消息；④ 类型化消息进动态模式；⑤ 团队级事务（跨成员的原子交付）；⑥
**节点信任等级**（见上节，`trust` 字段 + lightweight loop 接会话 Gate）；⑦
**节点技能注入**：轻量节点只有宿主传入的工具与指令——看不到技能注册表、
插件规范，也没有多层压缩（节点任务短而有界，压缩通常不需要）。`PipelineAgentDef`
/`DynNodeSpec` 增加 `skills` 字段，宿主按会话技能注册表解析内容内联进节点
Instruction（如 writer 节点注入 docx 技能规程），并授予对应脚本工具。

## 2. 分阶段路线图

| 阶段 | 内容 | 依赖 |
|---|---|---|
| 一 | 声明式 pipeline 模板（plugin.json `pipelines` 字段）+ 测试矩阵试点 | 无（引擎已支持） |
| 二 | 右栏流水线面板（OnEvent→SSE）+ 审核接审批 UI + `.yume/pipelines` 落盘 | 阶段一 |
| 三 | `create_pipeline` 动态编排对主 agent 开放（护栏保留），结合 office/CUA 场景 | 无 |
| 四 | Teams 试点：角色卡格式 + 常驻成员 + lead 指派（GoAgent 常驻化） | 引擎 L2 |
| 五 | Teams 完全体：点对点通信、团队事务、重规划（GoAgent L3） | 引擎 L3 |

## 3. 设计原则（延续现有架构）

- **机制进引擎，内容进清单**：pipeline/teams 的编排定义是纯数据，YCode 侧
  只做面板与审批接线
- **成本护栏优先**：DAG ≤12 节点、每节点 MaxTurns、并行数上限——多 agent
  的成本是单 agent 的数倍，护栏不是可选项
- **三层渐进**：静态子代理（agents/*.md，已有）→ 动态 pipeline（任务编排）
  → teams（常驻组织），按任务复杂度选择，不越级
