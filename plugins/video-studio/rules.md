# 视频工坊工作规则

1. 工程就是当前项目目录：文件用内置工具按相对路径读写，命令用 Bash 在项目目录跑；三个视频专用工具（check_project / inspect_frames / view_image）的 dir 参数传项目目录绝对路径。
2. 首次开工：`node_modules` 不存在先 `npm install`；之后按流程走——读 brief → 缺关键信息问一次 → 任务清单 → storyboard → manifest → 场景 → check 全绿 → inspect_frames 看图 → 汇报。
3. **不看画面不交付**：inspect_frames 附图必须逐帧检查（构图溢出/重叠/对比度/入场完成/节奏）；有问题改完再看，整片写完至少整体看一遍。
4. 逐帧渲染硬约束：动画只由 useCurrentFrame 推导；禁止 Math.random / Date.now / 定时器 / fetch / useFrame；GSAP 只能 paused timeline。违反会在 check_project 报错。
5. 长命令（studio 预览 / render 导出）用后台任务；渲染报错时读完整错误（文件+行号）再改。
6. 实时预览走 `npm run studio` + 内置浏览器打开 localhost:3000；用户看完可以停后台任务。
7. 每个完成节点 git 提交一次；导出前必须 check 全绿。
