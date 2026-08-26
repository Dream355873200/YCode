import React, { useEffect, useRef, useState } from 'react';
import { renderMD } from '../../lib/markdown.js';

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

// 行动条目：expand 类带三角可展开（Edit/Bash/flutter/Git/失败）；plain 无载荷
export function ActView({ act }) {
  const [open, setOpen] = useState(false);
  const clickable = act.expand && act.detail;
  return (
    <>
      <div className={'act' + (clickable ? ' expand' : '') + (open ? ' open' : '')}
        onClick={() => clickable && setOpen(!open)}>
        <span className="a-arrow"></span>
        <span className="a-verb">{act.verb}</span>
        <span className="a-obj">{act.obj}</span>
        <span className={'a-st ' + (act.cls || 'ok')}>{act.st}</span>
      </div>
      {clickable && open && <div className="a-detail" style={{ display: 'block' }}>{act.detail}</div>}
    </>
  );
}

// turn：生命线 + 交错步骤流（思考/工具按真实执行序）+ 总结
export function TurnView({ turn }) {
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
