import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './state/AppState.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import ProjectsScreen from './components/screens/ProjectsScreen.jsx';
import WelcomeScreen from './components/screens/WelcomeScreen.jsx';
import WorkbenchScreen from './components/screens/WorkbenchScreen.jsx';

function Rail() {
  const { screen, setScreen } = useApp();
  const btn = (i, title, children) => (
    <button className={'rail-btn' + (screen === i ? ' active' : '')} title={title}
      onClick={() => setScreen(i)}>{children}</button>
  );
  return (
    <nav className="rail">
      <div className="logo">A</div>
      {btn(0, '项目列表', <svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M2 3.5h4l1.5 2H14v7H2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg>)}
      {btn(1, '新建项目', <svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>)}
      {btn(2, '工作台', <svg width="17" height="17" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>)}
      <div className="spacer" />
    </nav>
  );
}

function Topbar() {
  const { screen, project, engine, usage } = useApp();
  const [showSettings, setShowSettings] = useState(false);
  const ctx = ['· 项目列表', '· 新建项目', '· 工作台'][screen];
  const st = engine.status === 'running' ? 'ok' : 'err';
  const pillText = engine.status === 'running'
    ? `flai-engine · ${engine.model || ''}`
    : engine.status === 'starting' ? 'flai-engine · 启动中…'
    : `flai-engine · ${engine.status === 'error' ? '异常' : '未运行'}`;
  const toggleTheme = () => {
    const html = document.documentElement;
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
    html.dataset.theme = next;
    window.amc.config.get().then((cfg) => window.amc.config.save({ ...cfg, theme: next }));
  };
  return (
    <header className="topbar">
      <div className="proj" style={{ display: screen === 2 ? '' : 'none' }}>
        <span className="dot" style={{ background: st === 'ok' ? 'var(--ok)' : 'var(--err)' }} />
        {project ? project.name : ''}
        <span style={{ color: 'var(--faint)', fontWeight: 400, fontSize: '11.5px' }}>{ctx}</span>
        {project && project.head && (
          <button className="ver-btn" title="git 决策点">
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4"/><path d="M8 5.5V8l2 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            {project.head} · {project.commits || 0} 个决策点
          </button>
        )}
      </div>
      <div className="top-stat" style={{ display: screen === 2 ? '' : 'none', marginLeft: screen === 2 ? 0 : 10 }}>
        {usage.input + usage.output > 0 && <span>token <b>{((usage.input + usage.output) / 1000).toFixed(1)}k</b></span>}
      </div>
      <div className="top-actions">
        <div className="engine-pill" title={`${engine.addr} — 点击设置 / 重启`}
          style={{ cursor: 'pointer' }}
          onClick={() => engine.status === 'running' ? setShowSettings(true) : window.amc.engine.restart()}>
          <span className="dot" style={{ background: st === 'ok' ? 'var(--ok)' : 'var(--err)' }} />
          {pillText}
        </div>
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
        <button className="icon-btn" title="切换浅色/深色主题" onClick={toggleTheme}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </button>
      </div>
    </header>
  );
}

function Shell() {
  const { config } = useApp();
  useEffect(() => {
    document.documentElement.dataset.theme = (config && config.theme) || 'dark';
  }, [config]);
  const { screen } = useApp();
  return (
    <div className="app">
      <Rail />
      <div className="main">
        <Topbar />
        <main className="content">
          <ErrorBoundary key={screen}>
            {screen === 0 && <ProjectsScreen />}
            {screen === 1 && <WelcomeScreen />}
            {screen === 2 && <WorkbenchScreen />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
