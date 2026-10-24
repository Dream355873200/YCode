import React, { createContext, useContext } from "react";

// 主题系统：整片视觉的单一真相源。manifest.theme 选预设（字符串）或「预设 + 覆盖」对象；
// kit 组件全部从 useTheme() 取色板/字体/圆角，场景代码不必层层传 palette。

export type FontName =
  | "Noto Sans SC"
  | "Noto Serif SC"
  | "ZCOOL QingKe HuangYou"
  | "ZCOOL KuaiLe"
  | "Ma Shan Zheng"
  | "Inter"
  | "Montserrat"
  | "Playfair Display"
  | "Space Grotesk"
  | "JetBrains Mono";

export interface Palette {
  /** 画面底色 */
  background: string;
  /** 卡片/面板底色 */
  surface: string;
  /** 品牌主色（标题强调、按钮、图表主系列） */
  primary: string;
  /** 辅色（第二系列、渐变另一端） */
  secondary: string;
  /** 点缀色（高亮、关键数字，少量使用） */
  accent: string;
  /** 正文色 */
  text: string;
  /** 次要文字色 */
  muted: string;
  /** 描边/分隔线 */
  border: string;
  [key: string]: string;
}

export interface ThemeFonts {
  heading: FontName;
  body: FontName;
  mono: FontName;
  /** 标题字重（静态 CJK 展示字体只有 400，预设已按字体设好） */
  headingWeight: number;
  bodyWeight: number;
}

export interface Theme {
  name: string;
  mode: "dark" | "light";
  palette: Palette;
  fonts: ThemeFonts;
  /** 卡片圆角（1080p 基准像素，kit 按画面尺寸换算） */
  radius: number;
}

export type ThemeInput =
  | string
  | {
      preset?: string;
      mode?: "dark" | "light";
      palette?: Partial<Palette>;
      fonts?: Partial<ThemeFonts>;
      radius?: number;
    };

/** 字体名 → CSS font-family 栈（CJK 统一回落 Noto Sans SC，保证中文字形一致） */
export const FONT_FAMILY: Record<FontName, string> = {
  "Noto Sans SC": `"Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei", sans-serif`,
  "Noto Serif SC": `"Noto Serif SC Variable", "Noto Sans SC Variable", "Songti SC", serif`,
  "ZCOOL QingKe HuangYou": `"ZCOOL QingKe HuangYou", "Noto Sans SC Variable", sans-serif`,
  "ZCOOL KuaiLe": `"ZCOOL KuaiLe", "Noto Sans SC Variable", sans-serif`,
  "Ma Shan Zheng": `"Ma Shan Zheng", "Noto Serif SC Variable", serif`,
  Inter: `"Inter Variable", "Noto Sans SC Variable", sans-serif`,
  Montserrat: `"Montserrat Variable", "Noto Sans SC Variable", sans-serif`,
  "Playfair Display": `"Playfair Display Variable", "Noto Serif SC Variable", serif`,
  "Space Grotesk": `"Space Grotesk Variable", "Noto Sans SC Variable", sans-serif`,
  "JetBrains Mono": `"JetBrains Mono Variable", "Noto Sans SC Variable", monospace`,
};

/** 只有 400 字重的静态展示字体（加粗会被浏览器伪粗，难看） */
export const SINGLE_WEIGHT_FONTS: FontName[] = ["ZCOOL QingKe HuangYou", "ZCOOL KuaiLe", "Ma Shan Zheng"];

const font = (heading: FontName, body: FontName = "Noto Sans SC", headingWeight = 800): ThemeFonts => ({
  heading,
  body,
  mono: "JetBrains Mono",
  headingWeight: SINGLE_WEIGHT_FONTS.includes(heading) ? 400 : headingWeight,
  bodyWeight: 400,
});

export const THEME_PRESETS: Record<string, Theme> = {
  midnight: {
    name: "midnight",
    mode: "dark",
    palette: {
      background: "#0B0D17", surface: "#151A2E", primary: "#7C5CFF", secondary: "#22D3EE",
      accent: "#F472B6", text: "#F5F7FF", muted: "#9AA3C7", border: "rgba(255,255,255,0.12)",
    },
    fonts: font("Noto Sans SC"),
    radius: 28,
  },
  aurora: {
    name: "aurora",
    mode: "dark",
    palette: {
      background: "#050816", surface: "#0F1530", primary: "#5EEAD4", secondary: "#818CF8",
      accent: "#F0ABFC", text: "#F8FAFC", muted: "#94A3B8", border: "rgba(255,255,255,0.12)",
    },
    fonts: font("Space Grotesk", "Noto Sans SC", 700),
    radius: 32,
  },
  sunrise: {
    name: "sunrise",
    mode: "dark",
    palette: {
      background: "#1A0F0A", surface: "#2A1810", primary: "#FF8A3D", secondary: "#FFD166",
      accent: "#FF5D73", text: "#FFF7ED", muted: "#D6B8A0", border: "rgba(255,237,213,0.16)",
    },
    fonts: font("Montserrat", "Noto Sans SC", 800),
    radius: 28,
  },
  neon: {
    name: "neon",
    mode: "dark",
    palette: {
      background: "#07070C", surface: "#12121C", primary: "#00F0FF", secondary: "#FF2BD6",
      accent: "#F9F871", text: "#FFFFFF", muted: "#8C8CA8", border: "rgba(0,240,255,0.25)",
    },
    fonts: font("Space Grotesk", "Noto Sans SC", 700),
    radius: 18,
  },
  forest: {
    name: "forest",
    mode: "dark",
    palette: {
      background: "#0E1A14", surface: "#16261D", primary: "#4ADE80", secondary: "#A3E635",
      accent: "#FBBF24", text: "#F0FDF4", muted: "#9CB8A6", border: "rgba(240,253,244,0.14)",
    },
    fonts: font("Noto Sans SC"),
    radius: 26,
  },
  mono: {
    name: "mono",
    mode: "dark",
    palette: {
      background: "#0A0A0A", surface: "#161616", primary: "#FFFFFF", secondary: "#A3A3A3",
      accent: "#F43F5E", text: "#FAFAFA", muted: "#8A8A8A", border: "rgba(255,255,255,0.14)",
    },
    fonts: font("Inter", "Noto Sans SC", 800),
    radius: 12,
  },
  cinema: {
    name: "cinema",
    mode: "dark",
    palette: {
      background: "#0A0908", surface: "#1A1714", primary: "#D4AF37", secondary: "#E8D5B5",
      accent: "#B22222", text: "#F5EFE6", muted: "#A39A8C", border: "rgba(212,175,55,0.25)",
    },
    fonts: font("Noto Serif SC", "Noto Serif SC", 700),
    radius: 4,
  },
  ink: {
    name: "ink",
    mode: "light",
    palette: {
      background: "#F3EEE3", surface: "#FBF8F1", primary: "#1C1C1C", secondary: "#9E2B25",
      accent: "#C8A45C", text: "#1C1C1C", muted: "#6E665A", border: "rgba(28,28,28,0.14)",
    },
    fonts: font("Ma Shan Zheng", "Noto Serif SC"),
    radius: 6,
  },
  paper: {
    name: "paper",
    mode: "light",
    palette: {
      background: "#F6F3EE", surface: "#FFFFFF", primary: "#1F3A5F", secondary: "#C8553D",
      accent: "#E9A23B", text: "#1B1B1B", muted: "#6B6B6B", border: "rgba(27,27,27,0.12)",
    },
    fonts: font("Noto Serif SC", "Noto Sans SC", 700),
    radius: 18,
  },
  corporate: {
    name: "corporate",
    mode: "light",
    palette: {
      background: "#F4F7FB", surface: "#FFFFFF", primary: "#2563EB", secondary: "#0EA5E9",
      accent: "#F59E0B", text: "#0F172A", muted: "#64748B", border: "rgba(15,23,42,0.10)",
    },
    fonts: font("Inter", "Noto Sans SC", 800),
    radius: 22,
  },
  candy: {
    name: "candy",
    mode: "light",
    palette: {
      background: "#FFF5FA", surface: "#FFFFFF", primary: "#FF4F9A", secondary: "#7C5CFF",
      accent: "#FFC93C", text: "#2B1B3D", muted: "#7A6A8A", border: "rgba(43,27,61,0.10)",
    },
    fonts: font("ZCOOL KuaiLe", "Noto Sans SC"),
    radius: 36,
  },
};

export const DEFAULT_THEME = THEME_PRESETS.midnight;

const isFontName = (v: unknown): v is FontName => typeof v === "string" && v in FONT_FAMILY;

/** 解析 manifest.theme（字符串预设 / 对象覆盖）；v1 的顶层 palette 作为覆盖层兼容 */
export const resolveTheme = (input?: ThemeInput, legacyPalette?: Record<string, string>): Theme => {
  const presetName = typeof input === "string" ? input : input?.preset;
  const base = (presetName && THEME_PRESETS[presetName]) || DEFAULT_THEME;
  const over = typeof input === "object" && input ? input : {};
  const fontsIn = over.fonts ?? {};
  const heading = isFontName(fontsIn.heading) ? fontsIn.heading : base.fonts.heading;
  const body = isFontName(fontsIn.body) ? fontsIn.body : base.fonts.body;
  const headingWeight = SINGLE_WEIGHT_FONTS.includes(heading)
    ? 400
    : fontsIn.headingWeight ?? (heading === base.fonts.heading ? base.fonts.headingWeight : 800);
  return {
    name: base.name,
    mode: over.mode ?? base.mode,
    palette: { ...base.palette, ...(legacyPalette ?? {}), ...(over.palette ?? {}) } as Palette,
    fonts: {
      heading,
      body,
      mono: isFontName(fontsIn.mono) ? fontsIn.mono : base.fonts.mono,
      headingWeight,
      bodyWeight: SINGLE_WEIGHT_FONTS.includes(body) ? 400 : fontsIn.bodyWeight ?? base.fonts.bodyWeight,
    },
    radius: over.radius ?? base.radius,
  };
};

const ThemeContext = createContext<Theme>(DEFAULT_THEME);

export const ThemeProvider: React.FC<{ theme: Theme; children: React.ReactNode }> = ({ theme, children }) => (
  <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
);

/** 当前主题（色板/字体/圆角） */
export const useTheme = (): Theme => useContext(ThemeContext);

/** 字体名 → CSS font-family */
export const fontFamily = (name: FontName): string => FONT_FAMILY[name] ?? FONT_FAMILY["Noto Sans SC"];

/** 颜色加透明度：hex(#RRGGBB) → rgba；非 hex 原样返回 */
export const alpha = (color: string, opacity: number): string => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, opacity))})`;
};

/** 两色线性混合（hex），t=0 取 a，t=1 取 b */
export const mixColor = (a: string, b: string, t: number): string => {
  const parse = (c: string) => {
    let h = c.replace("#", "");
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  if (!/^#/.test(a) || !/^#/.test(b)) return t < 0.5 ? a : b;
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const k = Math.max(0, Math.min(1, t));
  const to = (x: number) => Math.round(x).toString(16).padStart(2, "0");
  return `#${to(r1 + (r2 - r1) * k)}${to(g1 + (g2 - g1) * k)}${to(b1 + (b2 - b1) * k)}`;
};
