import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../state/AppState.jsx';
import ChatPanel from '../chat/ChatPanel.jsx';
import LeftPanel, { parseAnalyzeIssues } from '../panels/LeftPanel.jsx';
import StagePanel from '../stage/StagePanel.jsx';

export default function WorkbenchScreen() {
  const { project, engine } = useApp();
  const chatApiRef = useRef(null);
  const [editingFile, setEditingFile] = useState(null);
  const [issues, setIssues] = useState([]);
  const [testState, setTestState] = useState(null); // 左栏测试状态卡：{running, tool, obj, doneAt}
  const prefilled = useRef(null);

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

  // 行动事件 → 开发直播文件联动 + analyze 问题提取 + 测试状态卡
  const onAct = ({ file, verb, analyzeResult, tool, obj, running, done }) => {
    if (file) setEditingFile(file);
    if (analyzeResult) setIssues(parseAnalyzeIssues(analyzeResult));
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
        <StagePanel editingFile={editingFile} />
      </div>
      <div className="ws-right">
        <LeftPanel issues={issues} testState={testState} />
      </div>
    </div>
  );
}
