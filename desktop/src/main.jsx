import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/app.css';
// 语法高亮 token 配色在 app.css 里自定义（.hljs-* 令牌按深浅主题各配，
// 与产品令牌系统协调；不引 hljs 官方主题 —— 两个主题的选择器会互相覆盖）

createRoot(document.getElementById('root')).render(<App />);
