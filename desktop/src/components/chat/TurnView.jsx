import React, { useEffect, useRef, useState } from 'react';
import { renderMD } from '../../lib/markdown.js';
import { resolveRenderer } from '../../lib/toolRender.jsx';

// 思考块：默认折叠 + 摘要预览 + 计秒
export function ThinkView({ think }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={'think' + (open ? ' open' : '')}>
      <div className="think-head" onClick={() => setOpen(!open)}>
        <span className="th-arrow">▶</span>思考
        <span className="th-sum">{think.sum}</span>
        <span className="th-time">{think.secs}</span>
      </div>
      <div className="think-body">{think.body}</div>
    </div>
  );
}

// 行动条目（骨架组件）：人话动词/对象/状态一行摘要，点开按工具名分发
// 渲染展开细节（toolRender 注册表——Edit 出 diff、Write 出内容预览、
// 命令类出命令+输出、测试类出入参+设备回执）；未注册工具回落 <pre>。
export function ActView({ act }) {
  const [open, setOpen] = useState(false);
  const R = resolveRenderer(act.verb);
  const clickable = act.expand && act.detail;
  return (
    <>
      <div className={'act' + (clickable ? ' expand' : '') + (open ? ' open' : '')}
        onClick={() => clickable && setOpen(!open)}>
        <span className="a-arrow"></span>
        <span className="a-verb">{R.label || act.verb}</span>
        <span className="a-obj">{act.obj}</span>
        <span className={'a-st ' + (act.cls || 'ok')}>{act.st}</span>
      </div>
      {clickable && open && (
        <div className="a-detail" style={{ display: 'block' }}>
          {R.Detail ? <R.Detail act={act} /> : <pre className="a-raw">{act.detail}</pre>}
        </div>
      )}
    </>
  );
}

// turn：生命线 + 交错步骤流（思考/工具按真实执行序）+ 总结。
// confirm/ask 卡也是 step（事件到达时序插入）；onAnswer 由宿主传入。
export function TurnView({ turn, onAnswer }) {
  const started = useRef(new Date());
  useEffect(() => { started.current = new Date(); }, []);
  const time = started.current.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={'turn' + (turn.running ? ' run-turn' : '')}>
      <div className="turn-head">
        {turn.title}
        <span className="t-time">{time}{turn.running ? ' · 进行中' : ''}</span>
      </div>
      {(turn.steps || []).map((s) => (
        s.kind === 'think'
          ? <ThinkView key={s.id} think={s} />
          : s.kind === 'confirm'
            ? <ConfirmCard key={s.id} item={s} onAnswer={onAnswer} />
            : s.kind === 'ask'
              ? <AskCard key={s.id} item={s} onAnswer={onAnswer} />
              : <ActView key={s.id} act={s} />
      ))}
      {(() => {
        const sum = (turn.sum || '').replace(/<\/?think>/g, '').trim();
        return sum && !turn.running ? <div className="turn-sum md-body" dangerouslySetInnerHTML={{ __html: renderMD(sum) }} /> : null;
      })()}
    </div>
  );
}

// 审批条：对话内呈现，批准/拒绝 → POST /approve
export function ApproveBarView({ item, onApprove }) {
  if (item.resolved) {
    return (
      <div className="approve-bar" style={{ opacity: 0.65 }}>
        <span className="ap-text">{item.resolved === 'approved' ? '已批准' : '已拒绝'} · {item.toolName}</span>
      </div>
    );
  }
  return (
    <div className="approve-bar">
      <span className="ap-text">
        {item.toolName} 需要批准
        <span className="ap-dim">{typeof item.toolInput === 'string' ? item.toolInput.slice(0, 120) : ''}</span>
      </span>
      <button className="btn small" onClick={() => onApprove(item, false)}>拒绝</button>
      <button className="btn primary small" onClick={() => onApprove(item, true)}>✓ 批准执行</button>
    </div>
  );
}

// ---- 确认卡（confirm 工具）：单选 / 多选 / 纯确认，可补充意见 ----
// 批量队列态（item.total > 1）：头部 1/N 徽标，当前问题作答，已答的折叠成历史行。
export function ConfirmCard({ item, onAnswer }) {
  const [picked, setPicked] = useState(() => (item.mode === 'multi' ? [] : null));
  const [note, setNote] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  // 队列推进到下一题（index 变化）→ 重置选中态
  const lastIdx = useRef(item.index);
  useEffect(() => {
    if (item.index !== lastIdx.current) {
      lastIdx.current = item.index;
      setPicked(item.mode === 'multi' ? [] : null);
      setNote('');
    }
  }, [item.index, item.mode]);

  const toggle = (c) => {
    if (item.mode === 'multi') {
      setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
    } else {
      setPicked(c);
    }
  };

  // 提交：答案 = 选中项 + 补充意见（confirm 模式 = 确认/取消 二值）
  const submit = (ok) => {
    let answer;
    if (item.mode === 'confirm') {
      answer = ok ? '确认' : '取消';
      if (note.trim()) answer += `（${note.trim()}）`;
    } else {
      const sel = item.mode === 'multi' ? (picked || []) : picked ? [picked] : [];
      if (sel.length === 0) return; // 没选不能交
      answer = sel.join('、');
      if (note.trim()) answer += `（补充：${note.trim()}）`;
    }
    onAnswer(item, answer);
  };

  if (item.resolved) {
    return (
      <div className="confirm-card" style={{ opacity: 0.7 }}>
        <div className="cf-q">{item.question}</div>
        <div className="cf-answered">✓ 已回复：{item.answer}</div>
      </div>
    );
  }

  return (
    <div className="confirm-card">
      {item.total > 1 && (
        <div className="cf-queue">
          <span className="cf-badge">{item.index}/{item.total}</span>
          {item.history && item.history.length > 0 && (
            <button className="cf-hist-toggle" onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? '收起' : `已答 ${item.history.length} 项`}
            </button>
          )}
        </div>
      )}
      {item.total > 1 && showHistory && item.history && (
        <div className="cf-history">
          {item.history.map((h, i) => (
            <div key={i} className="cf-hist-row">
              <span className="cf-hist-q">{h.question}</span>
              <span className="cf-hist-a">→ {h.answer}</span>
            </div>
          ))}
        </div>
      )}
      <div className="cf-q">{item.question}</div>
      {item.detail && <div className="cf-detail">{item.detail}</div>}
      {(item.mode === 'single' || item.mode === 'multi') && (
        <div className="cf-choices">
          {item.choices.map((c) => {
            const on = item.mode === 'multi' ? (picked || []).includes(c) : picked === c;
            return (
              <button key={c} className={'cf-choice' + (on ? ' on' : '')} onClick={() => toggle(c)}>
                <span className="cf-mark">{item.mode === 'multi' ? (on ? '☑' : '☐') : on ? '◉' : '○'}</span>
                {c}
              </button>
            );
          })}
        </div>
      )}
      <input className="cf-note" placeholder="补充意见（可选）…" value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(true); }} />
      <div className="cf-actions">
        {item.mode === 'confirm' ? (
          <>
            <button className="btn small" onClick={() => submit(false)}>取消</button>
            <button className="btn primary small" onClick={() => submit(true)}>✓ 确认</button>
          </>
        ) : (
          <button className="btn primary small" onClick={() => submit(true)}
            disabled={item.mode === 'multi' ? !(picked || []).length : !picked}>
            提交{note.trim() ? '（含意见）' : ''}
          </button>
        )}
      </div>
    </div>
  );
}

// 问答卡（普通 AskUser）：文本输入提交
export function AskCard({ item, onAnswer }) {
  const [text, setText] = useState('');
  if (item.resolved) {
    return (
      <div className="confirm-card" style={{ opacity: 0.7 }}>
        <div className="cf-q">{item.question}</div>
        <div className="cf-answered">✓ 已回复：{item.answer}</div>
      </div>
    );
  }
  return (
    <div className="confirm-card">
      <div className="cf-q">{item.question}</div>
      <div className="cf-actions">
        <input className="cf-note" placeholder="输入回答…" value={text} autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) onAnswer(item, text.trim()); }} />
        <button className="btn primary small" disabled={!text.trim()} onClick={() => onAnswer(item, text.trim())}>回复</button>
      </div>
    </div>
  );
}
