---
name: browser-use
description: "打开、检查、测试与验证网页时用：操作 YCode 内置浏览器（右栏可见）——导航、快照引用、点击、填表、截图、console。本地 localhost 目标与真实网站都适用。"
---

# Browser Use（浏览器操作）

操作 YCode 内置浏览器。工具是 `mcp__browser__*` 系列（MCP server `browser`），
浏览器显示在右栏「浏览器」面板，用户实时可见。实现是实例池（WebContentsView + CDP），
每次调用是独立请求，页面状态在实例里存活。

## 核心循环

```
browser_navigate(url) → browser_snapshot() → 按 @eN 动作 → browser_snapshot()/screenshot() 确认
```

1. **导航**：`browser_navigate({url})`，等加载完成返回标题。
2. **快照**：`browser_snapshot()` 返回紧凑可交互树，交互元素带 `@eN` 引用：
   `@e3 <input> "邮箱" [type=email]`、`@e5 <button> "提交"`。
3. **交互**：`browser_click({ref:"@e5"})`、`browser_type({ref:"@e3", text, submit:true})`。
4. **验证**：再快照看 DOM 结果；布局/视觉问题用 `browser_screenshot`（图片内联）；
   报错与日志用 `browser_console`。

页面导航或 DOM 变化后 @eN 即失效——重新快照。工具报「不在最近一次快照里」就是这个意思。

## 多实例

并行任务用 `browser_new({url})` 开独立实例（返回新 id），之后所有工具传 `browser: <id>`。
`browser_list` 看全部实例（挂起的实例激活时自动恢复）。任务结束 `browser_close` 收尾。
不传 browser 参数 = 操作当前激活实例（右栏显示的那个）。

## 常用组合

```text
# 表单
browser_snapshot → browser_type(@输入框, 文本) → browser_click(@提交) → browser_snapshot 验证
# 下拉/搜索联想：browser_click(@select) → browser_snapshot（选项出现为新 @eN）→ browser_click(@option)
# 键盘操作：browser_key({key:"Control+a"}) / browser_key({key:"Enter"})
# 滚动：browser_scroll({dy: 600}) → browser_snapshot（懒加载内容出现）
# 视觉验证：browser_screenshot({fullPage:true})
# 前端调试：browser_console（error/warn 一览）→ browser_evaluate 读状态
```

## 语义细节

- 快照引用按「最近一次快照」冻结坐标；快照是默认的定位事实，比坐标可靠。
- 点击后自动等加载；SPA 路由没有加载事件——自己再快照确认。
- `browser_evaluate` 是显式能力（走引擎权限审批）：验证性读取、读取快照表达不了的
  状态（如 localStorage）；不要用它绕过页面交互硬改状态。
- 只允许 http/https/about:blank；file: 与其它 scheme 被拒绝。
- 弹窗（window.open）并入当前实例历史，不会丢失。
- 登录态持久（persist 分区）：重复任务不用重复登录；需要隔离时开新实例。

## 与电脑控制的分工

网页内 → browser-use；原生桌面应用与 OS → computer-use。两者不要混用同一个动作。
