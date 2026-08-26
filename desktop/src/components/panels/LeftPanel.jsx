// 左栏：测试意图横幅 + 任务/测试/网络/问题 单卡四页签
import React, { useEffect, useState } from 'react';
import { useApp } from '../../state/AppState.jsx';

const TABS = ['任务', '测试', '网络', '问题'];

// 从 flutter analyze 输出提取问题条目
export function parseAnalyzeIssues(result) {
  if (!result) return [];
  const issues = [];
  for (const line of result.split('\n')) {
    // "   error - The method 'x' isn't defined - lib\main.dart:10:5 - undefined_method"
    const m = line.match(/^\s*(error|warning|info)\s+-\s+(.+?)\s+-\s+(\S+):(\d+):(\d+)\s+-\s+(\S+)\s*$/i);
    if (m) {
      issues.push({ sev: m[1].toLowerCase(), msg: m[2], file: m[3], line: m[4], rule: m[6] });
    }
  }
  return issues;
}

// 测试工具名 → 人话（横幅展示）
const TOOL_LABELS = {
  ui_tree: '读取界面结构', tap: '点击屏幕', swipe: '滑动屏幕', type: '输入文本',
  back: '按返回键', wait_for: '等待页面元素', screenshot: '截取屏幕', screen_diff: '对比截图',
  logcat: '查设备日志', net: '网络联调', vision_ask: '视觉判断', test_report: '生成测试报告',
};

export default function LeftPanel({ issues = [], testState }) {
  const { engine, project } = useApp();
  const [tab, setTab] = useState(0);
  const [tasks, setTasks] = useState(null);
  const [netLog, setNetLog] = useState([]); // 网络页签：录制代理落盘的请求流

  useEffect(() => {
    let alive = true;
    const load = () => {
      // 引擎未就绪时跳过本轮轮询（启动窗口期刷 ECONNREFUSED 日志无意义）
      if (engine.status !== 'running') return;
      window.amc.engine.get('/tasks')
        .then((r) => { if (alive && r && r.body && Array.isArray(r.body)) setTasks(r.body); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [engine.status]);

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
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [project]);

  const statusMap = { completed: 'done', in_progress: 'run', pending: 'todo' };
  const kindOf = (t) => {
    const s = (t.subject || '') + (t.description || '');
    if (/test|测试|patrol/i.test(s)) return 'test';
    if (/\bgo\b|server|后端/i.test(s)) return 'go';
    return 'flutter';
  };
  const sevTag = { error: 'err', warning: 'warn', info: 'info' };
  const errCount = issues.filter((i) => i.sev === 'error').length;

  // 横幅三态：analyze 错误 > 测试进行中 > 上次测试结论/引导
  const testRunning = testState && testState.running;
  const testLabel = testRunning
    ? `${TOOL_LABELS[testState.tool] || testState.tool}${testState.obj ? ' · ' + testState.obj : ''}`
    : '';
  const bannerTitle = errCount > 0 ? `发现问题 · ${errCount} error`
    : testRunning ? '自动化测试中'
    : (testState && testState.doneAt) ? '测试完成'
    : '复合自动化测试';
  const bannerText = errCount > 0 ? 'flutter analyze 报告 error — 「问题」页签可查，AI 自修复中'
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
              {i === 3 && issues.length > 0 && <span className="tag err" style={{ marginLeft: 4, fontSize: 9, padding: '0 6px' }}>{issues.length}</span>}
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
              <div style={{ color: 'var(--faint)', fontSize: 11.5, textAlign: 'center', marginTop: 30, lineHeight: 2 }}>
                测试时间线（P2）<br />AI 操作 App 的步骤与断言将实时呈现
              </div>
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
              {issues.length === 0 ? (
                <div style={{ color: 'var(--faint)', fontSize: 11.5, textAlign: 'center', marginTop: 30, lineHeight: 2 }}>
                  暂无缺陷卡<br />analyze error / 测试失败将回流到此
                </div>
              ) : issues.map((i, k) => (
                <div key={k} className={'issue-item' + (i.sev === 'error' ? ' sev-high' : '')}>
                  <div className="iss-head">
                    <span className={'tag ' + (sevTag[i.sev] || 'muted')}>{i.sev}</span>
                    <span className="iss-title">{i.rule}</span>
                  </div>
                  <div className="iss-desc">{i.msg}</div>
                  <div className="iss-meta">
                    <span>{i.file.split(/[\\/]/).pop()}:{i.line}</span>
                    <span>来源：flutter analyze</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
