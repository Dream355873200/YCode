// Web 原生投屏：主线程只做调度，视频字节处理全在 mirrorWorker（专职线程）。
// 主进程建 video+control 双 TCP 通道并攒批推 IPC 流 → 此处 transfer 进 worker
// （零拷贝）→ worker 解析+解码，画到主进程移交来的 OffscreenCanvas
// （transferControlToOffscreen：worker 持控制权，DOM canvas 负责显示）。
// 触控注入走 control 通道（坐标必须换算到视频流坐标系——server 的
// PositionMapper 严格校验消息尺寸等于视频尺寸）。
import { useEffect, useRef } from 'react';

export default function MirrorCanvas({ deviceId }) {
  const canvasHostRef = useRef(null);
  const stateRef = useRef({});

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    const st = stateRef.current = { w: 0, h: 0 };

    const worker = new Worker(new URL('./mirrorWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      if (!alive) return;
      if (m.type === 'size') {
        st.w = m.w; st.h = m.h;
        // worker 请求画布（首次/尺寸变化）：建新 canvas 并把控制权移交 worker。
        // 旧画布由 GC 回收（控制权已不在主线程，无法复用）。
        const host = canvasHostRef.current;
        if (host) {
          const c = document.createElement('canvas');
          c.width = m.w; c.height = m.h;
          c.style.width = '100%';
          c.style.height = '100%';
          c.style.objectFit = 'contain';
          c.style.display = 'block';
          host.innerHTML = '';
          host.appendChild(c);
          const off = c.transferControlToOffscreen();
          worker.postMessage({ type: 'canvas', canvas: off }, [off]);
          console.log(`[mirror] 画布已移交 worker: ${m.w}x${m.h}`);
        }
      } else if (m.type === 'control') {
        window.amc.devices.writeMirror(deviceId, m.data);
      } else if (m.type === 'log') {
        console.log(...m.args);
      }
    };

    const onData = (_id, chunk) => {
      if (!alive || _id !== deviceId) return;
      // IPC clone 产物无共享者：buffer 直接 transfer 进 worker（零拷贝）
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      worker.postMessage({ type: 'data', buf: u8 }, [u8.buffer]);
    };
    const onClosed = (_id) => { /* socket 断开：UI 由 scrcpy:exited 处理 */ };
    const offData = window.amc.devices.onMirrorData(onData);
    const offClosed = window.amc.devices.onMirrorClosed(onClosed);

    // 请求主进程建通道（video+control 双连接 + dummy 握手在主进程完成）
    window.amc.devices.connectMirror(deviceId).catch((e) => console.error('[mirror] connect 失败:', e));

    return () => {
      alive = false;
      worker.terminate();
      offData(); offClosed();
      window.amc.devices.stopMirror(deviceId).catch(() => {});
    };
  }, [deviceId]);

  // ---- 输入注入（scrcpy 控制消息，走 control 通道）----
  // 坐标系：server 的 PositionMapper 严格校验消息里的 screenWidth/Height
  // 等于视频流尺寸（st.w/st.h），且须扣除 objectFit: contain 的黑边偏移。
  // pointerId 用 -2（GENERIC_FINGER，真触摸语义）——-1 是鼠标，个别应用
  //（如部分游戏/绘图）对 mouse 与 touch 的响应不同（server Controller.java）。
  const toVideoXY = (e) => {
    const st = stateRef.current;
    const host = canvasHostRef.current;
    if (!host || !st.w) return null;
    const rect = host.getBoundingClientRect();
    const scale = Math.min(rect.width / st.w, rect.height / st.h);
    const dw = st.w * scale, dh = st.h * scale;
    const ox = (rect.width - dw) / 2, oy = (rect.height - dh) / 2;
    return {
      x: Math.max(0, Math.min(st.w - 1, Math.round(((e.clientX - rect.left - ox) / dw) * st.w))),
      y: Math.max(0, Math.min(st.h - 1, Math.round(((e.clientY - rect.top - oy) / dh) * st.h))),
    };
  };

  const inject = (action, e) => {
    const pos = toVideoXY(e);
    if (!pos) return;
    const st = stateRef.current;
    const pressure = action === 'up' ? 0 : 0xffff; // u16 定点（0xffff = 1.0）
    const msg = new Uint8Array(32);
    const dv = new DataView(msg.buffer);
    dv.setUint8(0, 2);                 // TYPE_INJECT_TOUCH_EVENT
    dv.setUint8(1, action === 'down' ? 0 : action === 'up' ? 1 : 2);
    dv.setBigUint64(2, 0xFFFFFFFFFFFFFFFEn, true); // pointerId = -2（GENERIC_FINGER）
    dv.setUint32(10, pos.x, false);
    dv.setUint32(14, pos.y, false);
    dv.setUint16(18, st.w, false);     // 视频流尺寸（必须与 session meta 一致）
    dv.setUint16(20, st.h, false);
    dv.setUint16(22, pressure, false);
    dv.setUint32(24, 1, false);        // actionButton = PRIMARY
    dv.setInt32(28, action === 'up' ? 0 : 1, false); // buttons
    window.amc.devices.writeMirror(deviceId, msg);
  };

  // 滚轮：TYPE_INJECT_SCROLL_EVENT（position 12B + hScroll/vScroll i16 定点 + buttons i32）。
  // i16 定点范围 [-1,1] 对应实际滚动 [-16,16]（server 端 ×16 还原），一格滚轮 ≈ 1/16。
  const injectScroll = (e) => {
    const pos = toVideoXY(e);
    if (!pos) return;
    const st = stateRef.current;
    const unit = 0x0800; // i16 定点：1/16 滚动量的近似编码
    const msg = new Uint8Array(20);
    const dv = new DataView(msg.buffer);
    dv.setUint8(0, 3);                 // TYPE_INJECT_SCROLL_EVENT
    dv.setUint32(1, pos.x, false);
    dv.setUint32(5, pos.y, false);
    dv.setUint16(9, st.w, false);
    dv.setUint16(11, st.h, false);
    dv.setInt16(13, 0, false);         // hScroll（横向暂不映射）
    dv.setInt16(15, e.deltaY < 0 ? unit : -unit, false); // vScroll（向下滚 = 负）
    dv.setInt32(17, 0, false);         // buttons
    window.amc.devices.writeMirror(deviceId, msg);
  };

  // BACK 键：TYPE_BACK_OR_SCREEN_ON，action=0（短按返回；source Controller.java）
  const injectBack = () => {
    const msg = new Uint8Array(2);
    msg[0] = 4; msg[1] = 0;            // TYPE_BACK_OR_SCREEN_ON + ACTION_BACK
    window.amc.devices.writeMirror(deviceId, msg);
  };

  return (
    <div
      className="mirror-live"
      ref={canvasHostRef}
      onPointerDown={(e) => { e.target.setPointerCapture(e.pointerId); inject('down', e); }}
      onPointerMove={(e) => { if (e.buttons) inject('move', e); }}
      onPointerUp={(e) => inject('up', e)}
      onWheel={(e) => { e.preventDefault(); injectScroll(e); }}
      onContextMenu={(e) => { e.preventDefault(); injectBack(); }}
    />
  );
}
