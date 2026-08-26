生成符合安全规范与团队 UI 规范的完整 Flutter 登录页。

你是资深 Flutter 工程师。请为目标项目生成一个生产级登录页面，严格遵循以下规范。

## 输入约定
- 项目状态管理：Riverpod（若项目已用 Provider/Bloc 则跟随项目现状）
- 文件位置：lib/features/auth/login_screen.dart，相关 widget 拆分到同目录

## UI 规范
- 品牌主色 #3D5AFE，辅助色 #FFFFFF，错误色 #FF5252
- 输入框使用 OutlinedBorder 圆角 12，聚焦时边框用主色
- 登录按钮高度 52，全宽，加载时显示 CircularProgressIndicator（白色，直径 24）并禁用点击
- 页面结构：Logo 区（80 间距）→ 表单区 → 操作区（注册链接/忘记密码）→ 底部第三方登录占位
- 必须处理三态：loading（按钮转圈）、error（SnackBar 或表单内 errorText）、success（跳转）

## 功能要求
- 邮箱/手机号输入框：正则校验，不合法时显示 errorText
- 密码输入框：可见性切换（suffixIcon 眼睛图标），最少 8 位校验
- 验证码输入框：6 位数字，长度校验
- 表单整体用 Form + GlobalKey<FormState>，validate() 通过才允许提交

## 安全规范（不可妥协）
- 所有用户输入必须经过校验后才可使用；禁止拼接任何 SQL/命令字符串
- 登录成功返回的 token 只能用 flutter_secure_storage 存储，禁止明文存储
- 网络请求必须走项目统一的 API 客户端封装；若项目没有，创建 lib/core/api_client.dart（Dio 封装，超时 15s）
- 密码明文只在内存中短暂存在，不写日志、不落盘

## 代码质量
- 空安全；能用 const 的构造一律 const
- Widget 嵌套超过 5 层必须拆子 Widget
- TextEditingController 必须在 dispose() 释放
- 文件顶部写明生成时间与所用 skill 名称

## 完成后动作（必须执行）
1. 用 flutter 工具执行 action=analyze
2. 若有 error/warning，修复后重新 analyze，最多 5 轮
3. analyze 零 error 后，输出变更文件清单与关键设计说明
