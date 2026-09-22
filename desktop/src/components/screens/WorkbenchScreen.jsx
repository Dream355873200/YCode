import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../../state/AppState.jsx';
import ChatPanel from '../chat/ChatPanel.jsx';
import LeftPanel from '../panels/LeftPanel.jsx';
import StagePanel from '../stage/StagePanel.jsx';
import PhoneWindow from '../stage/PhoneWindow.jsx';

export default function WorkbenchScreen() {
  const { project, sessionId } = useApp();
  const chatApiRef = useRef(null);
  const [editingFile, setEditingFile] = useState(null);
  const [testState, setTestState] = useState(null); // 左栏测试状态卡：{running, tool, obj, doneAt}
  const prefilled = useRef(null);

  // ---- 编辑器状态（中栏）：打开的文件 / 活动页签 / 跟随 AI ----
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [followAI, setFollowAI] = useState(true);

  // 在编辑器打开文件（文件树点击 / 跟随 AI 跳转）。manual=true 表示用户
  // 主动点击——自动关掉「跟随 AI」，浏览不被 AI 的编辑动作抢走。
  const openInEditor = useCallback((path, manual) => {
    setOpenFiles((fs) => (fs.includes(path) ? fs : [...fs, path]));
    setActiveFile(path);
    if (manual) setFollowAI(false);
  }, []);

  const closeFile = useCallback((path) => {
    const next = openFiles.filter((f) => f !== path);
    setOpenFiles(next);
    // 关的是活动页签 → 落到剩余的最后一个（或空）
    if (activeFile === path) setActiveFile(next[next.length - 1] || null);
  }, [openFiles, activeFile]);

  // 新项目首次进入：把「想法」预填进输入框（不自动发送）。
  // 工作流程约定（先读 SPEC 草稿和 skill、一次性最多问 5 个问题等）
  // 已写在引擎侧 AGENTS.md 领域规范里。
  useEffect(() => {
    if (!project || !chatApiRef.current) return;
    if (prefilled.current === project.dir) return;
    if (!project.dirty) return; // 只有刚创建（有未提交脚手架）的项目才预填
    if (!project.idea) return;
    prefilled.current = project.dir;
    chatApiRef.current.prefill(project.idea);
  }, [project]);

  if (!project) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--faint)', fontSize: 13 }}>
        未打开项目 — 回到项目列表选择或新建
      </div>
    );
  }

  // 行动事件 → 编辑器跟随 + 测试状态卡。
  // analyze 输出不进 UI（AI 开发内循环自消化）；测试问题走 IssueReport 工具
  // → task store → 「问题」页签；测试步骤走工具层日志 → test-log.jsonl → 「测试」页签。
  const onAct = ({ file, verb, tool, obj, running, done }) => {
    if (file) {
      setEditingFile(file);
      // 跟随 AI 开启时，AI 正在改的文件自动成为编辑器活动页签
      if (followAI) openInEditor(file, false);
    }
    if (verb === 'test') {
      setTestState((prev) => {
        if (done) return { running: false, doneAt: Date.now(), lastTool: prev ? prev.lastTool : 'test_report' };
        return { running: true, tool, obj, doneAt: prev ? prev.doneAt : null };
      });
    }
  };

  return (
    <div className="ws">
      <div className="ws-left">
        <ChatPanel
          chatApi={(api) => (chatApiRef.current = api)}
          onAct={onAct}
        />
      </div>
      <div className="ws-mid">
        <StagePanel
          editingFile={editingFile}
          editor={{
            openFiles, activeFile, followAI,
            onCloseFile: closeFile,
            onSelectFile: (f) => setActiveFile(f),
            onToggleFollow: setFollowAI,
          }}
        />
      </div>
      <div className="ws-right">
        <LeftPanel testState={testState} onOpenFile={(f) => openInEditor(f, true)} />
      </div>
      {/* 手机画面浮动小窗（中栏让给文件+代码） */}
      <PhoneWindow />
    </div>
  );
}
