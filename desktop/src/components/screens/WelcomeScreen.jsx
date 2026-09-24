import React, { useState } from 'react';
import { useApp } from '../../state/AppState.jsx';

const KINDS = [
  { id: 'mobile', t: '纯移动端', d: '本地数据/第三方API' },
  { id: 'go', t: 'App+Go后端', d: '自建API+数据库' },
];
const COLORS = ['#3D5AFE', '#00B8A9', '#F6416C', '#FFB830', '#6C5CE7'];
const DOMAINS = ['电商', '内容社区', '效率工具', '聊天', '记录统计'];

export default function WelcomeScreen() {
  const { setScreen, openProject } = useApp();
  const [idea, setIdea] = useState('');
  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [kind, setKind] = useState('go');
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const pickDir = async () => {
    const d = await window.amc.projects.pickDir();
    if (d) {
      setDir(d);
      if (!name) setName(d.split(/[\\/]/).filter(Boolean).pop() || '');
    }
  };

  const create = async () => {
    setError(null);
    if (!idea.trim()) return setError('请先描述你的想法');
    if (!name.trim()) return setError('请填写项目名');
    if (!dir) return setError('请选择项目目录');
    setBusy(true);
    const r = await window.amc.projects.create({
      mode: 'flutter', scaffold: 'flutter-app',
      fields: { name: name.trim(), dir, idea: idea.trim(), kind, color },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    openProject({ name: name.trim(), dir, idea: idea.trim(), kind, color, head: null, commits: 0, dirty: true });
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-hero">
          <div className="welcome-logo">A</div>
          <h1>把想法变成 App</h1>
          <p className="welcome-sub">
            描述你想要的应用，AI 与你敲定规格，然后自动开发、自动测试。<br />
            任何想法都行 —— 不需要预设模板，不需要写代码。
          </p>
        </div>

        <div className="welcome-card">
          <label className="welcome-label">描述你的想法</label>
          <textarea className="idea-input" rows={3}
            placeholder="例：给钓友记录渔获的 App，拍照记录鱼种/重量/天气水温，按钓点汇总，能看年度统计…"
            value={idea} onChange={(e) => setIdea(e.target.value)} />
          <div className="welcome-row">
            <div className="chip-row">
              {DOMAINS.map((d) => (
                <span key={d} className="chip" onClick={() => !idea.includes(d) && setIdea((idea ? idea + ' ' : '') + d)}>{d}</span>
              ))}
            </div>
            <span className="welcome-hint">想不出来？点一个领域找灵感（仅预填描述，不限定范围）</span>
          </div>

          <div className="welcome-grid">
            <div>
              <label className="welcome-label">项目名 / 目录</label>
              <input className="proj-name-input" placeholder="项目名（英文）" value={name}
                onChange={(e) => setName(e.target.value)} style={{ marginBottom: 8 }} />
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="proj-name-input" placeholder="项目目录…" value={dir} readOnly style={{ flex: 1 }} />
                <button className="btn" onClick={pickDir}>选择目录</button>
              </div>
            </div>
            <div>
              <label className="welcome-label">应用形态</label>
              <div className="type-grid">
                {KINDS.map((k) => (
                  <div key={k.id} className={'type-card' + (kind === k.id ? ' sel' : '')} onClick={() => setKind(k.id)}>
                    <div className="t">{k.t}</div>
                    <div className="d">{k.d}</div>
                  </div>
                ))}
              </div>
              <label className="welcome-label" style={{ marginTop: 12 }}>品牌主色</label>
              <div className="swatch-row">
                {COLORS.map((c) => (
                  <div key={c} className={'swatch' + (color === c ? ' sel' : '')} style={{ background: c }}
                    onClick={() => setColor(c)} />
                ))}
              </div>
            </div>
          </div>

          {error && <div style={{ marginTop: 12, color: 'var(--err)', fontSize: 12 }}>{error}</div>}
          {busy && <div style={{ marginTop: 12, color: 'var(--brand-text)', fontSize: 12 }}>正在脚手架（flutter create + 知识库挂载 + git 初始化）…</div>}

          <div className="welcome-cta">
            <span className="welcome-esti">
              创建后自动完成：flutter 脚手架 → 知识库 skill 挂载（.yume/commands/）→ git 首个决策点<br />
              然后进入工作台，你的想法会作为第一条消息与 AI 敲定 SPEC.md
            </span>
            <button className="btn primary" disabled={busy} onClick={create}>
              {busy ? '创建中…' : '开始与 AI 敲定需求 →'}
            </button>
          </div>
        </div>

        <div className="welcome-foot">
          <button className="btn small" onClick={() => setScreen(0)}>返回项目列表</button>
        </div>
      </div>
    </div>
  );
}
