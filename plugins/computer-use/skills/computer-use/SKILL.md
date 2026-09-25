---
name: computer-use
description: "需要原生桌面应用自身 UI 或操作系统的任务用它：读/操作本机应用界面（元素树+截图+鼠标键盘）。网页内的操作一律走 browser-use。主对话专用，不要委派给子代理。"
---

# Computer Use（电脑控制）

读写用户电脑上原生应用的界面。工具是 `mcp__computer__*` 系列（MCP server `computer`），
Windows 实现：UI Automation 语义树 + GDI 截图 + SendInput。

- 有专用 API / CLI / 技能能完成的任务，优先用它们，不要绕道 UI 自动化。
- 浏览器与网页内的任务用 browser-use 插件，不要用电脑控制点网页。
- 除非用户点名要求，不要用 PowerShell 脚本、SendKeys 等其他 UI 自动化手段替代本工具面。

## 辅助功能优先

1. 先 `get_app_state` 观察语义元素树，按元素的名称/类型/值找到目标。
2. 找到元素就按**索引**操作：`invoke({target: 12})`、`set_value({target: 5, value})`。
3. 可设置元素优先 `set_value`；能激活的控件优先 `invoke`；富文本或不可设置目标用 `paste`；普通输入 `type`。
4. 真实鼠标点击（`left_click`）与键盘（`key`）是后备，屏幕坐标是最后手段（canvas / 自绘界面）。

观察（get_app_state / screenshot）在后台窗口上也有效，不打扰用户焦点。

## 后台操作：模式优先，坐标兜底

**读**（`get_app_state` / `list_apps` / `screenshot`）走 UIA 只读接口，后台窗口照样能读。

**写**分两条路，务必优先选第一条：

| | 方式 | 需要前台？ | 说明 |
|---|---|---|---|
| 首选 | `invoke({target})` —— UIA 模式（Invoke / Toggle / Select / Expand） | **不需要** | 直接调用控件接口，不注入鼠标键盘、不抢焦点、不动鼠标 |
| 首选 | `set_value({target, value})` —— ValuePattern | **不需要** | 直接设值（只读元素报 NOT_SETTABLE） |
| 兜底 | `left_click` / `type` / `key` —— SendInput | **需要** | 事件由系统派发给「该坐标点上最顶层的窗口」 |

- 元素树里的 `(press)` `(toggle)` `(select)` `(expand)` 就是 `invoke` 可用的信号；纯后台任务先用 `invoke`。
- `left_click` / `type` / `key` 的坐标路径带**遮挡校验**：该点最顶层的窗口不是目标时直接拒绝
  （`OBSCURED_TARGET`），不会盲点。遇到这个错误**不要重试**，改用 `invoke`，或先把窗口带到前台。
- `type` 带 `target` 时会先点该元素拿焦点（否则文字会打进当前焦点窗口，可能是完全无关的应用）。
- 游戏类（DirectInput / RawInput）**只认真实前台输入**，后台无解——用户在前台玩游戏时，
  不要往后台应用注入输入。

## 循环

**观察一次 → 动作 → 再观察**。批量动作 + 一次收尾观察。动作成功不等于应用生效：
输入后要重新观察确认文本真的落进去了。

- 元素索引来自**最近一次** get_app_state；界面变了索引就失效，动作返回 STALE_STATE
  时必须重新观察，不要按旧索引重试（fail-closed，不会点错地方）。
- 找不到弹窗时用 `list_windows` 看目标应用的其它窗口。
- 用户报的应用名原样使用；解析不到就 `list_apps` 找准确名字；没开就 `open_app`。

## 坐标

只有从当前截图上看到的坐标才能用；元素和窗口的边界数值不得当坐标抄。
指针动作"成功"但界面没变化，通常点在了真实指针位置——改用元素索引。

## 易变界面与最小化窗口

- **浏览器地址栏这类元素树是毫秒级重排的**：按索引 `set_value` 可能返回 STALE_STATE。
  组件会先按 (类型,名称) 在最新树里重定位一次再重试；若仍失败，改用
  **`left_click` 点住该元素 → `type` 输入 → `key` 回车**这条路径（鼠标点击拿焦点最稳）。
- **最小化窗口**：`get_app_state` 会先自动恢复窗口再观察（输出带"窗口原为最小化，已自动恢复"），
  `screenshot` 同理（`restored`）。元素树只有一个 Pane 通常是窗口状态问题，不是应用没控件。
- **截图纯色**：输出带「⚠ 画面为纯色」说明窗口没真正渲染，别把它当布局依据。

## 网页内容不要靠截图

Chromium 系（浏览器 / Electron）的页面内容是 GPU 合成的，窗口截图只能拿到标题栏，
页面区会是纯色。**需要网页内容一律走 browser-use**，本工具用于原生应用界面。

## 打开网址

`open_app` 可以直接传 URL（用默认浏览器打开），等价于"帮我打开某网址"：

```
open_app({name: "https://search.bilibili.com/all?keyword=xxx"})
```

返回里带浏览器窗口的 `hwnd`（按默认浏览器进程定位），可直接接着 `get_app_state` 观察。
**不要**用「点地址栏 + 输入」的方式开网址——地址栏是自绘控件，聚焦与输入都不稳定。

## 等待

UIA 观察是同步的，应用响应慢时观察会自然带上结果；不要在两次动作之间加人为延时，
用「再观察一次」确认状态。

## 工具一览

```
list_apps()                              # 可见应用窗口（pid/名称/标题/前台）
list_windows({app_ref})                  # 某应用全部窗口（弹窗排查）
open_app({name})                         # 启动应用（Start 菜单名 / exe / 路径 / URL）
invoke({target})                         # UIA 模式激活（后台安全，优先用）
get_app_state({app_ref?, include_screenshot?, max_elements?})
screenshot({app_ref?})                   # 屏幕或窗口截图（内联图片）
left_click({target, mouse_button?, click_count?, modifiers?})
left_click_drag({from_target, to, modifiers?})
scroll({target, scroll_direction, scroll_amount?})
type({text, target?})                    # Unicode 输入（支持中文）
key({text, repeat?, hold_seconds?})      # 组合键：ctrl+s / alt+F4 / Return
paste({text})                            # 剪贴板 + ctrl+v
set_value({target, value})               # ValuePattern 直接设值
```

`target` 一律是元素索引（整数）或 `{x, y}` 坐标。动作结果都附「观察确认」提示。

## 纪律

- 破坏性操作（删除、发送、下单、关机）先向用户确认。
- 完成的标准是**界面可见地呈现了结果**，不是某个动作返回 ok。
- 子代理不可用电脑控制；遇到权限拒绝不要换别的自动化技术硬闯。
- **不要让动作打到无关的应用上**：坐标类动作前确认目标窗口在前台或未被遮挡（组件会拦，
  但你自己也要判断）；用户在前台做别的事（玩游戏、开会）时，只做后台安全的 `invoke` / `set_value`。
