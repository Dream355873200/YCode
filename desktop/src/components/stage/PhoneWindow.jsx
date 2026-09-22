// PhoneWindow.jsx — 浮动手机窗。
// 中栏要留给文件+代码，手机画面以悬浮小窗呈现：默认右下角、可拖动（标题栏
// 和最小化小球都可拖）、可最小化成小圆钮（小球单击展开、拖动换位）。
// DevicePanel 常驻挂载（最小化仅 display:none，投屏流不断）。
import React, { useRef, useState } from 'react';
import { DevicePanel } from './StagePanel.jsx';

export default function PhoneWindow() {
  // pos=null 用 CSS 默认停靠（右下角）；拖动后存 {left, top}
  const [pos, setPos] = useState(null);
  const [mini, setMini] = useState(false);
  const rootRef = useRef(null);
  const miniRef = useRef(null);

  const clamp = (x, y) => ({
    left: Math.min(Math.max(0, x), window.innerWidth - 56),
    top: Math.min(Math.max(0, y), window.innerHeight - 56),
  });

  // 通用拖动：setPointerCapture 把后续 pointermove/up 全部路由到该元素，
  // 不依赖 window 冒泡——选中文字/原生拖拽不会中断事件流。
  // onUp(dist) 回调区分「点击」(<4px) 与「拖动」。
  const startDrag = (e, el, onUp) => {
    if (e.target.closest('button, select, input')) return;
    const rect = el.getBoundingClientRect();
    const off = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const start = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* 捕获失败退化为元素内拖动 */ }
    const move = (ev) => setPos(clamp(ev.clientX - off.x, ev.clientY - off.y));
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (onUp) onUp(Math.hypot(ev.clientX - start.x, ev.clientY - start.y));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  // 标题栏拖动（窗体）
  const onDragStart = (e) => {
    if (rootRef.current) startDrag(e, rootRef.current);
  };

  // 小球拖动（位移 <4px 视为点击 → 展开）
  const onMiniDrag = (e) => {
    if (miniRef.current) startDrag(e, miniRef.current, (dist) => { if (dist < 4) setMini(false); });
  };

  // 小球位置跟随窗体位置（未拖过则默认右下角坐标）
  const miniStyle = pos
    ? { left: pos.left, top: pos.top }
    : { right: 20, bottom: 20 };

  return (
    <>
      {/* 窗体：最小化时隐藏但保持挂载（投屏流不断） */}
      <div ref={rootRef} className="phone-win" style={mini ? { display: 'none' } : (pos || { right: 20, bottom: 20 })}>
        <div className="pw-head" onPointerDown={onDragStart}>
          <span className="pw-title">📱 设备预览</span>
          <span className="pw-drag">⠿ 拖动</span>
          <button className="pw-btn" title="最小化" onClick={() => setMini(true)}>—</button>
        </div>
        <div className="pw-body">
          <DevicePanel />
        </div>
      </div>
      {mini && (
        <div ref={miniRef} className="phone-mini" style={miniStyle}
          title="拖动换位置 · 单击展开设备预览"
          onPointerDown={onMiniDrag}>
          📱
        </div>
      )}
    </>
  );
}
