import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/AppState.jsx';
import { useChat } from '../../lib/useChat.js';
import { TurnView, ApproveBarView, ConfirmCard, AskCard } from './TurnView.jsx';
import { actVerbPlain } from '../../lib/toolRender.jsx';

export default function ChatPanel({ chatApi, onAct }) {
  const { project, sessionId, setSessionId, setUsage, engine } = useApp();
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const onActRef = useRef(onAct);
  onActRef.current = onAct;
  const { items, busy, send, approve, restore, resumeState, interrupt, answerAsk } = useChat({
    sessionIdRef,
    sessionId,
    onUsage: (u) => setUsage((x) => ({ input: x.input + u.input_tokens, output: x.output + u.output_tokens })),
    onAct: (a) => onActRef.current && onActRef.current(a),
  });
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [text, setText] = useState('');
  const [mode, setMode] = useState('plan');
  const bodyRef = useRef(null);

  // 会话 ID 由 AppState.openProject 按项目派生（amc-<目录名>-<路径哈希>），此处只消费。

  // 换项目/换会话/引擎就绪时恢复历史。直播状态在模块级 store（不随组件
  // 卸载丢失）：退出项目再进来，进行中的 run 直播直接续上；只有应用整个
  // 重启过（SSE 断了、引擎任务还在后台跑）才走轮询跟踪兜底。
  useEffect(() => {
    if (!busyRef.current) restore(sessionId);
  }, [sessionId, engine.status, restore]);

  // 暴露给外层（工作台：新建项目后预填想法到输入框）
  useEffect(() => { if (chatApi) chatApi({ send, busy, prefill: (t) => setText(t || '') }); }, [chatApi, send, busy]);

  // 自动滚底（跟随流式输出）
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const doSend = () => {
    if (!text.trim() || busy) return;
    send(text);
    setText('');
  };  const lastAct = (() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'turn' && it.steps.length) {
        const a = [...it.steps].reverse().find((s) => s.kind === 'act' && s.cls === 'run');
        // 状态行用人话（剥 emoji 与「了」尾：「正在 ✏️ 修改了 …」→「正在 修改 …」）
        if (a) {
          const verb = actVerbPlain(a.verb);
          return `正在${verb ? ' ' + verb : ''} ${a.obj || ''}…`;
        }
      }
    }
    return busy ? '思考中…' : '空闲';
  })();

  return (
    <div className="card" style={{ padding: 0, height: '100%' }}>
      <div className="pane-head">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 3.5h12M2 8h8M2 12.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
        AI 对话
        <span className="tag info" style={{ marginLeft: 'auto' }}>随时可插话</span>
      </div>
      <div className="tab-body">
        <div className="chat-body" ref={bodyRef}>
          {resumeState === 'running' && !busy && (
            <div className="ai-status" style={{ borderRadius: 0 }}>
              <span className="as-dot" />
              <span className="as-text">任务后台执行中 — 下方历史每 3 秒自动刷新，可实时看到最新步骤</span>
              <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => interrupt()}>⏹ 终止</button>
            </div>
          )}
          {items.length === 0 && (
            <div style={{ color: 'var(--faint)', fontSize: 12, textAlign: 'center', marginTop: 40, lineHeight: 2 }}>
              {project ? `和 AI 聊聊「${project.name}」——` : ''}<br />
              描述你的想法，AI 会先向你提问敲定 SPEC，确认后开始开发。
            </div>
          )}
          {items.map((it) => {
            if (it.type === 'user') return <div key={it.id} className="msg user"><div className="bubble">{it.text}</div></div>;
            if (it.type === 'turn') return <TurnView key={it.id} turn={it} onAnswer={answerAsk} />;
            if (it.type === 'approve') return <ApproveBarView key={it.id} item={it} onApprove={approve} />;
            if (it.type === 'confirm') return <ConfirmCard key={it.id} item={it} onAnswer={answerAsk} />;
            if (it.type === 'ask') return <AskCard key={it.id} item={it} onAnswer={answerAsk} />;
            if (it.type === 'status') {
              return (
                <div key={it.id} className="retry-status">
                  <span className="rs-spinner" />
                  <span className="rs-text">{it.text}</span>
                </div>
              );
            }
            return <div key={it.id} style={{ fontSize: 10.5, color: 'var(--faint)', textAlign: 'center' }}>{it.text}</div>;
          })}
        </div>
        <div className="ai-status">
          <span className="as-dot" style={{ display: busy ? '' : 'none' }} />
          <span className="as-text">{busy ? lastAct : '空闲 — 等待你的指令'}</span>
          <span className="as-hint" style={{ display: busy ? '' : 'none' }}>{lastAct === '思考中…' ? '正在推理，通常 10-60 秒' : '随时插话'}</span>
        </div>
        <div className="chat-input">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <div className="mode-switch">
                <button className={'mode-btn' + (mode === 'plan' ? ' active' : '')} onClick={() => setMode('plan')}><span className="kbd">Tab</span>plan 模式</button>
                <button className={'mode-btn' + (mode === 'auto' ? ' active' : '')} onClick={() => setMode('auto')}><span className="kbd">Tab</span>auto 模式</button>
              </div>
              <span style={{ fontSize: 10, color: 'var(--faint)' }}>安全敏感操作始终需要批准</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea placeholder="提问 / 改需求 / 指挥 AI —— 任何时候都可以…"
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } }} />
              {busy
                ? <button className="btn primary" disabled={!text.trim()} onClick={doSend} title="任务继续执行，消息会插队处理">↩ 插话</button>
                : <button className="btn primary" disabled={!text.trim()} onClick={doSend}>发送</button>}
              {busy && <button className="btn danger" onClick={() => interrupt()} title="中断当前任务（可从断点继续）">⏹ 终止</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
