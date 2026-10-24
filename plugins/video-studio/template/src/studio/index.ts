// 视频工坊组件库公共入口：场景文件统一 `import { ... } from "../studio";`
// （src/lib/ 下的自定义组件同样从 "../studio" 导入）。

export * from "./kit/motion";
export * from "./kit/layout";
export * from "./kit/background";
export * from "./kit/text";
export * from "./kit/surfaces";
export * from "./kit/charts";
export * from "./kit/media";
export * from "./kit/overlays";
export * from "./kit/audio";
export * from "./kit/transitions";
export * from "./kit/three";
export { THEME_PRESETS, FONT_FAMILY, useTheme, alpha, mixColor, fontFamily, resolveTheme, ThemeProvider } from "./theme";
export type { Theme, Palette, ThemeFonts, FontName, ThemeInput } from "./theme";
export type { SceneProps } from "./props";
export type { Manifest, ManifestScene, TransitionType } from "./manifest";
