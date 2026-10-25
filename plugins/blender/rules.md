# Blender 智能体工作规则

1. 前置条件（首次使用一次性安装）：
   - Blender 4.2 LTS+（推荐 5.x）；
   - 在 Blender 里安装本插件自带的 `addon/BlenderAgent.zip`（Edit > Preferences > Add-ons > Install… > 勾选启用）——addon 在 Blender 内起 socket 服务（端口 9877）；
   - 之后 MCP 服务经 `npx @pobruno/blender-agent` 连接该 socket（工具名前缀 `mcp__blender__*`）。连接失败先查：Blender 开着没有、addon 启用没有、端口是不是 9877。
   - Blender 不在默认安装路径（Steam 版等）：启动器 `mcp/launch.js` 自动探测（注册表关联 → PATH → 常见目录 → Steam 库），找到即注入 `BLENDER_BIN`。探测不到时在 `~/.amobilecreater/blender.json` 写 `{"blenderBin": "blender.exe 路径"}`。
   - **launch 失败禁止全盘扫描找 blender.exe**（递归扫盘又慢又吵）：先问用户 Blender 装在哪，拿到路径要么配 BLENDER_BIN 要么用 Bash `start "" "<blender.exe>"` 拉起，然后 `server_status` 确认 9877 通了再继续。
2. 操作纪律（typed tools，禁止临场拼 Python）：所有操作走类型化工具——输入已校验、输出结构化为 `{ ok, data, refs, nextSteps, warnings }`，`refs` 里的对象/材质/骨骼名直接链进下一次调用。不要让模型即兴写 bpy 脚本（那是其他 Blender MCP 的老毛病：不可复现、无撤销分组）。
3. **绝不盲模**：每次改动后 `vision_snapshot`（GUI 截图/后台 EEVEE 渲染）看一眼再继续；交付前 `vision_contact_sheet` 多角度门禁 + `vision_topology_inspect`（三/四边面、流形）+ `vision_scale_report`（尺寸对照）。
4. 一次复合操作一个撤销组：Ctrl+Z 回退整个操作，失败排查时先 `server_status` / `addon_restart` 恢复会话，不要重复提交同一操作。
5. 能力发现靠 `server_handlers`（运行时自省，工具清单的实时真源）；按域查工具用 `skills/blender-agent/TOOLS.md`（~216 个，20 组）；常见任务（建模全流程/硬表面/绑骨/导出 UE5 等）的确定性调用序列在 `skills/blender-agent/FLOWS.md`，有配方照配方，没有配方回落 SKILL.md 的「看→改→再看」循环。
6. 工作流顺序参考 skills/blender-agent/SKILL.md：`blender_launch` 首调 → 建模循环 → 质量门禁 → 导出。大型建模任务原包另有 aaa-modeling 技能（未收编，本仓库不可用——按 SKILL.md 主循环执行即可）。
7. 与视频工坊的衔接：Blender 产物（FBX/glTF/USD、渲染帧、转台视频）存进视频工程 `public/assets/` 后即可作为素材引用；3D 转台/参考视频可以直接喂给即梦等图生视频通道。
