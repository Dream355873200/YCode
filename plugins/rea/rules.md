# REA 逆向工程工作规则

1. 首次使用先加载技能 `reverse-engineer-anything`（调查方法论与工具选择都在里面）；工具缺席或连接失败按技能里的「connection and recovery」排查，不要盲目重试。
2. 首次调用会经 npx 下载 rea-agents（约几百 MB，一次性）；Node 版本要求 ≥22.23.4（22.16 会警告但通常能跑，报引擎错误时先升 Node）。
3. Windows 能力边界：JS/Electron 应用、APK 签名、Flutter 包、IL2CPP、Go/Rust/PyInstaller/.NET/PE/ELF 静态分析、模型文件等内置能力直接可用；**原生二进制反编译需要 Ghidra（Windows 实验支持）或 IDA**，没装就明确告诉用户并只做静态部分；Android 反编译需要 JADX + JDK。
4. 只分析用户拥有或获授权的目标；证据（Evidence）要完整保留在结论里，不臆测。
5. 运行时类分析（浏览器观察、进程捕获）与内置浏览器/系统权限相关，动手前先向用户说明要做什么。
