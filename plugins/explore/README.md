# 插件：代码探索子代理（explore）

提供子代理 `explore`（工具名 `Agent_explore`）：主 agent 遇到「X 在哪 /
谁调用了 Y / 这个功能怎么实现的」这类需要跨文件多步检索的问题时委派给
它。子代理在独立的 agent 循环里用 Read / Glob / Grep 完成检索，只把结论
（路径 + 行号 + 要点）带回主对话，主上下文不被搜索过程撑爆。

- 定义文件：`agents/explore.md`（frontmatter = 元数据，正文 = 系统提示）
- 只读：子代理的工具调用不经审批，引擎只允许它引用只读工具
- 与语言/框架无关，code 与 flutter 模式都引用本插件

子代理格式与约束见 [../README.md](../README.md#子代理-agents)。
