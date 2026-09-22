# 风格定义：apple-clean（苹果系简洁风）

iOS 人机界面指南的 Flutter 化：白底、大圆角、细腻分隔线、系统级动效曲线。
适合：工具类、效率类、内容阅读类应用——用户预期「干净、跟手、不抢戏」。

## 色板（theme.dart 的 ColorScheme 全部从这里取值）

| Token | 值 | 用途 |
|---|---|---|
| primary | #007AFF（iOS 系统蓝） | 主操作按钮、选中态、链接 |
| onPrimary | #FFFFFF | 主按钮文字 |
| background / surface | #FFFFFF | 页面底、卡片底 |
| surfaceVariant | #F2F2F7（iOS 系统灰） | 分组背景、输入框底、次级面板 |
| onSurface | #000000 | 主文字 |
| onSurfaceVariant | #8E8E93（iOS 系统灰文字） | 次要文字、占位符 |
| error | #FF3B30 | 错误、删除 |
| separator | #C6C6C8（iOS 分隔灰） | 分隔线、描边 |
| success | #34C759 | 成功反馈 |

深色模式：background/surface → #000000 或 #1C1C1E，surfaceVariant → #2C2C2E，onSurface → #FFFFFF，separator → #38383A。其余不变（iOS 深色模式主要翻底色）。

## 形状与尺寸

- 卡片/分组容器圆角：16（iOS 的 continuous corner，Flutter 用 RoundedRectangleBorder 实现）
- 按钮圆角：14；高度 52（主按钮）/ 44（次按钮，对齐 iOS 最小触控）
- 输入框：圆角 12、填充 surfaceVariant 底、无边框（filled:true + OutlineInputBorder border 透明）——iOS 输入框是灰底无边框，不是 Material 的描边式
- 底部弹层（modal bottom sheet）：顶部圆角 16，配 DragHandle（宽 36 高 5 的 separator 色圆条）
- 列表分组：InsetGrouped 样式——surfaceVariant 圆角 16 的分组容器内嵌行，行高 ≥44，行间分隔线左缩进 16（对齐文字）

## 排版

- 字体：系统默认（SF Pro 不可商用，中文 PingFang 不可用——不指定 fontFamily，让平台回退，这是 iOS 风在跨平台下的正确做法）
- 字号体系：大标题 28 bold / 页面标题 20 semibold(=w600) / 正文 17 / 次要 15 / 辅助 13 / 脚注 12
- 行高：正文 1.4；文字颜色层级只用 onSurface / onSurfaceVariant 两档，不再细分

## 动效

- 曲线：Curves.easeInOut（iOS 的趋近）；时长——转场 300ms、组件内状态变化 250ms
- 页面转场：iOS 右滑进入用 `CupertinoPageRoute`（自带右滑返回手势）——Material app 里可以只对内容页用
- 禁止 Material 的水波纹 InkSplash：整体 theme 的 splashFactory 设 NoSplash.splashFactory，交互反馈用 0.05 透明度的按下态（iOS 是高亮不是扩散）

## 组件规格速查

- 导航栏：CupertinoNavigationBar（半透明毛玻璃 backdroFilter，标题居中）或 Material AppBar 白底无阴影 + 标题居中
- 开关：CupertinoSwitch（不是 Material Switch）
- 对话框：iOS 风是 action sheet（CupertinoActionSheet）或居中弹窗圆角 16、按钮行高 44、竖排分隔线——选用哪个看操作破坏性：破坏性确认用 action sheet + 红色确认字
- 空态：SF Symbol 风格的线性插画或大图标（64pt，onSurfaceVariant 30% 透明度）+ 一行说明 + 主操作按钮
- 列表左滑操作：Dismissible → iOS 风是尾部滑出操作按钮（删除红底白字），不是 Material 的整卡滑动消失

## 反模式（出现即破坏风格）

- Material elevation 阴影堆叠（卡片用 1px separator 描边或无描边，不用投影分层——iOS 用留白和灰底分组，不用影子）
- FAB 悬浮按钮（iOS 风没有 FAB；主操作放导航栏右上角文字按钮或底部主按钮）
- 非居中标题的 AppBar
- checkbox（iOS 用 CupertinoSwitch 或勾选列表行的 checkmark）
