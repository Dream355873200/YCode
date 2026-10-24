#!/usr/bin/env node
// REA MCP 启动 shim：官方 npm 包 rea-agents 的 stdio 透传。
// 为什么有这个文件：Windows 的 npx 是 .cmd 脚本，引擎的 MCP 客户端没法直接
// 拉起；node 里 spawn(shell) 再双向转发 stdio 即可。REA 本体零改动、零重写。
"use strict";
const { spawn } = require("child_process");

const VERSION = process.env.REA_VERSION || "6.7.0"; // 锁版本：可复现，升级改这里或设环境变量
const child = spawn("npx", ["-y", `rea-agents@${VERSION}`, "mcp"], {
  shell: process.platform === "win32",
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
const forward = (signal) => {
  try { child.kill(signal); } catch { /* 已退出 */ }
  setTimeout(() => process.exit(0), 3000);
};
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
