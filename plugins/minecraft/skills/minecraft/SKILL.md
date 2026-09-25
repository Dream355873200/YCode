---
name: minecraft
description: 玩 Minecraft 的操作知识与策略：工具用法、连接配置、生存与建造的工作循环
whenToUse: 需要在 Minecraft 里移动、采集、合成、建造、战斗或聊天时使用
---

# Minecraft 操作知识

## 连接配置（一次性）

bot 连接参数来自环境变量 `MC_HOST / MC_PORT / MC_USERNAME / MC_PASSWORD / MC_VERSION`，
或插件目录 `plugins/minecraft/mcp/config.json`（同名字段，优先级低于环境变量）：

- **局域网联机**：房主单人世界 → Esc → 「对局域网开放」→ 记下端口（替换 MC_PORT）。
  客户端不开 LAN 的话 bot 进不来。
- **离线服 / 第三方启动器**：`password` 留空（offline 认证），`MC_VERSION` 与服务器一致。
- **正版在线服**：设 `MC_PASSWORD`（Microsoft 账号），auth 走微软。
- 改完配置不用重启应用：工具下一次调用会重新连接。

## 工作循环（每个任务都按这个来）

1. `mc_state` —— 我在哪、生命/饥饿多少、背包里有什么
2. `mc_blocks_around` —— 找目标资源/地形（name 模糊匹配，找不到就 `mc_move_to` 换区）
3. `mc_move_to` —— 靠近目标（长距离拆中间点；超时说明不可达，绕路）
4. `mc_dig` / `mc_craft` / `mc_place` —— 干活（挖掘产物自动吸入背包）
5. 汇报：挖了什么、造了什么、当前坐标与状态

## 关键机制

- **寻路**：`mc_move_to` 用 A* 自动绕障、上 1x1 塔、搭桥。超时 = 目标不可达
  （水、悬崖、未加载区块），拆成 2~3 个中间点分步走。
- **区块加载**：`mc_blocks_around` 只能看到已加载区块。距离太远看不到目标时，
  先朝那个方向 `mc_move_to` 一段距离再扫。
- **合成**：2x2 配方（木板、木棍、工作台）徒手可合成；3x3 配方（镐、熔炉）
  必须靠近工作台——`mc_craft` 会自动找 5 格内的工作台，找不到就先
  `mc_craft` 一个 crafting_table 放地上，再传 table 坐标。
- **工具进阶链**：徒手撸树 → 木板 → 工作台 → 木镐 → 挖圆石 → 石镐/石剑 → 铁路线。
- **战斗**：`mc_attack` 只够打 1~2 只小怪；被围了就 `mc_move_to` 撤退或垫方块自保。
- **死亡**：重生在出生点，背包掉落原地——长任务先在出生点旁建储物箱存贵重品。

## 典型目标分解示例

「给我弄一套石质工具」：
1. `mc_blocks_around` name=tree（或 oak_log）→ `mc_move_to` → `mc_dig` name=log count=5
2. `mc_craft` crafting_table → `mc_place` 放地上
3. `mc_craft` wooden_pickaxe（靠近工作台）→ `mc_dig` name=stone count=8
4. `mc_craft` stone_pickaxe + stone_sword + stone_axe（工作台旁）
