# Third-Party Notices

本产品前端（`desktop/src/v2/`）的组件体系部分移植自 [ZCode](https://github.com/zai-org/ZCode)（Apache License 2.0）：

- `src/v2/components/ui/*` — shadcn/radix-mira 风格基件（button / input / textarea / dialog / tabs / tooltip / separator / label / spinner / windowIcons），移植自 ZCode `packages/ui/src/components/ui`，按本项目需要做了适配（i18n 去除、import 路径、主题 token 对齐）。
- `src/v2/components/lib/utils.ts` — `cn()` 类名合并工具，移植自 ZCode `packages/ui/src/components/lib/utils`。
- `src/v2/styles/index.css` — 语义 token 体系（`@theme` + `.dark` 双主题）的结构与取值移植自 ZCode `packages/ui/src/styles.css`。
- `src/v2/app/WindowControls.tsx` — 内联窗口控制按钮，交互与样式对齐 ZCode `DesktopWindowControls`。

ZCode 原始版权与许可见其仓库 `LICENSE` 与 `NOTICE.md`（Apache License 2.0）。
