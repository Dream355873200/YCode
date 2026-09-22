# Mode 平台化设计（草案 v1）

> 2026-09-22 规划。目标：amc 从 Flutter 开发专用转型为可扩展的 agent 平台——
> 高度可自定义，默认形态是 code 开发（ZCode 形态），Flutter 变成其中一个模式包。
> 未来在平台层叠加 agent 协作（pipeline / 多 agent）。

## 1. 两条设计原则

**判据**：一个东西该不该进 mode，只问一句——「换成另一个领域（网页开发 / 数据分析），它变不变？」变 → mode；不变 → 内核。

**依赖方向**：mode 依赖内核的注册 API，内核绝不反向 import 任何 mode；mode 之间互不感知。验收标准：内核代码里搜不到 "Flutter"。

**机制进内核，内容进 mode**。内核不知道任何产物/流程叫什么名字，只提供机制与槽位。

## 2. 槽位清单（第一期 7 个）

| 槽位 | 内容 | 形态 |
|---|---|---|
| prompt-overlay | 系统 prompt 的覆盖/追加 | md 文件 |
| skills | 技能/知识文件 | md 目录（现有 knowledge/skills 平移） |
| toolsets | 引擎工具集：base 之上的增量/禁用 | mode.json 声明（base = Read/Edit/Bash/Glob/Grep/Task/bgexec） |
| project-fields | 新建项目表单字段 | JSON schema |
| stage | 舞台面 | phone / browser / none / 自定义组件 |
| left-panel | 侧栏面板注册 | React 组件 + 槽位名 |
| artifact-types | 领域产物类型（schema + 渲染模板 + 重注入规则） | 声明 + 模板 |

第二期再加：tool-renderers（工具卡渲染扩展）、composer-actions（快捷操作）。

**模式包目录约定**：

```
modes/
  code/               ← 默认模式（ZCode 形态：无手机、无设备）
    mode.json
    prompts/system.md
    skills/
  flutter/
    mode.json
    prompts/*.md
    skills/
    panels/…tsx        ← 由左栏/stage 槽位注册
```

```jsonc
// mode.json 示意
{
  "id": "flutter",
  "name": "Flutter 开发",
  "engine": { "baseToolsets": ["core", "bgtask"], "add": ["flutter", "device", "vision"] },
  "systemPrompt": "prompts/system.md",
  "skills": "skills/",
  "projectFields": [...],
  "stage": "phone",
  "panels": [{ "slot": "left.bottom", "component": "testTimeline" }],
  "artifactTypes": ["acceptance-report"]
}
```

## 3. 领域产物（artifact）机制

内核认识「产物」，不认识任何具体产物：

- **内核提供**：产物注册（类型 id + schema + 图标 + 模板）、统一存储（引擎落盘）、左栏产物面板与查看器、压缩后「最新产物重注入」（复用 goagent post-compact reminder 通道）
- **mode 提供**：产物类型实例。测试报告是 flutter mode 注册的第一个实例——生成工具（test_report）、触发技能（testing.md）、schema、重注入规则（最新报告 + SPEC.md）都归 mode；展示壳与重注机制归内核

以后「构建报告」「评审纪要」= code mode 再注册一种 artifact 类型，内核零改动。

## 4. Pipeline 的定位与用途

**一句话定位：对话是自由路径，pipeline 是固定路径。** 需要模型判断力、路径不可预知的工作走单 agent 对话；需要**稳定重复、有质量门、可并行**的流程用 pipeline 编排。

**用途一：验收流水线（质量门）**——flutter mode 首选场景。
现在是模型自己决定跑不跑测试（会偷懒、会漏）；pipeline 把「实现 → 编译 → 测试 → 视觉对比 → 报告」变成必经节点，质量门不过不收工。对应 goagent 已有的 DAG + review/supervisor 节点。

**用途二：并行协作加速开发**。主 agent 拆解任务 → 子 agent 并行实现（各自独立上下文，互不污染）→ 集成节点汇总 → 联调验证。fan-out/fan-in 结构正是 DAG 的形状；UI 走已有的 subagent_progress 帧。

**用途三：批量场景**。同构任务批量执行（AnimeCreater 多分镜并行生成、多页面脚手架）——一个 recipe 并行跑 N 个实例。

**归属**：pipeline 运行时 = goagent 内核能力（已建）；**recipe（编排方案）= mode 内容**——mode.json 声明本模式启用哪些流水线，recipe 用声明式描述（每个节点：角色 prompt、允许的工具集、依赖关系、通过条件）。flutter mode 的「验收流水线」、code mode 的「评审流水线」各是自己的 recipe。

**代价与边界**：每个节点独立上下文，token 成倍消耗——pipeline 适合验收/批量/评审这类结构化任务，不替代主对话。另外 pipeline 节点的 prompt/工具集同样属于 mode 内容（recipe 里写），这正是「先做 mode 骨架、再接 pipeline」的理由。

## 5. 多 Agent 协作（Team）——独立于 mode 的平台能力

**与 pipeline 的关系（关键区分）**：pipeline 是 DAG——拓扑预先定义、边固定，节点间只传产物；team 是**以主 agent 为中心的动态网状结构**——启动谁、开几个、通信边都是运行中决定的。team 不是 pipeline 的替代，两者是「多执行体」的两种拓扑：

- **Team（动态网）**：主 agent 启动成员、派活、验收；成员与主 agent 通信，成员之间也可点对点通信。拓扑涌现，适合「多模块并行开发」这类路径不可预知的工作
- **Pipeline（预定义 DAG）**：适合稳定重复、有质量门的流程（验收链、批处理）。可以作为 team 的一种特例：pipeline run 的每个节点也是一个成员

### 通信结构：星型为主、网状按需

- **主 agent 特权**（结构性的，不是头衔）：只有它能 spawn / kill 成员；成员宣告完成只是「待验收」，主 agent 验收通过才关任务板——不合格带反馈重派
- **成员 ↔ 主 agent**：默认通道（汇报、请求决策）
- **成员 ↔ 成员**：允许点对点消息，显式寻址（`send(to: …)`），全部消息落团队日志——网状但每条可观测、可审计
- **协调靠任务板而非闲聊**：共享任务板带认领语义（待认领/进行中/待验收），避免开放讨论式的 token 爆炸与跑偏

**引擎侧四个原语**（对照现状）：

| 原语 | 现状 | 要补的 |
|---|---|---|
| 具名长命成员 | bgtask 已支持后台 agent（跑完即还） | 可命名、常驻待命、多任务生命周期、token 预算 |
| agent 间消息 | steering hub 的 guide 车道 =「往某会话注入一条消息」 | 泛化为 agent 寻址消息（发送者从宿主换成 agent） |
| 任务板认领 | TaskCreate/Update/List 已有 | owner 字段 + 待认领/进行中/待验收状态机 |
| 冲突控制 | device lock（设备单例） | 文件域锁：派活时圈定成员可动的路径 |

**成本闸门**（进内核，防止浪漫化）：并发度上限（同时 3-4 个 active 成员，排队等空位）；每个成员的 token 预算，超限强制收口交回主 agent。

**跨 mode 组队**：成员可以来自不同 mode——主 agent（如 code 模式）拉起 flutter mode 成员做设备验证、design 相关技能的成员做视觉评审。mode 决定「一个 agent 会什么」，team 决定「一群 agent 怎么协作」——两层正交，这是 team 独立于 mode 的原因。

**UI（协作区）**：左栏 tab = agent 卡片列表（名字/状态灯/当前动作/预算消耗）+ 共享任务板（认领状态）+ 点开看成员子流（复用 v2 rows 投影）。团队消息流全量可观测。

## 6. 第三方插件

分两档：
1. **纯资产包**（先行）：md + json——prompt/skills/工具集配置/recipe，无需编译代码，覆盖大部分扩展需求
2. **组件级插件**（后期）：面板/舞台/工具卡组件——需要运行时加载或插件宿主，成本高，等第一方模式稳定后再定形态

### 5.1 做 mode 一定要写代码吗？——创作阶梯

诚实回答：**槽位里放「新内容」不需要代码，发明「新种类的界面」才需要**。按需要写代码的程度分三阶：

| 阶 | 能做出什么 | 需要写代码？ |
|---|---|---|
| 纯资产 | 换 prompt/技能、开关工具集、改新项目表单、注册产物类型（用 markdown 模板）、定 pipeline recipe | 不用——全是 md/json，**agent 可以全程代写** |
| 组合已有组件 | 侧栏放已有面板类型、舞台选 phone/browser/none、产物用通用查看器 | 不用，改 mode.json 即可 |
| 全新 UI | 一个从没见过的侧栏面板/舞台形态 | 要写 React 组件——但写的人可以是 agent |

「侧边栏显示新内容」实际是两件事：**换掉槽位里显示什么**（数据驱动，配置就能换）vs **发明一种新面板**（这才是需要代码的部分）。槽位契约足够窄（面板拿到的是会话状态 hook + 产物数据 + 固定容器尺寸），新 UI 的自由度被约束在「往这些槽位里放什么组件」。

### 新建项目向导 = 第一个被看见的 mode 差异

现在的新建项目弹窗是 Flutter 专有初始化（项目名/包名/模板 → flutter create），这本身就是 mode 内容，拆两层：

- **内核**：项目通用生命周期（列表、打开、工作目录绑定、会话归属）+ 初始化器机制（mode 声明用哪个初始化器、字段 schema 驱动向导表单、引擎执行注册过的初始化动作）
- **mode**：
  - flutter 注册 `flutter-create` 初始化器（字段：项目名 / org / 模板；动作：flutter create + 设备环境检查）
  - code 默认就是「打开工作目录」：选目录 + 可选 git init，没有模板选择——甚至新建项目的入口形态都可以不同

向导 UI 骨架（步骤条/表单渲染/校验）是内核的；字段清单、每个字段的类型与校验规则、点「创建」后引擎执行什么，全由 mode 声明。这是 P2 完成后最容易先验收的槽位——用户建项目的第一眼就能看出「模式真的换了」。

### 内置「模式作者」agent

同意用户的提议：平台自带一个创建新 mode 的内置插件（类比 ZCode 里让 agent 帮你写 skill/hook）。用户用自然语言描述想要什么，agent 全程代做：

1. **访谈**：问清领域、需要什么工具、要看到什么（对话即可，产出 mode.json + md 资产）
2. **生成资产**：prompt/skills/表单 schema/产物模板/recipe——纯声明部分全自动
3. **需要组件时**：按槽位契约生成组件代码（面板 tsx/舞台组件），给出标准骨架；开发者模式热加载预览
4. **校验与启用**：schema 校验 + 槽位 API 合规检查 + 试运行，用户确认后启用（类比 MCP 服务器授权）

可行性的前提是我们把**槽位契约做窄**：面板组件只拿到「会话状态 hooks + 产物数据 + 渲染容器」，写一个新面板就是在固定骨架里填内容——这正是 agent 最擅长改的那类代码。模板（panel 模板/stage 模板/工具卡模板）由平台预置，agent 填空即可，不需要它发明 UI 架构。

## 7. 实施阶段（每步独立可验收）

- **P1 引擎装配**：main.go 工具注册按 mode 配置装配；prompt/技能路径改由 mode 声明；**mode 改为会话级属性**（为跨 mode 组队铺路——每个会话按自己的 mode 装配工具集与 prompt，而不是进程级）
- **P2 桌面槽位化**：`modeRegistry.ts`（槽位 + 注册 API + activeMode）；现有 Flutter 组件平移进 `modes/flutter/`
- **P3 code 默认模式**：极简形态（无舞台/设备，base 工具集），跑通即证明内核干净
- **P4 artifact 机制**：通用产物面板 + 测试报告作为第一个注册实例迁入
- **P5 Team 协作层**：协作区 UI + 四原语（具名成员/寻址消息/任务板认领/文件域锁）+ 跨 mode 组队
- **P6 pipeline recipes**：验收流水线（flutter）与评审流水线（code）——pipeline run 的节点即 team 成员
- **P7 第三方资产包 + 模式作者 agent**：导入/导出、目录约定、用 agent 代建 mode

## 8. 现有资产归类对照

## 7. 现有资产归类对照

| 现有资产 | 归属 |
|---|---|
| SPEC 引导、generate-login-screen、testing/design 等 skills | mode（md） |
| flutter / device / ui_tree / tap / vision / bgexec 工具 | mode 工具集声明 |
| 新建项目表单 | mode project-fields schema |
| StagePanel / PhoneWindow / 截图流 | flutter mode 的 stage 槽位 |
| 左栏测试时间线 / 测试报告卡 | artifact-types + left-panel 槽位 |
| Read/Edit/Bash/Glob/Grep/Task | base 工具集（内核提供，code 类模式共用） |
| 对话流 / 工作段 / 提问 / 审批 / 队列 / 轮次轨 | 内核 |
| goagent 引擎 / 会话 / SSE 协议 / pipeline 运行时 | 内核 |
