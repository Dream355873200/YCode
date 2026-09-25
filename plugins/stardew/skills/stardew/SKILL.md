---
name: stardew
description: 玩 Stardew Valley 的操作知识与策略：桥搭建、每日循环、体力/金钱纪律、按键语义
whenToUse: 需要在星露谷物语里读状态、移动、互动、经营农场时使用
---

# Stardew 操作知识

## 一次性搭建（SMAPI mod 桥）

1. 游戏装 SMAPI（https://smapi.io，安装器自动定位游戏）。
2. 编译本插件 mod：`powershell -File plugins/stardew/mod/build.ps1`
   （dotnet 编译后自动部署进游戏 Mods 目录）。
3. 用 SMAPI 启动器开游戏；SMAPI 日志出现 `YCode bridge: http://127.0.0.1:9875` 即桥就绪。
4. 没装 mod 时本插件的工具全部报搭建指引——不硬试。

## 工具语义与限制

- `sdv_state`：日期/时间/位置/金钱/体力/背包——**一切决策的起点**。
- `sdv_warp`：传送到地图内部坐标（当日移动主力；跳过寻路）。地点用英文内部名
  （Farm/Town/Beach/Forest/Mountain/SeedShop/Mine/Hospital…）。过场动画/事件期间 warp 会被 5s 超时挡住，稍等再试。
- `sdv_press`：单次按键。`MouseRight` = 互动（对话/开箱/收获/购买确认），
  `MouseLeft` = 使用当前工具（挥锄/浇水/砍），WASD = 走一格，`E` = 开背包菜单。
  **持续移动不在工具面里**（会话式按键不稳）——跨地图一律 warp；同地图内
  小距离移动才用 WASD 数次。
- 看不见游戏画面：菜单内容、 NPC 对话文本不在 state 里。操作菜单类交互
  （商店、箱子）时按一次 → sdv_state 无变化 → 说明打开了菜单但读不到，
  复杂菜单操作优先让用户手动，或用 computer-use 插件的视觉通道补充。

## 每日循环（经营类目标的默认骨架）

1. 醒来 `sdv_state`：看日期（季节/星期）、金钱、体力、背包。
2. 浇水优先（有作物时）：`sdv_press MouseLeft` 朝作物方向（工具=喷壶，按住蓄力不需要，单击即可）。
3. 农活做完再出门：卖货（SeedShop 周三休业！）、采集、钓鱼、下矿。
4. 体力红线：低于 20% 回家；2:00 AM 前上床（床 = Farm 小屋内，`sdv_press MouseRight` 对床）。
5. 睡前汇报：当日收入、作物状态、次日计划。

## 体力与金钱纪律

- 挥工具消耗体力：体力 = 当日行动预算，浇水 > 砍树 > 挖地。
- 雨天不用浇水（省下全部体力做别的）——看 `sdv_state` 的时间与天气需用户确认或试按观察。
- 卖东西只卖明确标注的出货类物品；工具/任务物品不卖（见 rules）。
- 撒种/收获后立刻记录在汇报里，避免重复操作。

## 典型目标分解

「第一年春天赚 5000g」：
1. 前 5 天：清农场 debris（MouseLeft）→ 种防风草（SeedShop 买种 → 回 Farm 播种 → 浇水）
2. 每日循环保持浇水；体力富余去 Beach/Forest 采集（采集物是早期主要收入）
3. 第 2 周起：下矿（Mine）前 5 层捡矿石，升级工具先斧/镐
4. 周五/周日购物前核对金钱预算（rules：大额消费先问）
