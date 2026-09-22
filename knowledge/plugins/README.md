# knowledge/plugins/ — 设备能力插件样板

把引擎的领域能力包装成「文档化的插件」：每个插件一份清单文档，
说明提供哪些工具、按什么模型使用、如何扩展。新插件照此模板撰写。

| 插件 | 文档 | 提供工具 |
|---|---|---|
| 设备测试 | [device-testing.md](device-testing.md) | ui_tree / tap / swipe / type / back / wait_for / screenshot / screen_diff / logcat / net / vision_ask / test_report |

## 插件文档模板

```markdown
# 插件名
一段话：这个插件解决什么问题、适用什么场景。

## 工具清单
| 工具 | 层级 | 输入 | 输出/断言 |

## 使用模型
AI 按什么顺序/成本策略调用这些工具（如：先便宜的证明，不行再贵的）。

## 状态与数据
插件落盘了什么（基线/报告/日志），放在哪，如何被复用。

## 扩展指引
加一个新工具的步骤与约束（命名、与现有层级的关系、副作用分级）。
```
