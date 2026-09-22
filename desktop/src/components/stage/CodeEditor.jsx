// CodeEditor.jsx — 中栏编辑器。
// 多文件页签（文件树/跟随 AI 打开）+ 语法高亮 + 行号 + AI 改动实时 diff。
// 「跟随 AI」开 = AI 正在改的文件自动成为活动页签；关 = 锁定手动浏览。
//
// 编辑写回（Ctrl+S）：textarea 自由编辑 → 保存落盘 → POST /notify/user-edit
// 通知引擎注入「用户手动修改了 xxx」→ AI 下轮操作前重读，防止基于陈旧
// 内容 Edit 失败 / Write 静默覆盖用户修改。
//
// 冲突防御：编辑期间轮询发现磁盘内容变了（AI 改的）→ 标记外部冲突，
// 顶条警示「文件已被 AI 修改」，用户选择「加载新版」或「仍保存我的版本」。
import React, { useEffect, useRef, useState } from 'react';
import { langOf, highlightLines, diffLines } from '../../lib/codediff.js';
import { highlightCode } from '../../lib/markdown.js';
import { on, debounce } from '../../lib/refreshBus.js';
import { useApp } from '../../state/AppState.jsx';

export default function CodeEditor({
  openFiles,   // string[] 打开的文件（绝对路径）
  activeFile,  // string 当前活动文件
  followAI,    // bool 跟随 AI 正在编辑的文件
  onCloseFile, // (path) => void
  onSelectFile,// (path) => void
  onToggleFollow,
}) {
  const { sessionId } = useApp();
  const [code, setCode] = useState(null);
  const [diff, setDiff] = useState(null); // [{type,text,oldNo,newNo}] | null
  const prevFiles = useRef({}); // path -> 上次见到的内容（diff 基准）
  const curFile = useRef(null);

  // ---- 编辑状态 ----
  const [editing, setEditing] = useState(false);   // 编辑模式（textarea）
  const [draft, setDraft] = useState('');          // 编辑中的全文
  const [dirty, setDirty] = useState(false);       // 有未保存修改
  const [conflict, setConflict] = useState(false); // 编辑期间文件被 AI 改了
  const [savedAt, setSavedAt] = useState(null);    // 最近保存时间（提示用）

  // 切文件：重置 diff，当前内容为新基线；退出编辑模式（未保存修改随切丢弃——
  // 页签关闭有 ×，切页签前 dirty 状态在页签名上可见）
  useEffect(() => {
    if (curFile.current && curFile.current !== activeFile && code) {
      prevFiles.current[curFile.current] = code;
    }
    curFile.current = activeFile || null;
    setDiff(null);
    setEditing(false);
    setDirty(false);
    setConflict(false);
    if (!activeFile) { setCode(null); return; }
    let alive = true;
    const load = () => {
      window.amc.fs.readFile(activeFile).then((r) => {
        if (!alive || !r.ok) return;
        setCode((prev) => {
          if (prev == null) { prevFiles.current[activeFile] = r.content; return r.content; }
          if (prev !== r.content) {
            // 编辑中磁盘变了（AI 写的）→ 冲突标记；否则正常打 diff
            if (editingRef.current && dirtyRef.current) {
              setConflict(true);
              return prev; // 视图保持用户的编辑现场
            }
            setDiff(diffLines(prevFiles.current[activeFile] ?? prev, r.content));
            prevFiles.current[activeFile] = r.content;
          }
          return r.content;
        });
      }).catch(() => {});
    };
    load();
    // AI Write/Edit 该文件 → 即时重读（实时 diff 的主通道）；轮询兜底。
    // 路径归一化（分隔符/大小写）后再比对。
    const norm = (p) => String(p || '').replace(/[\\/]+/g, '/').toLowerCase();
    const off = on('files', debounce((p) => { if (!p || norm(p) === norm(activeFile)) load(); }, 200));
    const t = setInterval(load, 8000);
    return () => { alive = false; off(); clearInterval(t); };
  }, [activeFile]);

  // editing/dirty 进轮询闭包要经 ref（否则闭包捕获旧值）
  const editingRef = useRef(false);
  const dirtyRef = useRef(false);
  editingRef.current = editing && dirty;
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Ctrl+S 保存：写盘 → 通知引擎 → 退出编辑模式（diff 基线重置为新内容）
  const save = async () => {
    if (!activeFile || !dirty) return;
    const r = await window.amc.fs.writeFile(activeFile, draft);
    if (!r.ok) { alert('保存失败：' + (r.error || '')); return; }
    prevFiles.current[activeFile] = draft;
    setCode(draft);
    setDirty(false);
    setConflict(false);
    setSavedAt(Date.now());
    setEditing(false);
    // 通知引擎 → 注入「用户手动修改了 xxx」→ AI 重读该文件
    if (sessionId) {
      window.amc.engine.post('/notify/user-edit', { session_id: sessionId, file: activeFile }).catch(() => {});
    }
  };

  // Ctrl+S / Esc 快捷键（编辑模式内）
  const onKey = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Escape') {
      if (dirty && !confirm('放弃未保存的修改？')) return;
      setEditing(false); setDirty(false);
    }
  };

  const addN = diff ? diff.filter((d) => d.type === 'add').length : 0;
  const delN = diff ? diff.filter((d) => d.type === 'del').length : 0;

  // 进入编辑：以当前展示内容为草稿起点
  const startEdit = () => {
    if (!activeFile || code == null) return;
    setDraft(code);
    setEditing(true);
    setDirty(false); // 草稿 == 磁盘内容，改了才 dirty
  };

  return (
    <div className="code-side" style={{ flex: 1 }}>
      {/* 工具条：文件页签 + 编辑/保存 + 跟随 AI 开关 */}
      <div className="ed-bar">
        <div className="ed-tabs">
          {openFiles.length === 0 && <span className="ed-empty">从左侧「文件」页签或跟随 AI 打开文件</span>}
          {openFiles.map((f) => {
            const name = f.split(/[\\/]/).pop();
            return (
              <div key={f} className={'ed-tab' + (f === activeFile ? ' active' : '')}
                onClick={() => onSelectFile(f)} title={f}>
                {name}
                <span className="ed-close" onClick={(e) => { e.stopPropagation(); onCloseFile(f); }}>×</span>
              </div>
            );
          })}
        </div>
        {activeFile && !editing && (
          <button className="btn small" style={{ flexShrink: 0 }} onClick={startEdit} title="编辑此文件（Ctrl+S 保存）">
            ✏️ 编辑
          </button>
        )}
        {editing && (
          <button className={'btn small primary' + (dirty ? '' : ' disabled-look')} style={{ flexShrink: 0 }}
            onClick={save} disabled={!dirty} title="保存并通知 AI 重读（Ctrl+S）">
            💾 保存{dirty ? ' •' : ''}
          </button>
        )}
        <button className={'btn small' + (followAI ? ' primary' : '')} style={{ flexShrink: 0 }}
          title="开启后编辑器自动跳转到 AI 正在修改的文件；关闭则锁定当前文件"
          onClick={() => onToggleFollow(!followAI)}>
          {followAI ? '◉ 跟随 AI' : '○ 跟随 AI'}
        </button>
      </div>
      {/* 冲突警示：编辑期间 AI 改了同一文件 */}
      {editing && conflict && (
        <div className="ed-conflict">
          ⚠️ 你编辑期间 AI 修改了这个文件。
          <button className="btn small" onClick={() => { setDraft(code); setConflict(false); setDirty(false); }}>加载 AI 版本（丢弃我的修改）</button>
          <button className="btn small" onClick={() => setConflict(false)}>继续保存我的版本</button>
        </div>
      )}
      <div className="code-body code-highlight" onKeyDown={onKey} tabIndex={-1}>
        {editing
          ? <textarea className="ed-textarea" value={draft} spellCheck={false}
              onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
              onKeyDown={onKey} autoFocus />
          : code
            ? (diff
                ? diff.map((d, i) => (
                    <div key={i} className={'cl cl-' + d.type}>
                      <span className="cl-no">{d.type === 'add' ? d.newNo : d.oldNo ?? ''}</span>
                      <span className="cl-sign">{d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}</span>
                      <span dangerouslySetInnerHTML={{ __html: highlightCode(d.text || ' ', langOf(activeFile)) }} />
                    </div>
                  ))
                : (() => {
                    const lines = code.split('\n');
                    const shown = lines.slice(-400);
                    const hl = highlightLines(shown.join('\n'), langOf(activeFile));
                    const offset = Math.max(0, lines.length - 400);
                    return hl.map((h, i) => (
                      <div key={i} className="cl">
                        <span className="cl-no">{offset + i + 1}</span>
                        <span dangerouslySetInnerHTML={{ __html: h || '&nbsp;' }} />
                      </div>
                    ));
                  })())
            : <div className="cl" style={{ color: 'var(--faint)' }}>打开文件后此处显示代码</div>}
      </div>
      <div className="mini-log">
        <span className="l-tool">{activeFile || '待命'}</span>
        {editing && <span style={{ color: dirty ? 'var(--warn)' : 'var(--faint)' }}>{dirty ? '未保存（Ctrl+S 保存，Esc 放弃）' : '编辑中'}</span>}
        {!editing && savedAt && !dirty && <span style={{ color: 'var(--ok)' }}>已保存 · 已通知 AI 重读</span>}
        {diff && (
          <span style={{ marginLeft: 'auto', fontSize: 10 }}>
            <span style={{ color: 'var(--ok)' }}>+{addN}</span>{' '}
            <span style={{ color: 'var(--err)' }}>−{delN}</span>
          </span>
        )}
      </div>
    </div>
  );
}
