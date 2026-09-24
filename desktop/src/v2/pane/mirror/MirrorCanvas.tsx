// Web 原生投屏（自 legacy MirrorCanvas 移植）：主线程只做调度，视频字节
// 处理全在 mirrorWorker（专职线程）。主进程建 video+control 双 TCP 通道并
// 攒批推 IPC 流 → 此处 transfer 进 worker（零拷贝）→ worker 解析+解码，画
// 到移交出去的 OffscreenCanvas。触控注入走 control 通道（坐标必须换算到
// 视频流坐标系——server 的 PositionMapper 严格校验消息尺寸等于视频尺寸）。
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ArrowLeftIcon, HomeIcon, PowerIcon, RotateCwIcon, SquareIcon,
  Volume1Icon, Volume2Icon,
} from 'lucide-react';

// StrictMode 双挂载防护：dev 下 effect 挂载→卸载→再挂载，首卸的 cleanup 若
// 立即 stopMirror 会把 server 杀在第二次连接建立之前（表现为投屏必失败、
// 只有插拔碰运气才能成功）。停止去抖：真卸载才停，300ms 内同设备重挂载撤销。
const pendingStops = new Map<string, ReturnType<typeof setTimeout>>();

export default function MirrorCanvas({ deviceId }: { deviceId: string }) {
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    const st = stateRef.current = { w: 0, h: 0 };
    // 撤销挂起的停止（StrictMode 重挂载 / 快速重开）
    const pending = pendingStops.get(deviceId);
    if (pending) { clearTimeout(pending); pendingStops.delete(deviceId); }

    const worker = new Worker(new URL('./mirrorWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; w?: number; h?: number; data?: Uint8Array; args?: unknown[] };
      if (!alive) return;
      if (m.type === 'size' && m.w && m.h) {
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
        }
      } else if (m.type === 'control' && m.data) {
        (window.amc.devices as unknown as { writeMirror(id: string, data: Uint8Array): void })
          .writeMirror(deviceId, m.data);
      } else if (m.type === 'log') {
        console.log(...(m.args || []));
      }
    };

    const onData = (id: string, chunk: Uint8Array | ArrayBuffer) => {
      if (!alive || id !== deviceId) return;
      // IPC clone 产物无共享者：buffer 直接 transfer 进 worker（零拷贝）
      const u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      worker.postMessage({ type: 'data', buf: u8 }, [u8.buffer]);
    };
    const onClosed = (_id: string) => { /* socket 断开：UI 由 scrcpy:exited 处理 */ };
    const offData = (window.amc.devices as unknown as {
      onMirrorData(cb: (id: string, chunk: Uint8Array | ArrayBuffer) => void): () => void;
    }).onMirrorData(onData);
    const offClosed = (window.amc.devices as unknown as {
      onMirrorClosed(cb: (id: string) => void): () => void;
    }).onMirrorClosed(onClosed);

    // 请求主进程建通道（video+control 双连接 + dummy 握手在主进程完成）
    (window.amc.devices as unknown as { connectMirror(id: string): Promise<void> })
      .connectMirror(deviceId).catch((e: unknown) => console.error('[mirror] connect 失败:', e));

    return () => {
      alive = false;
      worker.terminate();
      offData(); offClosed();
      pendingStops.set(deviceId, setTimeout(() => {
        pendingStops.delete(deviceId);
        (window.amc.devices as unknown as { stopMirror(id: string): Promise<void> })
          .stopMirror(deviceId).catch(() => {});
      }, 300));
    };
  }, [deviceId]);

  // ---- 输入注入（scrcpy 控制消息，走 control 通道）----
  // 坐标系：server 的 PositionMapper 严格校验消息里的 screenWidth/Height
  // 等于视频流尺寸（st.w/st.h），且须扣除 objectFit: contain 的黑边偏移。
  // pointerId 用 -2（GENERIC_FINGER，真触摸语义）——-1 是鼠标，个别应用
  //（如部分游戏/绘图）对 mouse 与 touch 的响应不同。
  const toVideoXY = (e: { clientX: number; clientY: number }) => {
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

  const inject = (action: 'down' | 'move' | 'up', e: { clientX: number; clientY: number }) => {
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
    (window.amc.devices as unknown as { writeMirror(id: string, data: Uint8Array): void })
      .writeMirror(deviceId, msg);
  };

  // 滚轮：TYPE_INJECT_SCROLL_EVENT（21B）。i16 定点范围 [-1,1] 对应实际滚动
  // [-16,16]（server 端 ×16 还原），一格滚轮 ≈ 1/16。末尾 buttons(4B) 是
  // scrcpy 2.x+ 增补字段（legacy 20B 版会劣化协议流，必须带上）。
  const injectScroll = (e: { clientX: number; clientY: number; deltaY: number }) => {
    const pos = toVideoXY(e);
    if (!pos) return;
    const st = stateRef.current;
    const unit = 0x0800; // i16 定点：1/16 滚动量的近似编码
    const msg = new Uint8Array(21);
    const dv = new DataView(msg.buffer);
    dv.setUint8(0, 3);                 // TYPE_INJECT_SCROLL_EVENT
    dv.setUint32(1, pos.x, false);
    dv.setUint32(5, pos.y, false);
    dv.setUint16(9, st.w, false);
    dv.setUint16(11, st.h, false);
    dv.setInt16(13, 0, false);         // hScroll（横向暂不映射）
    dv.setInt16(15, e.deltaY < 0 ? unit : -unit, false); // vScroll（向下滚 = 负）
    dv.setUint32(17, 0, false);        // buttons
    write(msg);
  };

  // BACK 键：TYPE_BACK_OR_SCREEN_ON，action=0（短按返回）
  const injectBack = () => {
    const msg = new Uint8Array(2);
    msg[0] = 4; msg[1] = 0;
    (window.amc.devices as unknown as { writeMirror(id: string, data: Uint8Array): void })
      .writeMirror(deviceId, msg);
  };

  // ---- 设备控制条（Android Studio 式）----
  const write = (data: Uint8Array) => {
    (window.amc.devices as unknown as { writeMirror(id: string, data: Uint8Array): void })
      .writeMirror(deviceId, data);
  };
  // 系统键注入（TYPE_INJECT_KEYCODE，14B，down+up 成对）。scrcpy 4.1 reader
  // 的字段序：action(1) keycode(4) repeat(4) metaState(4)，全部大端。
  // KEYCODE：HOME=3、VOLUME_UP=24、VOLUME_DOWN=25、POWER=26、APP_SWITCH=187。
  const injectKey = (keycode: number) => {
    const msg = new Uint8Array(14);
    const dv = new DataView(msg.buffer);
    dv.setUint8(0, 0);            // TYPE_INJECT_KEYCODE
    dv.setUint8(1, 0);            // action: down
    dv.setUint32(2, keycode, false);
    dv.setUint32(6, 0, false);    // repeat
    dv.setUint32(10, 0, false);   // metaState
    write(msg);
    dv.setUint8(1, 1);            // action: up
    write(msg);
  };
  // 旋转屏幕（TYPE_ROTATE_DEVICE，仅 1B 类型头）
  const injectRotate = () => write(new Uint8Array([11]));

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-center gap-0.5 border-b border-white/10 px-1 py-0.5">
        <CtrlBtn title="返回" onClick={injectBack}><ArrowLeftIcon className="size-3.5" /></CtrlBtn>
        <CtrlBtn title="主页" onClick={() => injectKey(3)}><HomeIcon className="size-3.5" /></CtrlBtn>
        <CtrlBtn title="最近任务" onClick={() => injectKey(187)}><SquareIcon className="size-3.5" /></CtrlBtn>
        <span className="mx-1 h-4 w-px bg-white/10" />
        <CtrlBtn title="音量+" onClick={() => injectKey(24)}><Volume2Icon className="size-3.5" /></CtrlBtn>
        <CtrlBtn title="音量−" onClick={() => injectKey(25)}><Volume1Icon className="size-3.5" /></CtrlBtn>
        <CtrlBtn title="电源键" onClick={() => injectKey(26)}><PowerIcon className="size-3.5" /></CtrlBtn>
        <CtrlBtn title="旋转屏幕" onClick={injectRotate}><RotateCwIcon className="size-3.5" /></CtrlBtn>
      </div>
      <div
        className="min-h-0 flex-1 cursor-crosshair"
        ref={canvasHostRef}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); inject('down', e); }}
        onPointerMove={(e) => { if (e.buttons) inject('move', e); }}
        onPointerUp={(e) => inject('up', e)}
        onWheel={(e) => { e.preventDefault(); injectScroll(e); }}
        onContextMenu={(e) => { e.preventDefault(); injectBack(); }}
      />
    </div>
  );
}

/** 控制条图标钮（容器是黑底投屏框，图标用白色系）。 */
function CtrlBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}
