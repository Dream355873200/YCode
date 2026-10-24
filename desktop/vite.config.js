import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// renderer 构建到 dist/，Electron 以 file:// 加载（base './' 保证资源相对路径）。
export default defineConfig({
  root: 'src',
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
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
