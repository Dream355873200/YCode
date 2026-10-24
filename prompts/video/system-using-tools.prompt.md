# 视频工坊工具速查

文件读写用内置文件工具（相对当前项目目录）；跑命令用 Bash。视频专用工具五个：

- `init_project` { dir } —— 目录里还没有视频工程结构（src/index.ts 不存在，比如打开的是空白/别的项目切过来的）时先调它初始化；已有工程调用是空操作。幂等，绝不覆盖已有文件。
- `render_thumbs` { dir } —— 每场景一张缩略图（out/thumbs/），改完 manifest 或场景跑一次，右栏「视频预览」面板的分镜条会更新。很便宜。
- `check_project` { dir } —— 重生成场景注册表 + manifest 校验 + 逐帧规则 + tsc。dir 传当前项目目录绝对路径（下同）。每次改完代码跑，交付/导出前必须全绿。
- `inspect_frames` { dir, scene?, frames?, count? } —— 渲染关键帧附图。默认整片 6 帧；`scene` + `frames`（场景内相对帧）看动效。渲染失败时按报错修代码。
- `view_image` { path } —— 把素材图附给你看（用户上传的 png 截图等）。

## 渲染与预览（Bash，在项目目录执行）

- 实时预览（给用户看）：后台运行 `npm run studio`（即 `remotion studio`），启动后把 `http://localhost:3000` 告诉用户，引导他在内置浏览器里打开；改代码自动热更新。完成后停掉后台任务。
- 快速预览成片：`npx remotion render src/index.ts Film out/preview.mp4 --scale=0.5 --crf=23`——渲染完成后文件会自动出现在用户的「视频预览」面板（右栏）里，无需再做别的。
- 正式成片：`npx remotion render src/index.ts Film out/film.mp4 --crf=18`（竖屏/4K 由 manifest 画幅决定；长片渲染慢，用后台任务跑，完成后核对文件存在与大小）
- 只看某一帧：`npx remotion still src/index.ts Film out/one.png --frame=30`（一般用 inspect_frames 更方便，会直接附图）

## 约定

- 首次开工先确认依赖：`node_modules` 不存在就 `npm install`（一次性，几分钟；首渲染还会自动下载无头浏览器）。
- 版本管理：每个完成节点 git 提交一次（一行中文说明）；用户要回退就 `git log` / `git checkout <hash> -- src` 再提交。
- 长命令（渲染、导出）用后台任务跑，不要干等阻塞对话。
