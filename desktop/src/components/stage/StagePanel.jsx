import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/AppState.jsx';
import { renderMD, highlightCode, esc } from '../../lib/markdown.js';
import MirrorCanvas from './MirrorCanvas.jsx';

const TABS = ['开发直播', 'SPEC 规范', 'Agent 计划', '文件树', '测试报告'];

// 按文件扩展名给 highlight.js 挑语言
const LANG_BY_EXT = {
  dart: 'dart', go: 'go', yaml: 'yaml', yml: 'yaml', json: 'json',
  md: 'markdown', js: 'javascript', ts: 'typescript', tsx: 'typescript',
  jsx: 'javascript', html: 'xml', xml: 'xml', css: 'css', sh: 'bash',
  bat: 'bash', cmd: 'bash', ps1: 'bash', sql: 'sql', java: 'java',
  kt: 'kotlin', swift: 'swift', py: 'python', toml: 'ini', cfg: 'ini',
};
const langOf = (file) => LANG_BY_EXT[(file || '').split('.').pop().toLowerCase()];

// highlight.js 输出的是整段 HTML（token 可能跨行）。要按行渲染就得把 HTML
// 按 <br> 边界切开 —— 简单做法：逐行独立高亮（Dart/Go 代码行内 token 居多，
// 跨行字符串/注释会退化成纯文本，可接受）。
const splitLine = (wholeHtml, lineIdx) => wholeHtml;

// 按行独立高亮（行号内联、跨行 token 退化）
function highlightLines(code, lang) {
  return code.split('\n').map((l) => highlightCode(l || ' ', lang));
}

// ---- 行级 diff（开发直播：AI 改动后新增绿底 / 删除红底叠加在语法高亮上）----
// 简单 LCS（最长公共子序列）按行对比 —— 文件规模（几百行）下完全够用。
// 返回 [{ type: 'same'|'add'|'del', text, oldNo, newNo }]
export function diffLines(oldText, newText) {
  const a = (oldText || '').split('\n');
  const b = (newText || '').split('\n');
  const n = a.length, m = b.length;
  // LCS 表（限制规模防卡顿：超大文件退化为整段替换）
  if (n * m > 4_000_000) {
    return [
      ...a.map((t, i) => ({ type: 'del', text: t, oldNo: i + 1 })),
      ...b.map((t, i) => ({ type: 'add', text: t, newNo: i + 1 })),
    ];
  }
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i], oldNo: i + 1, newNo: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i], oldNo: i + 1 }); i++; }
    else { out.push({ type: 'add', text: b[j], newNo: j + 1 }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i], oldNo: i + 1 }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j], newNo: j + 1 }); j++; }
  return out;
}

function FileNode({ node, dir, depth = 0 }) {
  const [open, setOpen] = useState(depth < 1);
  const [content, setContent] = useState(null);
  const stCls = { A: 'new', '??': 'new', M: 'mod' }[node.st?.trim()] || null;

  const preview = async () => {
    const r = await window.amc.fs.readFile(dir + '/' + node.path);
    if (r.ok) setContent(r.content);
  };

  if (node.type === 'dir') {
    return (
      <>
        <div className="ft-dir" style={{ paddingLeft: depth * 14, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {node.name}/
        </div>
        {open && node.children.map((c) => <FileNode key={c.path} node={c} dir={dir} depth={depth + 1} />)}
      </>
    );
  }
  return (
    <>
      <div className="ft-file" style={{ paddingLeft: depth * 14 + 16 }} onClick={() => (content ? setContent(null) : preview())}>
        {node.name}
        {stCls && <span className={'ft-st ' + stCls}>{stCls === 'new' ? 'NEW' : 'MOD'}</span>}
      </div>
      {content && (
        <div className="a-detail" style={{ display: 'block', margin: '2px 8px 4px 26px', maxHeight: 320, overflow: 'auto' }}>
          {content.slice(0, 8000)}
        </div>
      )}
    </>
  );
}

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
    const t = setInterval(load, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [project]);

  // 打开详情：读全文 + 截图转 dataUrl
  useEffect(() => {
    const entry = typeof reports[openIdx] === 'string' ? { file: reports[openIdx] } : reports[openIdx];
    if (openIdx < 0 || !entry || !entry.file) { setDetail(null); return; }
    let alive = true;
    window.amc.fs.readFile(entry.file).then((r) => {
      if (!alive || !r.ok) return;
      const { meta, body } = parseFM(r.content);
      const shotPaths = (meta.shots || '').split('\n').filter(Boolean);
      Promise.all(
        shotPaths.map((p) => window.amc.fs.readImage(p).then((ir) => (ir.ok ? ir.dataUrl : null)).catch(() => null))
      ).then((urls) => { if (alive) setDetail({ file: entry.file, meta, body, shots: urls.filter(Boolean) }); });
    }).catch(() => {});
    return () => { alive = false; };
  }, [openIdx, reports]);

  if (!project) return null;

  // 详情视图
  if (openIdx >= 0 && detail) {
    return (
      <div className="tr-detail">
        <div className="tr-back" onClick={() => { setOpenIdx(-1); setZoom(null); }}>← 返回报告列表</div>
        <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMD(detail.body) }} />
        {detail.shots.length > 0 && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', margin: '14px 0 6px' }}>证据截图（{detail.shots.length}）</div>
            <div className="tr-shots">
              {detail.shots.map((u, i) => (
                <img key={i} src={u} className="tr-shot" onClick={() => setZoom(u)} />
              ))}
            </div>
          </>
        )}
        {detail.meta.shots && detail.shots.length === 0 && (
          <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 10 }}>
            截图路径 {detail.meta.shots.split('\n').length} 条，加载失败（文件可能已被清理或路径失效）
          </div>
        )}
        {zoom && (
          <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.82)', display: 'grid', placeItems: 'center', cursor: 'zoom-out' }}>
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
function DevicePanel({ onMirrorState }) {
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

export default function StagePanel({ editingFile }) {
  const { project, engine } = useApp();
  const [tab, setTab] = useState(0);
  const [spec, setSpec] = useState('');
  const [plan, setPlan] = useState(null);
  const [tree, setTree] = useState(null);

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
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
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
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [engine.status]);

  // 文件树
  useEffect(() => {
    if (!project) return;
    window.amc.projects.filetree(project.dir).then(setTree);
    const t = setInterval(() => window.amc.projects.filetree(project.dir).then(setTree), 8000);
    return () => clearInterval(t);
  }, [project]);

  // 开发直播：当前编辑文件内容 + 与上一版的行级 diff（新增绿底/删除红底）
  // - 切换文件：旧文件内容存进 prevFilesRef，diff 清零
  // - 轮询（4s）拉最新内容：与当前不同 → 旧内容成为 diff 基准，渲染行级差异
  const [liveCode, setLiveCode] = useState(null);
  const [liveDiff, setLiveDiff] = useState(null); // [{type,text,oldNo,newNo}] | null
  const prevFiles = useRef({}); // path -> last seen content
  const liveFile = useRef(null);

  useEffect(() => {
    // 切文件：重置 diff，记录当前内容为新基线
    if (liveFile.current && liveFile.current !== editingFile && liveCode) {
      prevFiles.current[liveFile.current] = liveCode;
    }
    liveFile.current = editingFile || null;
    setLiveDiff(null);
    if (!editingFile) { setLiveCode(null); return; }
    let alive = true;
    const load = () => {
      window.amc.fs.readFile(editingFile).then((r) => {
        if (!alive || !r.ok) return;
        setLiveCode((prev) => {
          if (prev == null) { prevFiles.current[editingFile] = r.content; return r.content; }
          if (prev !== r.content) {
            // 内容变了 → 上一版作为 diff 基准
            setLiveDiff(diffLines(prevFiles.current[editingFile] ?? prev, r.content));
            prevFiles.current[editingFile] = r.content;
          }
          return r.content;
        });
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [editingFile]);

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
        {tab === 0 && (
          <div className="code-side" style={{ flex: 1 }}>
            <DevicePanel />
            <div className="code-tabs">
              <div className="code-tab active">{editingFile ? editingFile.split(/[\\/]/).pop() : '（暂无编辑中文件）'}
                <span className="dirty" style={{ display: editingFile ? '' : 'none' }} />
              </div>
            </div>
            <div className="code-body code-highlight">
              {liveCode
                ? (() => {
                    if (liveDiff) {
                      // diff 视图：删除红底（旧行号）+ 新增绿底（新行号），叠加语法高亮
                      const lang = langOf(editingFile);
                      return liveDiff.map((d, i) => (
                        <div key={i} className={'cl cl-' + d.type}>
                          <span className="cl-no">{d.type === 'add' ? d.newNo : d.oldNo ?? ''}</span>
                          <span className="cl-sign">{d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}</span>
                          <span dangerouslySetInnerHTML={{ __html: highlightCode(d.text || ' ', lang) }} />
                        </div>
                      ));
                    }
                    const lines = liveCode.split('\n');
                    const shown = lines.slice(-200);
                    const hl = highlightLines(shown.join('\n'), langOf(editingFile));
                    const offset = Math.max(0, lines.length - 200);
                    return hl.map((h, i) => (
                      <div key={i} className="cl">
                        <span className="cl-no">{offset + i + 1}</span>
                        <span dangerouslySetInnerHTML={{ __html: h || '&nbsp;' }} />
                      </div>
                    ));
                  })()
                : <div className="cl" style={{ color: 'var(--faint)' }}>AI 开始写代码后此处实时显示（scrcpy 手机预览 P2 接入）</div>}
            </div>
            <div className="mini-log">
              <span className="l-tool">{editingFile || '待命'}</span>
              {liveDiff && (
                <span style={{ marginLeft: 'auto', fontSize: 10 }}>
                  <span style={{ color: 'var(--ok)' }}>+{liveDiff.filter((d) => d.type === 'add').length}</span>{' '}
                  <span style={{ color: 'var(--err)' }}>−{liveDiff.filter((d) => d.type === 'del').length}</span>
                </span>
              )}
            </div>
          </div>
        )}
        {tab === 1 && (
          <div className="doc-scroll">
            <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMD(spec) }} />
          </div>
        )}
        {tab === 2 && (
          <div className="doc-scroll" style={{ paddingTop: 10 }}>
            <div style={{ fontSize: 10.5, color: 'var(--faint)', paddingBottom: 8, borderBottom: '1px dashed var(--border-subtle)', marginBottom: 10 }}>
              计划原文 · 由 AI 撰写 · 原样呈现，不加工
            </div>
            <div className="md-body" dangerouslySetInnerHTML={{ __html: renderMD(plan && (plan.content || plan.plan || plan.text || (typeof plan === 'string' ? plan : '')) || '（暂无计划 — AI 进入 Plan Mode 后显示）') }} />
          </div>
        )}
        {tab === 3 && (
          <div className="ftree">
            {tree
              ? tree.map((n) => <FileNode key={n.path} node={n} dir={project.dir} />)
              : <div style={{ color: 'var(--faint)' }}>加载中…</div>}
          </div>
        )}
        {tab === 4 && <TestReportTab />}
      </div>
    </div>
  );
}
