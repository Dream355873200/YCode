// 渲染层入口：侧栏（项目 → 对话 / 团队）+ 对话帧 + 右栏面板。
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
