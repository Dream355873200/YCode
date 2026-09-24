---
name: navigation
description: 搭建或修改页面导航与路由——选型跟随现状、跨页传参/回传刷新、异步 context 与返回拦截高频坑
when-to-use: 新增页面、页面间跳转、跨页面传参与刷新、底部/侧边导航壳搭建时
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, flutter
---
为本项目搭建或修改页面导航与路由结构。适用：新增页面、页面间跳转、跨页面传参与刷新、底部/侧边导航壳。

你是资深 Flutter 工程程师。动手前先做一件事：**读项目现有路由代码，跟随现状**——不引入新路由方案，不重构既有导航。

## 选型跟随规则（关键纪律）

| 项目现状 | 做法 |
|---|---|
| 已用 go_router | 全部跳转走 `context.go/push`，命名路由集中在 router 配置里注册，新页面先注册后使用 |
| 已用 Navigator 2.0（Router/RouteInformationParser） | 按既有 delegate 模式扩展 |
| 只有裸 `Navigator.push(MaterialPageRoute)`（多数项目） | 继续用 MaterialPageRoute，保持简单，不要"升级"成 go_router |
| 空项目首建 | 默认裸 Navigator + 路由路径常量集中一处；只有 SPEC 明确要求深链/URL 路由才上 go_router |

一致性优先于先进性：混用两套路由是 bug 之源。

## 高频坑（模型易错点，逐条自查）

1. **异步返回后刷新前页**：`await Navigator.push(...)` 返回后前页 `setState` 不会自动触发——用 `then` 或 await 后显式刷新，或在详情页 `pop(result)` 传回数据由前页处理。
2. **push 载荷过大**：跨页传参传 ID 而非整对象（对象改字段后旧引用不更新）；传 id + 前页查详情。
3. **BottomNavigationBar 状态丢失**：IndexStack 保持各 tab 页状态；每次 `Navigator.push` 新页面会丢——tab 切换用 IndexedStack，页面进入才用 push。
4. **context 跨异步使用**：`await` 之后用 `context` 前必须检查 `mounted`，否则 "Looking up a deactivated widget's ancestor" 异常。
5. **返回拦截**：表单页未保存返回要弹确认，用 `PopScope`（canPop + onPopInvoked），不要用已废弃的 WillPopScope。
6. **路由泄漏**：详情页持有的 controller/监听器在 dispose 释放；路由 push 进去的页面 pop 时其定时器/流订阅必须已取消。

## 验收

- 新路由可从入口到达，可返回，返回后来源页数据正确刷新（有副作用操作时必须验证这条）
- 分析零 error + 设备冒烟：tap 进入 → wait_for 目标页特征 → back → 前页状态未丢
