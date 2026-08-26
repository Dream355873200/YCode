import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../state/AppState.jsx';

function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

export default function ProjectsScreen() {
  const { setScreen, openProject } = useApp();
  const [projects, setProjects] = useState(null);

  const refresh = useCallback(() => {
    window.amc.projects.list().then(setProjects);
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <div className="projects-page">
      <div className="projects-head">
        <div>
          <h2 className="screen-title">项目</h2>
          <div className="screen-sub">
            {projects ? `${projects.length} 个项目` : '加载中…'}
          </div>
        </div>
        <button className="btn primary" onClick={() => setScreen(1)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ verticalAlign: '-1px', marginRight: 5 }}><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          新建项目
        </button>
      </div>
      <div className="proj-grid">
        {(projects || []).map((p) => (
          <div key={p.dir} className="proj-card" onClick={() => p.exists && openProject(p)}
            title={p.exists ? p.dir : '目录不存在'}>
            <div className="pc-top">
              <div className="pc-icon" style={{ background: `linear-gradient(135deg,${p.color || '#3D5AFE'},#7C4DFF)` }}>
                {(p.name || '?').slice(0, 1)}
              </div>
              <div className={'pc-live' + (p.dirty ? '' : ' idle')}>
                {p.dirty ? <><span className="dot" />开发中</> : p.exists ? '已暂停' : '目录缺失'}
              </div>
            </div>
            <div className="pc-name">{p.name}</div>
            <div className="pc-desc">{p.idea || '（无描述）'}</div>
            <div className="pc-meta">
              {p.exists && p.head && <span>{p.commits} 个决策点</span>}
              <span className="pc-time">{timeAgo(p.createdAt)}</span>
            </div>
            {p.exists && p.head && (
              <div className="pc-ver">
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6"/><path d="M8 5.5V8l2 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                {p.head} {p.dirty ? '· 有未提交改动' : ''}
              </div>
            )}
          </div>
        ))}
        <div className="proj-card new" onClick={() => setScreen(1)}>
          <div className="pc-new-plus">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
          </div>
          <div className="pc-new-text">新建项目</div>
        </div>
      </div>
    </div>
  );
}
