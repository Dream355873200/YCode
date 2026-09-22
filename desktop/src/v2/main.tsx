// src/v2 — 前端 v2 入口（对齐 ZCode 的三帧工作区：侧栏 + 会话帧 + Side Pane）。
// P0 骨架阶段：最小可加载壳；P1 起长出对话主轴。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
