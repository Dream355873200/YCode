# 视频工坊工作规则

1. 工程就是当前项目目录：文件用内置工具按相对路径读写，命令用 Bash 在项目目录跑；三个视频专用工具（check_project / inspect_frames / view_image）的 dir 参数传项目目录绝对路径。
2. 首次开工：目录里没有 `src/index.ts` 先调 `init_project`；`node_modules` 不存在再 `npm install`；之后按流程走——读 brief → 缺关键信息问一次 → 任务清单 → storyboard → manifest → 场景 → check 全绿 → inspect_frames 看图 → 汇报。成片默认配乐：导出前按 video-audio 技能做声音（cues.json 从 manifest 出，soundtrack.py 生成后接进 manifest.audio）。
3. **不看画面不交付**：inspect_frames 附图必须按其六维清单逐维检查（风格保真/概念/动效/排版/质感/技术规范），输出按影响排序的修复清单；有问题改完再看，整片写完至少整体看一遍。改完 manifest/场景结构后跑一次 render_thumbs（很便宜），用户右栏的分镜条才会更新。
4. 逐帧渲染硬约束：动画只由 useCurrentFrame 推导；禁止 Math.random / Date.now / 定时器 / fetch / useFrame；GSAP 只能 paused timeline。违反会在 check_project 报错。
5. 长命令（studio 预览 / render 导出）用后台任务；渲染报错时读完整错误（文件+行号）再改。
6. 实时预览走 `npm run studio` + 内置浏览器打开 localhost:3000；用户看完可以停后台任务。快速预览渲染到 `out/preview.mp4`、成片渲染到 `out/film.mp4`——这两个路径的产物会自动出现在用户的「视频预览」面板里。
7. 每个完成节点 git 提交一次；导出前必须 check 全绿。
8. 风格库只是参考不是约束：用户点名库内风格 → 读 video-styles 技能按 STYLE.md 落地并看图对照验收；用户没点名 → 按需求原创设计（可以做得比库更好），库仅作气质参考，不要主动套库或强推选风格；用户自己的风格放项目根 styles/。
