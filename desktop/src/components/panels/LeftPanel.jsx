// 左栏：测试意图横幅 + 任务/测试/网络/问题 单卡四页签。
// 「问题」页签只收 IssueReport 记录的测试缺陷（带修复生命周期）；
// analyze 静态问题是 AI 开发内循环的自修复过程（analyze→修→analyze
// 直到收敛），不进 UI——那是 AI 自己消化的东西，用户关心的是测试发现。
import React, { useEffect, useState } from 'react';
import { useApp } from '../../state/AppState.jsx';
import { TOOL_LABELS, testLogArg } from '../../lib/toolLang.js';
import { on, debounce } from '../../lib/refreshBus.js';

const TABS = ['任务', '测试', '网络', '问题', '文件'];

// 文件树节点（pro 模式「文件」页签）：点击文件 → onOpen 在中栏编辑器打开。
// 沿用 StagePanel 文件树的行为：目录折叠展开、NEW/MOD 徽标（git st 派生）。
function TreeFileNode({ node, dir, depth = 0, onOpen }) {
  const [open, setOpen] = useState(depth < 1);
  const stCls = { A: 'new', '??': 'new', M: 'mod' }[node.st?.trim()] || null;

  if (node.type === 'dir') {
    return (
      <>
        <div className="ft-dir" style={{ paddingLeft: depth * 14, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {node.name}/
        </div>
        {open && node.children.map((c) => <TreeFileNode key={c.path} node={c} dir={dir} depth={depth + 1} onOpen={onOpen} />)}
      </>
    );
  }
  return (
    <div className="ft-file" style={{ paddingLeft: depth * 14 + 16, cursor: 'pointer' }}
      onClick={() => onOpen && onOpen(dir + '/' + node.path)} title={node.path}>
      {node.name}
      {stCls && <span className={'ft-st ' + stCls}>{stCls === 'new' ? 'NEW' : 'MOD'}</span>}
    </div>
  );
}

export default function LeftPanel({ testState, onOpenFile }) {
  const { engine, project, sessionId } = useApp();
  const [tab, setTab] = useState(0);
  const [tasks, setTasks] = useState(null);
  const [netLog, setNetLog] = useState([]); // 网络页签：录制代理落盘的请求流

  // 任务跟随会话：task store 按会话隔离，轮询带 session_id 才拿到本项目的任务
  useEffect(() => {
    if (!project || !sessionId) return;
    let alive = true;
    const load = async () => {
      const r = await window.amc.engine.get(`/tasks?session_id=${encodeURIComponent(sessionId)}`);
      if (alive && r && r.body && Array.isArray(r.body)) setTasks(r.body);
    };
    load();
    // 事件驱动为主（task 工具 done → 即时拉），慢速轮询只做兜底
    const off = on('tasks', debounce(load));
    const t = setInterval(load, 15000);
    return () => { alive = false; off(); clearInterval(t); };
  }, [engine.status, project, sessionId]);

  // AI 记录的问题（IssueReport 工具 → task store，metadata.issue 标记）。
  // 与 analyze 静态问题合并进「问题」页签：动态问题带状态（待修复/已解决），
  // 静态问题只有级别。同一轮询数据里分流，不额外发请求。
  const issueTasks = (tasks || []).filter((t) => t.metadata && t.metadata.issue);
  const openIssueTasks = issueTasks.filter((t) => t.status === 'pending' || t.status === 'in_progress');

  // 网络页签：轮询引擎录制代理落盘的请求流（.yume/net-log.jsonl，JSONL）。
  // AI 联调测试（net record_start → 操作 app → record_stop）期间实时出现。
  useEffect(() => {
    if (!project) return;
    let alive = true;
    const load = () => {
      window.amc.fs.readFile(project.dir + '/.yume/net-log.jsonl')
        .then((r) => {
          if (!alive || !r.ok) return;
          const lines = r.content.trim().split('\n').filter(Boolean);
          const rows = [];
          for (const l of lines.slice(-200)) {
            try { rows.push(JSON.parse(l)); } catch { /* 跳过残行 */ }
          }
          setNetLog(rows);
        })
        .catch(() => {});
    };
    load();
    const off = on('net-log', debounce(load));
    const t = setInterval(load, 15000);
    return () => { alive = false; off(); clearInterval(t); };
  }, [project]);

  // 测试页签：轮询测试工具时间线（.yume/test-log.jsonl，工具层捕获——
  // 每次 tap/screenshot/… 的参数+结果+耗时，不依赖 SSE 事件流）。
  const [testLog, setTestLog] = useState([]);  useEffect(() => {
    if (!project) return;
    let alive = true;
    const load = () => {
      window.amc.fs.readFile(project.dir + '/.yume/test-log.jsonl')
        .then((r) => {
          if (!alive || !r.ok) return;
          const lines = r.content.trim().split('\n').filter(Boolean);
          const rows = [];
          for (const l of lines.slice(-300)) {
            try { rows.push(JSON.parse(l)); } catch { /* 跳过残行 */ }
          }
          setTestLog(rows);
        })
        .catch(() => {});
    };
    load();
    const off = on('test-log', debounce(load));
    const t = setInterval(load, 10000);
    return () => { alive = false; off(); clearInterval(t); };
  }, [project]);

  // 文件页签：项目文件树（NEW/MOD 徽标由 git status 派生）。
  // Write/Edit done → 即时刷新（tree 信号）；轮询 30s 兜底。
  const [tree, setTree] = useState(null);
  useEffect(() => {
    if (!project) return;
    const load = () => window.amc.projects.filetree(project.dir).then(setTree);
    load();
    const off = on('tree', debounce(load, 500));
    const t = setInterval(load, 30000);
    return () => { off(); clearInterval(t); };
  }, [project]);

  const statusMap = { completed: 'done', in_progress: 'run', pending: 'todo' };
  const kindOf = (t) => {
    const s = (t.subject || '') + (t.description || '');
    if (/test|测试|patrol/i.test(s)) return 'test';
    if (/\bgo\b|server|后端/i.test(s)) return 'go';
    return 'flutter';
  };
  const sevTag = { error: 'err', warning: 'warn', info: 'info' };

  // 横幅三态：问题待修 > 测试进行中 > 上次测试结论/引导
  const testRunning = testState && testState.running;
  const testLabel = testRunning
    ? `${TOOL_LABELS[testState.tool] || testState.tool}${testState.obj ? ' · ' + testState.obj : ''}`
    : '';
  const bannerTitle = openIssueTasks.length > 0 ? `发现问题 · ${openIssueTasks.length} 待修复`
    : testRunning ? '自动化测试中'
    : (testState && testState.doneAt) ? '测试完成'
    : '复合自动化测试';
  const bannerText = openIssueTasks.length > 0 ? '测试发现的问题 — 「问题」页签可查，AI 修复中'
    : testRunning ? testLabel + '…'
    : (testState && testState.doneAt) ? '结论见对话摘要 · 证据在「测试报告」页签'
    : 'AI 开发后自动冒烟测试 · 说「测试一下」触发全量验证（语义树/截图/网络断言）';

  return (
    <>
      <div className="card intent-banner">
        <div className="ib-row">
          <div>
            <div className="ib-label">{bannerTitle}</div>
            <div className="ib-text">{bannerText}</div>
          </div>
          {testRunning && <span className="ib-spinner" />}
        </div>
      </div>
      <div className="card" style={{ flex: 1, padding: 0 }}>
        <div className="tabs">
          {TABS.map((t, i) => (
            <div key={t} className={'tab' + (tab === i ? ' active' : '')} onClick={() => setTab(i)}>
              {t}
              {i === 3 && openIssueTasks.length > 0 && <span className="tag err" style={{ marginLeft: 4, fontSize: 9, padding: '0 6px' }}>{openIssueTasks.length}</span>}
            </div>
          ))}
        </div>
        <div className="tab-body">
          {tab === 0 && (
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
              {!tasks || tasks.length === 0 ? (
                <div style={{ color: 'var(--faint)', fontSize: 11.5, textAlign: 'center', marginTop: 30, lineHeight: 2 }}>
                  暂无任务卡<br />AI 使用 TaskCreate 后自动出现
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--faint)', padding: '2px 2px 6px' }}>
                    <span>{tasks.filter((t) => t.status === 'completed').length}/{tasks.length} 完成</span>
                  </div>
                  {tasks.map((t) => (
                    <div key={t.id} className={'tk' + (t.status === 'in_progress' ? ' run' : '')}>
                      <span className={'tk-ic ' + (statusMap[t.status] || 'todo')}>
                        {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'}
                      </span>
                      <span className="tk-title">{t.subject || t.id}</span>
                      <span className="tk-meta">
                        <span className={'tk-kind ' + kindOf(t)}>{kindOf(t).toUpperCase()}</span>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {tab === 1 && (
            <div className="tl-scroll">
              {testLog.length === 0 ? (
                <div style={{ color: 'var(--faint)', fontSize: 11.5, textAlign: 'center', marginTop: 30, lineHeight: 2 }}>
                  测试时间线<br />AI 操作 App 的每一步（点击/输入/截图/断言）实时呈现
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--faint)', padding: '2px 2px 6px' }}>
                    <span>{testLog.length} 步</span>
                    <span>✓ {testLog.filter((s) => s.ok).length}</span>
                    <span style={{ color: testLog.some((s) => !s.ok) ? 'var(--err, #e55)' : undefined }}>
                      ✗ {testLog.filter((s) => !s.ok).length}
                    </span>
                  </div>
                  {testLog.map((s, i) => (
                    <div key={i} className="tl-step">
                      <span className="tl-ts">{s.ts}</span>
                      <span className={'tl-ic ' + (s.ok ? 'ok' : 'err')}>{s.ok ? '✓' : '✗'}</span>
                      <span className="tl-tool">{TOOL_LABELS[s.tool] || s.tool}</span>
                      <span className="tl-arg">{testLogArg(s)}</span>
                      {s.ms > 800 ? <span className="tl-ms">{(s.ms / 1000).toFixed(1)}s</span> : null}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {tab === 2 && (
            <div className="net-list">
              {netLog.length === 0 ? (
                <div style={{ color: 'var(--faint)', fontSize: 11.5, textAlign: 'center', marginTop: 30, lineHeight: 2 }}>
                  网络捕获<br />AI 联调测试（net record）时，app 的请求实时显示在此
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'var(--faint)', padding: '2px 2px 6px' }}>
                    <span>{netLog.length} 条请求</span>
                    <span>mock {netLog.filter((n) => n.mock).length}</span>
                  </div>
                  {netLog.map((n, i) => (
                    <div key={i} className="net-item">
                      <span className={'net-method ' + String(n.method || '').toLowerCase()}>{n.method}</span>
                      <span className="net-path">{n.path}</span>
                      <span className={'net-status ' + (n.mock ? 'mock' : (n.status >= 400 ? 'err' : 'ok'))}>
                        {n.mock ? 'MOCK' : n.status}
                      </span>
                      <span className="net-ts">{n.ts}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {tab === 3 && (
            <div className="issue-list">
              {issueTasks.length === 0 ? (
                <div style={{ color: 'var(--faint)', fontSize: 11.5, textAlign: 'center', marginTop: 30, lineHeight: 2 }}>
                  暂无缺陷卡<br />AI 测试中发现问题会记录到此处（IssueReport）
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 10, color: 'var(--faint)', padding: '4px 2px 6px' }}>
                    AI 记录的问题 · {openIssueTasks.length} 待修复
                  </div>
                  {issueTasks.map((t) => (
                    <div key={'it-' + t.id} className={'issue-item' + (t.metadata.issue === 'error' ? ' sev-high' : '')}
                      style={t.status === 'completed' ? { opacity: 0.55 } : undefined}>
                      <div className="iss-head">
                        <span className={'tag ' + (sevTag[t.metadata.issue] || 'muted')}>{t.metadata.issue}</span>
                        <span className="iss-title">{t.subject}</span>
                        <span className={'tag ' + (t.status === 'completed' ? 'ok' : 'warn')}
                          style={{ marginLeft: 'auto', fontSize: 9 }}>
                          {t.status === 'completed' ? '已解决' : '待修复'}
                        </span>
                      </div>
                      {t.description ? <div className="iss-desc">{t.description}</div> : null}
                      <div className="iss-meta"><span>来源：IssueReport</span></div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
          {tab === 4 && (
            <div className="ftree">
              {tree
                ? tree.map((n) => <TreeFileNode key={n.path} node={n} dir={project.dir} onOpen={onOpenFile} />)
                : <div style={{ color: 'var(--faint)' }}>加载中…</div>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
