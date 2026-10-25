# Blender 工作规则

1. 前置条件（首次使用一次性安装）：
   - Blender 4.2 LTS+（推荐 5.x）；
   - 在 Blender 里安装本插件自带的 `addon/BlenderAgent.zip`（Edit > Preferences > Add-ons > Install… > 勾选启用）——addon 在 Blender 内起 socket 服务（端口 9877）；
   - 之后 MCP 服务经 `mcp/launch.js` 连接该 socket（工具名前缀 `mcp__blender__*`）。连接失败先查：Blender 开着没有、addon 启用没有、端口是不是 9877。
   - Blender 不在默认安装路径（Steam 版等）：启动器 `mcp/launch.js` 自动探测（注册表关联 → PATH → 常见目录 → Steam 库），找到即注入 `BLENDER_BIN`。探测不到时在 `~/.amobilecreater/blender.json` 写 `{"blenderBin": "blender.exe 路径"}`。
   - **launch 失败禁止全盘扫描找 blender.exe**（递归扫盘又慢又吵）：先问用户 Blender 装在哪，拿到路径要么配 blender.json 要么用 Bash `start "" "<blender.exe>"` 拉起，然后 `server_status` 确认 9877 通了再继续。

2. **双轨操作策略**（本仓库策略，覆盖上游 SKILL 里「Python 仅作最后手段」的倾向——实测对强代码模型，脚本轨道的建模质量远高于在细粒度工具里挑选）：

   **轨道 A——创意/程序化建模：脚本优先（`exec_python`）**。做东西（建模型、改形体、程序化生成、批量操作）时，写**一段完整自包含的 bpy 脚本**一次到位，配 `vision_snapshot` 看结果迭代。要求：
   - 自包含：执行环境不跨调用保留变量——每次从 `bpy.data` 读取现有状态，结尾把产出写回场景；
   - 一次一段完整逻辑（一个形体/一个结构/一次批量操作），不要一行一个调用地挤牙膏；
   - 首行注释写明意图；出错会带完整 traceback，照着修脚本重发即可；
   - 能力开关：需要 Blender 启动时带 `BLENDER_AGENT_ALLOW_EXEC_PYTHON=1`（本插件 env 已配置，`blender_launch` 拉起时自动带上）；用户手动开的 Blender 无此 flag——用 `blender_launch` 重启会话，或 `exec_status` 查询状态。

   **轨道 B——精确操作与门禁：类型化工具**。查场景/对象清单、设变换、材质槽、UV、渲染参数、导出，以及 `vision_topology_inspect`/`vision_scale_report` 质量门禁——输入已校验、返回结构化 `refs` 可链式衔接。

3. **绝不盲模**：每段脚本执行后 `vision_snapshot` 亲眼看结果再迭代；交付前 `vision_contact_sheet` 多角度门禁 + `vision_topology_inspect`（流形/三角面）+ `vision_scale_report`（尺寸对照）。
4. 会话恢复：异常先 `server_status` / `addon_restart`，恢复后从 `bpy.data` 重新确认场景状态再继续，不要盲目重放已成功的操作。
5. 能力发现：`server_handlers` 是运行时工具清单真源；按域查工具用 `skills/blender-agent/TOOLS.md`（~216 个，20 组）；常见任务配方在 `skills/blender-agent/FLOWS.md`（类型化工具风格——轨道 A 场景可等价改写为单段脚本）。
6. 上游 aaa-modeling 技能未收编：按 SKILL.md 主循环 + 本规则双轨执行即可。

## 与视频工坊的衔接

Blender 产物（FBX/glTF/USD、渲染帧、转台视频）存进视频工程 `public/assets/` 后即可作为素材引用；3D 转台/参考视频可以直接喂给即梦等图生视频通道。
