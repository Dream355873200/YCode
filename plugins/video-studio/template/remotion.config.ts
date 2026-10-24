// Remotion CLI 配置：渲染/预览浏览器用系统 Chrome/Edge（检测到即用）。
// Remotion 默认下载的 chrome-headless-shell 的 WebGL 走 SwiftShader 纯软件
// 渲染，三维场景（three.js/ThreeStage）会慢数倍；系统浏览器无头模式走显卡
// 硬件加速（Windows 上是 ANGLE/D3D11）。本文件被 remotion CLI 自动加载，
// 对 studio / render / still 全部生效。
import fs from "node:fs";
import { Config } from "@remotion/cli/config";

const candidates = [
  process.env.REMOTION_BROWSER_EXECUTABLE,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : "",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean) as string[];

for (const c of candidates) {
  try {
    fs.accessSync(c);
    Config.setBrowserExecutable(c);
    break;
  } catch {
    // 下一个候选
  }
}
