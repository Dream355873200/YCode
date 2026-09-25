# computer-use — 电脑控制插件

自动化桌面应用：智能体驱动鼠标、键盘与界面元素，代你完成实际任务。
工具面复刻 ZCode Computer Use 的语义（元素树观察 → 按索引操作 → fail-closed），
实现是零依赖 Node MCP server + PowerShell（Windows UI Automation / SendInput / GDI）。

## 提供

- MCP server `computer`（stdio）：`mcp__computer__list_apps / list_windows / open_app /
  get_app_state / screenshot / left_click / left_click_drag / scroll / type / key / paste / set_value`
- 技能 `computer-use`：观察-动作-再观察循环、辅助功能优先、坐标纪律
- 规范：与 browser-use 的分工、破坏性操作确认

## 平台后端契约

工具面与错误语义平台中立，实现按平台放 `mcp/backends/<platform>/`（Windows 已完整实现）。
新增平台 = 新目录实现同名脚本契约（JSON 入 `-Payload`，JSON 出；错误 `{__error:"<CODE>: …"}`）：

| 脚本 | 输入 | 输出 |
|---|---|---|
| `list_apps.ps1` | `{mode?:"windows", app?}` | `{apps:[{hwnd,pid,name,title,foreground,minimized}]}` / `{windows:[…]}` |
| `state.ps1` | `{app,max}` | `{hwnd,pid,title,truncated,elements:[{i,t,n,v,rt,b,cx,cy,off}],restored}` |
| `screenshot.ps1` | `{hwnd?\|name?\|pid?}` | `{b64,w,h,path,blank,restored}`（JPEG） |
| `input.ps1` | `{action,…}`（click/drag/scroll/type/key/paste） | `{ok,…}` |
| `value.ps1` | `{hwnd,runtime_id,expect_i,expect:{i,t,n},value}` | `{ok}` |
| `open_app.ps1` | `{name}`（应用名 / exe 路径 / **URL**） | `{ok,name,pid,hwnd,title,url,via_browser,via_foreground}` |

动作 fail-closed：`input.ps1` 收到 `runtime_id` 时重枚举元素树复核身份，元素消失/变化
返回 `STALE_STATE`，不按旧坐标盲点。错误码沿用：`APP_NOT_FOUND` / `STALE_STATE` /
`NOT_SETTABLE` / `UNKNOWN_KEY` / `UNKNOWN_ACTION` / `PLATFORM_NOT_SUPPORTED`。

### 元素定位：两遍策略（易变 UI 友好，仍 fail-closed）

序号（`@eN`）只在一次观察内稳定。浏览器地址栏这类元素树是毫秒级重排的，死守序号会
一直误报 `STALE_STATE`。因此定位分两遍：

1. **序号 + 身份**：按 `expect.i` 取元素，`runtimeId` 一致（或 类型+名称 一致）→ 直接用；
2. **身份重定位**：序号已错位时，全树按 **(类型, 名称)** 找，**名称非空且唯一匹配**才用；
   多个匹配或名称为空仍判 `STALE_STATE`（宁可不点，也不点错）。

server 侧 `relocate()` 在 STALE 自愈时用同一规则重定位后重试一次。

### 窗口状态归一（最小化）

最小化窗口的矩形是 `(-32000,-32000,219,30)`，UIA 树只剩一个 `Pane`，截图必是一片灰。
`state.ps1` / `screenshot.ps1` 检测到 `IsIconic` 会先 `ShowWindow(SW_RESTORE)` 再观察/截图，
输出里带 `restored:true` 告知调用方窗口状态被改过。

### 截图：PrintWindow 优先 + 纯色检测

窗口截图先走 `PrintWindow(PW_RENDERFULLCONTENT)`（被遮挡、不在当前显示器上的窗口也能拿到
内容），失败或**客户区**为纯色时回退 GDI 拷屏，取内容更多的那张。

已知局限：Chromium 系（浏览器 / Electron）的**页面内容区是 GPU 合成的，PrintWindow 截不到**，
只能截到标题栏/标签栏。需要网页内容请走 browser-use（网页内一律 browser-use），
本工具用于原生应用界面。

`blank:true` 表示截到的是纯色画面（窗口未渲染/被遮挡），模型不应把这种图当布局依据。

## 运行条件

Windows（UIA / SendInput / GDI）；`node` 在 PATH（引擎以 stdio 拉起 MCP server）。

### 中文 / 非 ASCII 载荷

Node 往子进程 stdin 写的是 **UTF-8 字节流**，而 PowerShell 5.1 的 `[Console]::In` 在中文
Windows 上按 GBK 解码——`"计算器"` 会变成 `"璁＄畻鍣?"`，`ConvertFrom-Json` 直接报
「传入了未终止的字符串」。所有后端脚本统一用 `Read-Payload()`（显式 UTF-8 StreamReader）
读 stdin，**新增脚本必须照做**，不要写 `[Console]::In.ReadToEnd()`。

### PowerShell 变量名大小写陷阱

PowerShell 变量名**大小写不敏感**：`$vk` 与 `$VK` 是同一个变量。历史 bug：`$vk = $VK[$k]`
把整个 VK 键表覆盖成一个数字，导致后续 `$VK[$m]` 取到 `$null`，组合键全部报
`Argument types do not match`。同类命名的局部变量请避开（用 `$code` 等）。
