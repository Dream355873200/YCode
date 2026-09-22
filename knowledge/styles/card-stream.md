# 风格定义：card-stream（卡片内容流风）

小红书/Instagram/Pinterest 系：内容即卡片、圆角大阴影、图片主导、双列瀑布流。
适合：内容社区、电商种草、图文浏览、收藏夹类应用——用户预期「丰富、有发现感」。

## 色板（theme.dart 的 ColorScheme 全部从这里取值）

| Token | 值 | 用途 |
|---|---|---|
| primary | #FF2442（品牌红） | 点赞、关注、价格、主按钮 |
| onPrimary | #FFFFFF | 主按钮文字 |
| background | #F5F5F5（浅灰底，让白卡片浮出） | 页面底 |
| surface | #FFFFFF | 卡片底（永远白色，和 background 形成层次） |
| onSurface | #333333 | 主文字（不用纯黑，社区风偏柔） |
| onSurfaceVariant | #999999 | 次要文字、用户名、时间戳 |
| error | #FF3B30 | 错误 |
| likeActive | #FF2442 | 点赞激活（同 primary） |

深色模式：background → #121212、surface → #1E1E1E、onSurface → #EEEEEE、onSurfaceVariant → #777777。primary 不变。

## 形状与尺寸

- 内容卡片圆角：12；卡片间距 8（双列瀑布流 gutter）、页边距 8——卡片流的外边距要小，让内容密集
- 按钮圆角：全圆角（StadiumBorder）——卡片流风格的主按钮是胶囊形，高度 44
- 标签/话题 chip：胶囊圆角、surfaceVariant 底、13 号字、内边距水平 12 垂直 6
- 头像：圆形，尺寸体系 24（评论）/ 36（列表）/ 48（详情作者）
- 图片：圆角与卡片一致（12）、宽高比——瀑布流双列不固定高（按图片原始比例，用 AspectRatio 或直接 Image 自适应），单列 feed 固定 3:4 或 1:1（SPEC 定）
- 底部导航：白底、无标签切换时的激活主色 + 轻微放大动效（scale 1.0→1.15，150ms）

## 排版

- 字体：系统默认
- 字号体系：内容标题 17 semibold / 正文 15 / 互动数据（点赞数）13 / 话题标签 13 primary 色 / 用户名 14 semibold
- 文字密度高：卡片内文字最多 2 行 + ellipsis（信息流的文字是摘要不是正文）
- 价格体系（电商向）：现价 17 bold #FF2442、原价 13 onSurfaceVariant 删除线

## 动效

- 曲线：Curves.easeOut（内容流讲究快进慢停）；时长偏短——页面转场 250ms、卡片按压 100ms
- 卡片按压反馈：scale 0.98 + 阴影减淡（100ms），松手恢复——不是水波纹
- 点赞动效：图标 scale 0→1.2→1.0 弹性曲线（Curves.elasticOut，400ms）+ 数字 +1 上浮
- 下拉刷新：Material RefreshIndicator 可用（绿/品牌色），或自定义 lottie
- 图片加载：淡入 200ms + 灰色占位（surfaceVariant），禁止跳帧突现

## 布局骨架

- 首页 = 顶部搜索/标签横滑条（高度 44）+ 双列瀑布流（flutter_staggered_grid_view 或自算两列高度取短的放下一张）
- 详情页 = 顶部大图（可 3:4）+ 内容 + 底部互动栏（点赞/收藏/评论 icon+数，固定底栏高度 50）
- 卡片信息结构：图（自适应高）→ 标题 2 行 → 底行（头像 24 + 用户名 + 点赞数）

## 组件规格速查

- 空态：插画 + 「发布第一条内容」主操作——卡片流的空态是引导创作，不是引导等待
- 加载更多：列表底部 CircularProgressIndicator 24pt 淡入；触底前 200px 预加载
- 长按：不做 iOS action sheet——卡片流是轻交互，长按弹小菜单（点赞/收藏/不感兴趣）
- 评论输入：底部固定栏（头像 + 圆角输入框 + 发送胶囊按钮），不是居中对话框

## 反模式（出现即破坏风格）

- iOS 式 InsetGrouped 灰底分组列表（这是工具风，内容流要白卡片浮在灰底上）
- 无圆角直角卡片、 elevation 重阴影（卡片流阴影要轻：elevation 1-2 或 BoxShadow 8% 透明度 blur 12）
- 纯文字列表页（内容流没有图 = 不成立；没有图片资源的功能用图标占位卡片）
- FAB 发布按钮要用品牌色大号（56）+ 阴影——卡片流里 FAB 是主流做法（和 apple-clean 相反）
