---
name: local-data
description: 搭建或修改本地数据层——持久化选型决策树、建表/迁移/初始化时序、SQL 参数化安全基线
when-to-use: 功能需要保存数据（不联网或离线优先）、数据库报错（no such column 等）、数据不落盘或列表不刷新时
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, flutter
---
为本项目搭建或修改本地数据层：持久化选型、数据库表结构、迁移、初始化时序。适用：需要保存数据的功能（不联网或离线优先）。

你是资深 Flutter 工程师。动手前先看项目 pubspec.yaml 与既有数据层代码，跟随现有选型。

## 选型决策树（新项目时按此选，已有实现则跟随）

```
数据特征是什么？
├─ 少量键值（设置项/开关/最近使用记录）→ shared_preferences
├─ 结构化数据、量可增长（账目/任务/聊天记录）→ sqflite
│    └─ 需要对象快速读写、无复杂查询 → hive（已引入才用，不新增）
└─ 敏感信息（token/密码/密钥）→ flutter_secure_storage（无例外，安全基线）
```

混合场景（任务列表 + 用户设置）就组合用：sqflite 存任务、shared_preferences 存设置——不是非此即彼。

## 高频坑（逐条自查）

1. **异步初始化时序**：sqflite `openDatabase` 是异步的。把 db 实例封装成单例 Repository，在 `main()` 里 `WidgetsFlutterBinding.ensureInitialized()` 后 await 初始化完成再 runApp——绝不能 Widget 构造时才惰性 open（首个帧读到 null）。
2. **migration 缺失**：建表必须带 `version` + `onUpgrade`。加新表/新列 = version+1 + onUpgrade 里写 ALTER/CREATE。直接改 onCreate 不写 onUpgrade，老用户升级即崩溃（"no such column"）。
3. **SQL 注入**：一律参数化 `db.query('todos', where: 'id = ?', whereArgs: [id])`，禁止字符串拼接（安全基线，无例外）。
4. **主键与时间戳约定**：自增 id INTEGER PRIMARY KEY AUTOINCREMENT + createdAt/updatedAt INTEGER（毫秒）。给每张表加 createdAt——列表排序几乎必然用到，后补要迁移。
5. **UI 不直接碰 db**：Widget 只调 Repository 方法（返回 Future/Stream），数据层变化才能不牵动 UI。Repository 用 Stream（sqflite 查不到变更通知，手动在写操作后 add 到 StreamController）让列表自动刷新——这是"创建成功列表立即更新"的可靠实现路径。
6. **软删除考虑**：数据有关联（分类下的账目）时，删分类会级联影响——要么外键约束 + CASCADE，要么软删除标记 deletedAt。选哪种看 SPEC，但必须选一种，不能裸 DELETE 挂着孤儿数据。
7. **测试数据分离**：单元测试用 `sqflite_common_ffi` 内存库，不碰真库。

## 验收

- 冷启动读旧数据正常（kill 进程重开验证一次）
- 写后 UI 即时反映（经 Stream，非手动 setState 补偿）
- 升级路径可跑：旧 version 建库 → 新 version 代码打开 → 数据完好
