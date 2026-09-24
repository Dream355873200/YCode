# browser-use — 浏览器操作插件

操作 YCode 内置浏览器（右栏「浏览器」面板，用户实时可见）：打开、导航、检查、
点击、填表、截图、console 验证。快照引用语义（@eN）衍生自 vercel-labs/agent-browser
（Apache-2.0，见 THIRD-PARTY-NOTICES）。

## 提供

- MCP server `browser`（stdio 薄代理）：`mcp__browser__list/new/close/navigate/back/
  forward/reload/snapshot/click/type/key/scroll/screenshot/console/evaluate`
- 右栏面板 `browser`：实例 tab 条 + 地址栏 + 浏览区（主进程 WebContentsView 实例池）
- 技能 `browser-use`：导航→快照→动作→验证循环、多实例并行纪律
- 规范：快照引用优先、实例收尾、与 computer-use 的分工

## 架构

```
mcp__browser__* → 引擎 MCP 客户端 → localhost HTTP（Bearer token）→ 壳主进程
  browserctl.js：WebContentsView 实例池（活实例上限，超限挂起 LRU——销毁渲染进程
  留壳记录，激活时恢复重建）+ 自管历史栈（前进/后退跨挂起存活）
  + webContents.debugger（CDP）：DOMSnapshot 快照 / Input 事件 / 截图 / console
```

安全：仅 127.0.0.1 + token（引擎经 FLAI_BROWSER_PORT/FLAI_BROWSER_TOKEN 获得）；
scheme 白名单；guest 权限请求默认拒绝；动作按实例串行；evaluate 走引擎权限审批。

## 平台

依赖 Electron（桌面壳）与 `node`（MCP server 由引擎以 stdio 拉起）。
