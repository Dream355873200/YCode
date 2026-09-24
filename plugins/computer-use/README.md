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
| `state.ps1` | `{app,max}` | `{hwnd,pid,title,truncated,elements:[{i,t,n,v,rt,b,cx,cy,off}]}` |
| `screenshot.ps1` | `{hwnd?}` | `{b64,w,h,path}`（JPEG） |
| `input.ps1` | `{action,…}`（click/drag/scroll/type/key/paste） | `{ok,…}` |
| `value.ps1` | `{hwnd,runtime_id,expect_i,value}` | `{ok}` |
| `open_app.ps1` | `{name}` | `{ok,name,pid,hwnd,title}` |

动作 fail-closed：`input.ps1` 收到 `runtime_id` 时重枚举元素树复核身份，元素消失/变化
返回 `STALE_STATE`，不按旧坐标盲点。错误码沿用：`APP_NOT_FOUND` / `STALE_STATE` /
`NOT_SETTABLE` / `UNKNOWN_KEY` / `UNKNOWN_ACTION` / `PLATFORM_NOT_SUPPORTED`。

## 运行条件

Windows（UIA / SendInput / GDI）；`node` 在 PATH（引擎以 stdio 拉起 MCP server）。
