import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// renderer 构建到 dist/，Electron 以 file:// 加载（base './' 保证资源相对路径）。
// 双入口：index.html = legacy UI，v2/index.html = v2 UI（Electron 按 config.uiVersion 加载其一）。
export default defineConfig({
  root: 'src',
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: 'src/index.html',
        v2: 'src/v2/index.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    // root = src（vite 构建 root），include 相对 root 解析
    include: ['v2/**/*.test.ts'],
  },
});
