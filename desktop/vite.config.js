import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// renderer 构建到 dist/，Electron 以 file:// 加载（base './' 保证资源相对路径）
export default defineConfig({
  root: 'src',
  plugins: [react()],
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
