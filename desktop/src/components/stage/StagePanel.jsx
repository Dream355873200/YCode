import React, { useEffect, useState } from 'react';
import { useApp } from '../../state/AppState.jsx';
import { renderMD } from '../../lib/markdown.js';
import { on, debounce } from '../../lib/refreshBus.js';
import MirrorCanvas from './MirrorCanvas.jsx';
import CodeEditor from './CodeEditor.jsx';

const TABS = ['编辑器', 'SPEC 规范', 'Agent 计划', '测试报告'];

// 测试报告页签：扫 .yume/test-reports/ 目录（test_report 工具落盘的 Markdown，
// frontmatter 含结构化元数据），列表 → 详情（条目表格 + 截图证据）。
function TestReportTab() {
  const { project } = useApp();
  const [reports, setReports] = useState([]);
  const [openIdx, setOpenIdx] = useState(-1);
  const [detail, setDetail] = useState(null);   // { meta, body, shots: [dataUrl] }
  const [zoom, setZoom] = useState(null);       // 放大的截图 dataUrl

  // frontmatter 解析：--- key: value / 列表 ---（test_report 工具的固定格式）
  const parseFM = (md) => {
    const meta = {};
    if (!md.startsWith('---')) return { meta, body: md };
    const end = md.indexOf('\n---', 3);
    if (end < 0) return { meta, body: md };
    for (const line of md.slice(4, end).split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2];
      else if (/^\s{2}-\s/.test(line) && meta.shots !== undefined) {
        meta.shots = (meta.shots || '') + (meta.shots ? '\n' : '') + line.trim().replace(/^-\s*/, '');
      }
    }
    return { meta, body: md.slice(end + 4) };
  };

  useEffect(() => {
    if (!project) return;
    let alive = true;
    const load = async () => {
      const r = await window.amc.fs.listDir(project.dir + '/.yume/test-reports').catch(() => null);
      if (!alive || !r || !r.ok) return;
      const files = r.files.filter((f) => f.endsWith('.md'));
      // 预读 frontmatter（列表徽标：verdict / 统计）
      const metas = await Promise.all(files.slice(0, 30).map((f) =>
        window.amc.fs.readFile(f)
          .then((fr) => (fr.ok ? parseFM(fr.content).meta : null))
          .catch(() => null)
      ));
      if (alive) setReports(files.map((f, i) => ({ file: f, meta: metas[i] || {} })));
    };
    load();
    const off = on('report', debounce(load));
    const t = setInterval(load, 30000);
    return () => { alive = false; off(); clearInterval(t); };
  }, [project]);

  // 打开详情：读全文 → 图片路径就地从正文解析（每个条目块内嵌自己的截图，
  // 见 report 工具的卡片式格式）→ 渲染后替换占位块为真图
  const [inlineImgs, setInlineImgs] = useState({}); // 归一化路径 → dataUrl
  // normImg 报告正文图片路径归一化：剥 ../ 前缀（相对报告文件 → 相对项目根）。
  // data-img 属性里是原始路径，替换时也要过同一归一化才能对上 key。
  const normImg = (p) => {
    let s = p;
    while (s.startsWith('../') || s.startsWith('..\\')) s = s.slice(3);
    return s;
  };
  useEffect(() => {
    const entry = typeof reports[openIdx] === 'string' ? { file: reports[openIdx] } : reports[openIdx];
    if (openIdx < 0 || !entry || !entry.file) { setDetail(null); setInlineImgs({}); return; }
    let alive = true;
    window.amc.fs.readFile(entry.file).then((r) => {
      if (!alive || !r.ok) return;
      const { meta, body } = parseFM(r.content);
      setDetail({ file: entry.file, meta, body });
      // 正文里的 ![alt](path) 引用 → 读图转 dataUrl（就地渲染用）。
      // 相对路径按项目根解析；兼容绝对路径（旧报告）。
      const paths = [];
      for (const m of body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        paths.push(normImg(m[1]));
      }
      const uniq = [...new Set(paths)];
      Promise.all(
        uniq.map((p) => {
          const abs = /^[E-Za-z]:[\\/]/.test(p) ? p : (project && project.dir ? project.dir + '/' + p : p);
          return window.amc.fs.readImage(abs)
            .then((ir) => (ir.ok ? [p, ir.dataUrl] : null))
            .catch(() => null);
        })
      ).then((pairs) => {
        if (!alive) return;
        const map = {};
        for (const pr of pairs) if (pr) map[pr[0]] = pr[1];
        setInlineImgs(map);
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [openIdx, reports, project]);

  // 渲染正文并把图片占位块替换为真图（data-img 原始路径过 normImg 归一化后对 key）
  const renderedBody = detail
    ? renderMD(detail.body).replace(/<div class="md-img-note" data-img="([^"]*)">[^<]*<\/div>/g,
        (whole, p) => inlineImgs[normImg(p)]
          ? `<img class="tr-shot-inline" src="${inlineImgs[normImg(p)]}" alt="${p}">`
          : whole)
    : '';

  if (!project) return null;

  // 详情视图
  if (openIdx >= 0 && detail) {
    return (
      <div className="tr-detail" onClick={(e) => {
        // 事件委托：点正文里的内嵌截图 → 放大
        if (e.target.classList && e.target.classList.contains('tr-shot-inline')) setZoom(e.target.src);
      }}>
        <div className="tr-back" onClick={() => { setOpenIdx(-1); setZoom(null); }}>← 返回报告列表</div>
        <div className="md-body" dangerouslySetInnerHTML={{ __html: renderedBody }} />
        {zoom && (
          <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'var(--scrim-strong)', display: 'grid', placeItems: 'center', cursor: 'zoom-out' }}>
            <img src={zoom} style={{ maxWidth: '92%', maxHeight: '92%', borderRadius: 10 }} />
          </div>
        )}
      </div>
    );
  }

  // 列表视图
  return (
    <div className="tr-list">
      {reports.length === 0 ? (
        <div style={{ color: 'var(--faint)', fontSize: 11.5, textAlign: 'center', marginTop: 30, lineHeight: 2 }}>
          暂无测试报告<br />AI 全量测试后调用 test_report 工具自动生成
        </div>
      ) : reports.map((r, i) => {
        const m = r.meta || {};
        const verdict = m.verdict || '';
        const name = (m.title || r.file.split(/[\\/]/).pop());
        return (
          <div key={r.file} className="tr-item" onClick={() => setOpenIdx(i)}>
            <div className="tr-head">
              <span className="tr-title" title={name}>{name}</span>
              {verdict && <span className={'tr-verdict ' + verdict}>{verdict === 'pass' ? '✅ PASS' : verdict === 'fail' ? '❌ FAIL' : '◐ 部分'}</span>}
            </div>
            <div className="tr-meta">
              <span>{m.date || ''}</span>
              <span>{m.device || ''}</span>
              {m.total && <span>✅{m.pass || 0} ❌{m.fail || 0} / {m.total}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 手机占位区：未投屏时显示提示卡；投屏后挂 MirrorCanvas（Web 原生：
// 主进程 scrcpy 协议流 → WebCodecs 解码 → canvas，真 DOM 无窗口管理）
function MirrorSlot({ deviceId, active }) {
  return (
    <div className={'mirror-slot' + (active ? ' live' : '')}>
      {active
        ? <MirrorCanvas deviceId={deviceId} />
        : (
          <div className="ms-placeholder">
            <div className="ms-phone">📱</div>
            <div>手机实时预览</div>
            <div className="ms-sub">投屏后此处显示设备画面，可直接操作（P2 接入 Hot Reload 徽标）</div>
          </div>
        )}
    </div>
  );
}

// 设备栏 + 手机占位区：adb 自动检测、投屏开关、flutter run 部署 + Hot Reload（P2-1/2/3）
// 极简模式嵌在「开发直播」页签；专业模式迁入 PhoneWindow 浮动窗（本组件导出共用）。
export function DevicePanel({ onMirrorState }) {
  const { project } = useApp();
  const [devices, setDevices] = useState([]);
  const [adbOk, setAdbOk] = useState(true);
  const [sel, setSel] = useState(null);   // 选中的设备 id
  const [mirroring, setMirroring] = useState(null); // 投屏中的设备 id
  const [err, setErr] = useState('');     // 投屏失败原因（scrcpy 退出时的 stderr）
  const [deploy, setDeploy] = useState(null); // { status } building|running
  const [deployLog, setDeployLog] = useState([]);

  useEffect(() => {
    window.amc.devices.list().then((r) => { setDevices(r.devices || []); setAdbOk(r.adbAvailable !== false); });
    const off = window.amc.devices.onChanged(({ devices, adbAvailable }) => {
      setDevices(devices || []);
      setAdbOk(adbAvailable !== false);
      setSel((cur) => (cur && devices.some((d) => d.id === cur) ? cur : (devices[0] && devices[0].id) || null));
    });
    const offExit = window.amc.devices.onMirrorExited(({ deviceId, error }) => {
      setMirroring((m) => (m === deviceId ? null : m));
      if (error) setErr(error);
    });
    return () => { off(); offExit(); };
  }, []);

  // flutter run 事件流（日志尾部 30 条 + 状态机）
  useEffect(() => {
    const off = window.amc.flutter.onEvent(({ evt, projectDir, ...rest }) => {
      if (!project || projectDir !== project.dir) return;
      if (evt === 'starting') { setDeploy({ status: 'building' }); setDeployLog([]); }
      else if (evt === 'started') setDeploy({ status: 'running' });
      else if (evt === 'exited') setDeploy(null);
      else if (evt === 'log') setDeployLog((l) => [...l.slice(-29), rest.text]);
    });
    return off;
  }, [project]);

  useEffect(() => { if (onMirrorState) onMirrorState(mirroring); }, [mirroring, onMirrorState]);

  const toggleMirror = async () => {
    if (!sel) return;
    setErr('');
    if (mirroring === sel) {
      await window.amc.devices.stopMirror(sel);
      setMirroring(null);
    } else {
      const r = await window.amc.devices.startMirror(sel);
      if (r.ok) setMirroring(sel);
      else setErr(r.error || '投屏启动失败');
    }
  };

  const toggleDeploy = async () => {
    if (!project || !sel) return;
    if (deploy) {
      await window.amc.flutter.stop(project.dir);
      setDeploy(null);
    } else {
      const r = await window.amc.flutter.start({ projectDir: project.dir, deviceId: sel });
      if (!r.ok) setErr(r.error || '启动失败');
    }
  };

  const online = devices.filter((d) => d.state === 'online');
  return (
    <>
    <div className="device-bar">
      <span className="db-label">设备</span>
      {!adbOk ? (
        <span className="db-hint">未找到 adb — 安装 Android 平台工具或填 scrcpyPath</span>
      ) : online.length === 0 ? (
        <span className="db-hint">未检测到设备 — 插入手机（开 USB 调试）或启动模拟器</span>
      ) : (
        <select className="db-select" value={sel || ''} onChange={(e) => setSel(e.target.value)}>
          {online.map((d) => (
            <option key={d.id} value={d.id}>
              {d.model || d.id}{d.transport === 'wifi' ? ' · WiFi' : ''}
            </option>
          ))}
        </select>
      )}
      {online.length > 0 && (
        <button className={'btn small' + (mirroring ? '' : ' primary')} onClick={toggleMirror} disabled={!sel}>
          {mirroring ? '⏹ 停止投屏' : '▶ 投屏'}
        </button>
      )}
      {project && online.length > 0 && (
        <>
          <button className={'btn small' + (deploy ? '' : ' primary')} onClick={toggleDeploy} disabled={!sel}>
            {deploy ? '⏹ 停止应用' : '🚀 部署运行'}
          </button>
          {deploy && (
            <>
              <button className="btn small" onClick={() => window.amc.flutter.reload(project.dir)} title="保存后热重载">⚡ Reload</button>
              <button className="btn small" onClick={() => window.amc.flutter.restart(project.dir)} title="重启应用（重建状态）">🔄 Restart</button>
              <span className={'db-hint' + (deploy.status === 'running' ? ' ok' : '')}>
                {deploy.status === 'running' ? '● 运行中' : '● 构建中…'}
              </span>
            </>
          )}
        </>
      )}
      {err && <span className="db-hint" style={{ color: 'var(--err)' }} title={err}>{err.slice(0, 80)}</span>}
    </div>
    {deployLog.length > 0 && (
      <div className="deploy-log">
        {deployLog.map((l, i) => <div key={i} className="dl-line">{l}</div>)}
      </div>
    )}
    <MirrorSlot deviceId={mirroring} active={!!mirroring} />
    </>
  );
}

export default function StagePanel({ editingFile, editor }) {
  const { project, engine } = useApp();
  const [tab, setTab] = useState(0);
  const [spec, setSpec] = useState('');
  const [plan, setPlan] = useState(null);

  // SPEC.md：轮询 + 切到该页签时立即刷新。
  // SPEC 是 AI 与用户对话敲定后更新的「范围契约」，必须反映最新内容，
  // 只在进项目时读一次会永远停在旧版。
  useEffect(() => {
    if (!project) return;
    let alive = true;
    const load = () => window.amc.fs
      .readFile(project.dir + '/SPEC.md')
      .then((r) => { if (alive) setSpec(r.ok ? r.content : '（SPEC.md 尚未生成 — 与 AI 对话后创建）'); })
      .catch(() => {});
    load();
    const off = on(['spec', 'files'], debounce(load));
    const t = setInterval(load, 20000);
    return () => { alive = false; off(); clearInterval(t); };
  }, [project]);

  // 切到 SPEC 页签时立即拉最新（不等轮询周期）
  useEffect(() => {
    if (tab !== 1 || !project) return;
    window.amc.fs.readFile(project.dir + '/SPEC.md').then((r) => setSpec(r.ok ? r.content : '（SPEC.md 尚未生成 — 与 AI 对话后创建）')).catch(() => {});
  }, [tab, project]);

  // Agent 计划
  // Agent 计划（引擎未就绪时跳过轮询，避免启动窗口期刷连接错误日志）
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (engine.status !== 'running') return;
      window.amc.engine.get('/plan').then((r) => { if (alive) setPlan(r && r.body); }).catch(() => {});
    };
    load();
    const off = on('plan', debounce(load));
    const t = setInterval(load, 15000);
    return () => { alive = false; off(); clearInterval(t); };
  }, [engine.status]);

  return (
    <div className="card stage">
      <div className="pane-head">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M1.5 5.5h13" stroke="currentColor" strokeWidth="1.4"/></svg>
        工作区
        <span className="tag muted" style={{ marginLeft: 'auto' }}>{project ? project.name : ''}</span>
      </div>
      <div className="tabs">
        {TABS.map((t, i) => (
          <div key={t} className={'tab' + (tab === i ? ' active' : '')} onClick={() => setTab(i)}>{t}</div>
        ))}
      </div>
      <div className="tab-body">
        {/* 所有页签常驻渲染，非激活用 CSS 隐藏 —— 报告等重内容不随切 tab 卸载 */}
        {TABS.map((t, i) => (
          <div key={t} style={{ display: tab === i ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {t === '编辑器' && editor && <CodeEditor {...editor} />}
            {t === 'SPEC 规范' && (
              <div className="doc-scroll">
                <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMD(spec) }} />
              </div>
            )}
            {t === 'Agent 计划' && (
              <div className="doc-scroll" style={{ paddingTop: 10 }}>
                <div style={{ fontSize: 10.5, color: 'var(--faint)', paddingBottom: 8, borderBottom: '1px dashed var(--border-subtle)', marginBottom: 10 }}>
                  计划原文 · 由 AI 撰写 · 原样呈现，不加工
                </div>
                <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMD(plan && (plan.content || plan.plan || plan.text || (typeof plan === 'string' ? plan : '')) || '（暂无计划 — AI 进入 Plan Mode 后显示）') }} />
              </div>
            )}
            {t === '测试报告' && <TestReportTab />}
          </div>
        ))}
      </div>
    </div>
  );
}
