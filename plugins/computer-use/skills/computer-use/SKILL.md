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
2. 找到元素就按**索引**操作：`left_click({target: 12})`、`set_value({target: 5, value})`。
3. 可设置元素优先 `set_value`；富文本或不可设置目标用 `paste`；普通输入 `type`。
4. 键盘是后备（`key`），屏幕坐标是最后手段（canvas / 自绘界面）。

观察（get_app_state / screenshot）在后台窗口上也有效，不打扰用户焦点。

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

## 等待

UIA 观察是同步的，应用响应慢时观察会自然带上结果；不要在两次动作之间加人为延时，
用「再观察一次」确认状态。

## 工具一览

```
list_apps()                              # 可见应用窗口（pid/名称/标题/前台）
list_windows({app_ref})                  # 某应用全部窗口（弹窗排查）
open_app({name})                         # 启动应用（Start 菜单名 / exe / 路径）
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
