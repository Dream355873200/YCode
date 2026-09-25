# DeepSeek harness「一切皆插件」调研结论与落地路线

> 调研对象：`C:\Users\Yume\Downloads\deepseek-harness-master`（Cordis 4 fork 驱动，
> 工具/命令/技能/UI 面板/LLM 适配器/agent loop 全部插件化）。
> 本文记录哪些启发值得吸收、哪些已落地、哪些留作路线——不是照搬清单。

## 一、它的三根支柱（为什么「一切皆插件」成立）

1. **统一插件协议**：`name / inject / provide / Config(schema) / apply`。
2. **fiber 生命周期**：插件启动期间注册的一切（工具/命令/事件订阅）挂到
   当前 fiber，卸载时自动逆序撤销——「注册即登记，卸载即注销」。
3. **服务即 ctx 属性**：注册表本身（tools/skills/commands）也是插件提供的
   Service；消费方声明 `inject`，服务未就绪则插件保持 PENDING。

## 二、对我们的启示与落地状态

### 已落地 ✅

#### 1. 插件级生命周期注册表（fiber 思想的轻量版）—— 本引擎
**动机**：我们的资产清理逻辑原先散在各自的对账函数里（agents.go 的
installedAgents 隐藏、mcp.go 的 hide+disconnect），新增资产种类要改每一处。
**落地**：`lifecycle.go` —— 每插件资产的 disposer 登记（`registerDispose`
注册即登记 / `disposeAsset` 单资产撤销 / `disposePluginAssets` 整插件逆序
撤销）。子代理与 MCP 连接的清理统一走它；插件停用/卸载 = 一句
`disposePluginAssets(id)`。

#### 2. 插件启停（设置页开关，立即生效）—— 本引擎
**动机**：harness 的 plugin-manager 支持运行期安装/卸载；我们此前只有
「改清单 + POST /reload 全量重建」。**落地**：禁用集
`<userRoot>/plugins-disabled.json`（用户覆盖内置默认）+ `Plugin.Disabled` +
`POST /plugins/{id}/enabled` 启停路由：停用 → `disposePluginAssets` 撤销
其全部资产（子代理下线、MCP 断开、工具隐藏）→ reload 对账自然收敛；
启用 → reload 重新装配。不打断在跑的会话（下一轮生效）。

#### 3. 权限 Guard 链（单调策略管线）—— GoAgent
**动机**：harness 的工具执行是 `pre-execute waterfall → monotonic guard →
execute → post-execute`，任何 guard 可拒、无人可强行放行。我们的
Gate.Check 是单点线性检查，审批分层（成员→leader→用户）、场景包注入额外
策略都需要可插拔点。**落地**：`permission.Gate.AddGuard/RemoveGuard` +
`WithPermissionGuard` Option + `App.AddPermissionGuard`——Guard 在 deny
规则之后、模式判定之前运行，**单调：可拒不可放**（拒绝是终点，返回
nil/allow 等于交还后续策略链）。

### 路线图（按依赖排序，未实现）

#### 4. 审批 waterfall 化（Guard 链的直接消费者）
成员危险操作升级 leader 的适配器做成一条 Guard + 一个决策工具：
成员 ask → Guard 转为「向 leader steering 插话 + 挂起等待」→ leader 用
`approve_request(id, decision)` 决策 → resolve 回成员；超时自动升级用户。
当前 v1（成员请求直接进群聊用户终审）继续工作，waterfall 化是增量升级。

#### 5. id 寻址的 patch-overlay 配置（场景包的地基）
bundle 层每个配置行有稳定 id，上层按 id 只改字段、末写胜出、`!!js` 条件。
对应我们：chat/game 场景包分发 = 基础插件清单 + 场景 patch 文件
（按插件/模式 id 微调 toolsets 开关、角色卡、审批策略），不做整包覆盖。
落地时机：场景包规划（chat/game 群体）进入实现阶段时。

#### 6. 市场分发链路（plugin-manager 思想）
registry/git/tarball 多源安装、失败回滚、版本兼容门（豁免需显式
acceptRisk）。依赖 5（安装产物要能表达 patch）。

#### 7. UI 声明式 slot（若开放第三方插件 UI）
现在 `MODE_PANELS` 是前端硬编码注册表；开放生态时换成「声明即授权」的
slot 系统（未声明的 key 注册即报错、卸载递归收拢子 slot）。

### 明确不吸收

- **agent loop / provider 也插件化**：调试链路深、类型合并满天飞；Go 单体
  引擎在性能与可调试性上是优势。
- **自研/引入插件内核框架**：Cordis 是 TS 运行时；我们的插件是纯数据清单
  （plugin.json/md），引擎侧只要生命周期归属清晰即可，无需引入内核。

## 三、与现有机制的关系（不重复造轮子的边界）

| harness 机制 | 我们已有的等价物 | 增量 |
|---|---|---|
| 插件热重载 | POST /reload 原子替换 + MCP 指纹保连 + 子代理 want-set 对账 | 生命周期归属统一到 disposer |
| agent preset（会话级能力组合） | mode（会话级三层装配） | 无需——已对齐 |
| skill provider 注册表 | skillCatalog（插件>用户>内置，优先级去重） | 无需 |
| monotonic guard | （无） | 本轮新增，见上 |
| patch overlay | （无） | 场景包阶段做 |
