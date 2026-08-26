// 对话流状态机：把 goagent SSE 事件流规约为 UI 条目序列
// 条目类型：user 气泡 / turn（思考块+行动+总结）/ approve 审批条 / sys 系统行
import { useCallback, useEffect, useRef, useState } from 'react';

let idSeq = 0;
const nid = () => ++idSeq;

// 从 tool_result 提取展示用的对象/状态摘要
export function summarizeResult(toolName, result) {
  if (!result) return { st: '', cls: 'run', detail: '' };
  const r = result;
  let m = r.match(/已写入\s+(\S+)/);
  if (m) return { st: '✓ ' + (r.match(/\((\d+)\s*行/)?.[1] ? `+${r.match(/\((\d+)\s*行/)[1]} 行` : ''), cls: 'ok', detail: r };
  m = r.match(/已替换\s*(\d+)\s*处匹配\s*\(([^)]+)\)/);
  if (m) return { st: `✓ ${m[1]} 处`, cls: 'ok', detail: r };
  m = r.match(/^\$\s*flutter\s+(\S+)/);
  if (m) {
    const hasErr = /error\s+-|^\s*\d+\s*error/i.test(r);
    const noIssue = /No issues found!/i.test(r);
    const issues = r.match(/(\d+)\s*issues? found/i);
    return {
      st: noIssue ? 'No issues' : issues ? `${issues[1]} issues` : hasErr ? 'error' : '✓',
      cls: noIssue ? 'ok' : hasErr ? 'err' : issues ? 'warn' : 'ok',
      detail: r,
      isAnalyze: true,
    };
  }
  if (r.includes('退出码非零') || r.includes('error') || r.includes('失败')) return { st: '✗', cls: 'err', detail: r };
  if (r.startsWith('(无匹配') || r.startsWith('(无输出')) return { st: '✓', cls: 'ok', detail: r };
  const n = r.match(/\((\d+)\s*个文件\)/);
  if (n) return { st: `${n[1]} 文件`, cls: 'ok', detail: r };
  return { st: '✓', cls: 'ok', detail: r };
}

const EXPANDABLE = new Set(['Edit', 'Bash', 'flutter', 'Git', 'Shell', 'Read', 'Write', 'Glob', 'Grep']);
// 测试类工具（左栏测试状态卡的数据源）
const TEST_TOOLS = new Set([
  'ui_tree', 'tap', 'swipe', 'type', 'back', 'wait_for',
  'screenshot', 'screen_diff', 'logcat', 'net', 'vision_ask', 'test_report', 'patrol_dump',
]);

// 把 GET /sessions/{id}/messages 的历史消息转成 UI 条目（重开项目回放）。
// 结构与实时 SSE 归约后的形状一致：user 气泡 / turn（steps 交错序 + sum）。
// tool_result 按 tool_use_id 配对回填到对应行动条目。
// assistant 消息内 content 块顺序即真实执行序（thinking → text → tool_use），
// 按 content 顺序 push 进 steps，思考与工具调用交错呈现。
export function historyToItems(messages) {
  const items = [];
  let cur = null;
  const actsById = new Map();
  const newTurn = () => {
    cur = { id: nid(), type: 'turn', title: '', running: false, steps: [], sum: '' };
    items.push(cur);
  };
  for (const msg of messages || []) {
    if (msg.role === 'user') {
      // 带 tool_result 的 user 消息是工具回执，不生成气泡
      const hasToolResult = (msg.content || []).some((b) => b.type === 'tool_result');
      if (hasToolResult) {
        for (const b of msg.content) {
          if (b.type !== 'tool_result') continue;
          const act = actsById.get(b.tool_use_id);
          if (act) {
            const s = summarizeResult(act.verb, b.text);
            act.st = s.st; act.cls = s.cls; act.detail = s.detail;
            act.expand = act.expand || s.cls === 'err' || !!(b.text && b.text.length > 40);
          }
        }
        continue;
      }
      const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (text.trim()) items.push({ id: nid(), type: 'user', text: text.trim() });
    } else if (msg.role === 'assistant') {
      newTurn();
      let sum = '';
      for (const b of msg.content || []) {
        if (b.type === 'thinking' && (b.thinking || '').trim()) {
          cur.steps.push({
            kind: 'think',
            id: nid(),
            sum: b.thinking.split('\n')[0].slice(0, 40),
            body: b.thinking,
            secs: '',
          });
        } else if (b.type === 'text') {
          // 剥掉混入正文的思考标签（<think>/<thinking> 成对出现时归入思考块，
          // 单只开头标签则丢弃标签本身）——模型有时不走 reasoning 通道直接打进正文
          let t = b.text || '';
          const stripTags = (s) => s
            .replace(/<thinking>([\s\S]*?)<\/thinking>/g, (_m, body) => {
              if (body.trim()) cur.steps.push({ kind: 'think', id: nid(), sum: body.trim().split('\n')[0].slice(0, 40), body: body.trim(), secs: '' });
              return '';
            })
            .replace(/<think>([\s\S]*?)<\/think>/g, (_m, body) => {
              if (body.trim()) cur.steps.push({ kind: 'think', id: nid(), sum: body.trim().split('\n')[0].slice(0, 40), body: body.trim(), secs: '' });
              return '';
            });
          t = stripTags(t);
          // 去掉残留的孤立标签
          t = t.replace(/<\/?(think|thinking)>/g, '');
          sum += t;
        } else if (b.type === 'tool_use') {
          let obj = '';
          try {
            const input = typeof b.input === 'string' ? JSON.parse(b.input) : b.input;
            if (input) {
              if (input.file_path) obj = String(input.file_path).split(/[\\/]/).pop();
              else if (input.path) obj = String(input.path).split(/[\\/]/).pop();
              else if (input.pattern) obj = input.pattern;
              else if (input.command) obj = input.command;
              else if (input.cmd) obj = input.cmd;
              else if (input.query) obj = input.query;
              else if (input.action) obj = `flutter ${input.action}`;
            }
          } catch { /* ignore */ }
          const act = { kind: 'act', id: nid(), verb: b.name, obj, st: '…', cls: 'run', detail: '', toolUseId: b.id, expand: EXPANDABLE.has(b.name) };
          actsById.set(b.id, act);
          cur.steps.push(act);
        }
      }
      cur.sum = sum;
      cur.title = sum.trim().split('\n')[0].slice(0, 30) || '已完成';
    }
  }
  return items;
}

export function useChat({ onUsage, onAct, sessionIdRef }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // busy 的 ref 镜像：send 里同步读（避免闭包过期）
  const setBusyBoth = (v) => { busyRef.current = v; setBusy(v); };

  // 所有可变状态全走 ref —— handleEvent 不依赖任何 prop/state，
  // 保证 SSE 事件回调永远访问最新状态，不受 React 闭包过期影响
  const cur = useRef(null);
  const inThink = useRef(false);
  const thinkCloseTag = useRef('</think>'); // 当前思考块的闭合标签（<think> 或 <thinking>）
  const thinkBuf = useRef('');
  const sumBuf = useRef('');
  const thinkStart = useRef(0);
  const onUsageRef = useRef(onUsage);
  const onActRef = useRef(onAct);
  onUsageRef.current = onUsage;
  onActRef.current = onAct;

  const flushThink = () => {
    if (!cur.current) { thinkBuf.current = ''; inThink.current = false; return; }
    if (thinkBuf.current.trim()) {
      const body = thinkBuf.current.trim();
      // 按到达顺序推进 steps：思考块与工具调用交错呈现（真实执行序），
      // 而非全部堆在回合顶部
      cur.current.steps.push({
        kind: 'think',
        id: nid(),
        sum: body.split('\n')[0].slice(0, 40),
        body,
        secs: thinkStart.current ? ((Date.now() - thinkStart.current) / 1000).toFixed(1) + 's' : '',
      });
    }
    thinkBuf.current = '';
    inThink.current = false;
  };

  const sync = () => {
    const snap = cur.current;
    if (!snap) return;
    snap.sum = sumBuf.current;
    setItems((arr) => {
      const copy = [...arr];
      const i = copy.findIndex((x) => x && x.id === snap.id);
      if (i >= 0) copy[i] = { ...snap, steps: [...snap.steps] };
      return copy;
    });
  };

  // handleEvent 无外部依赖（全部走 ref），useCallback 依赖为空 → 引用永远稳定
  const handleEvent = useCallback((evt) => {
    if (!evt || !evt.type) return;
    const onAct = onActRef.current;
    const onUsage = onUsageRef.current;
    switch (evt.type) {
      case 'text_delta': {
        if (!cur.current) break;
        let text = evt.text || '';
        // 思考标签解析：<think>（DeepSeek 惯用）与 <thinking>（GLM/Qwen 惯用）
        // 都出现过——两种开头各自配对闭合标签，混入正文时剥掉归入思考块
        while (text.length) {
          if (inThink.current) {
            const close = thinkCloseTag.current; // '<think>' 或 '<thinking>'
            const end = text.indexOf(close);
            if (end >= 0) {
              thinkBuf.current += text.slice(0, end);
              flushThink();
              text = text.slice(end + close.length);
            } else { thinkBuf.current += text; text = ''; }
          } else {
            let start = text.indexOf('<think>');
            let tagLen = 7;
            if (start < 0) { start = text.indexOf('<thinking>'); tagLen = 10; }
            if (start >= 0) {
              sumBuf.current += text.slice(0, start);
              inThink.current = true;
              thinkCloseTag.current = tagLen === 7 ? '</think>' : '</thinking>';
              thinkStart.current = Date.now();
              text = text.slice(start + tagLen);
            } else { sumBuf.current += text; text = ''; }
          }
        }
        sync();
        break;
      }
      case 'thinking': {
        if (!cur.current) break;
        // 注意：不动 inThink —— 那是 text_delta 里 <think> 标签解析器的
        // 状态；这里的 thinking 事件来自独立通道（reasoning_content），
        // 与正文流互不影响。共用标志会把后续正文误吞进思考块。
        if (!thinkStart.current) thinkStart.current = Date.now();
        thinkBuf.current += evt.thinking || '';
        sync();
        break;
      }
      case 'tool_start': {
        // 测试类工具 → 测试状态卡（左栏意图横幅）实时更新。
        // 不依赖 cur.current：后台执行/断点恢复场景下 cur 为空，状态卡仍要工作。
        if (onAct && TEST_TOOLS.has(evt.tool_name)) {
          let tobj = '';
          try {
            const tinput = typeof evt.tool_input === 'string' ? JSON.parse(evt.tool_input) : evt.tool_input;
            if (tinput) {
              if (tinput.text) tobj = `"${String(tinput.text).slice(0, 12)}"`;
              else if (tinput.x !== undefined) tobj = `(${tinput.x},${tinput.y})`;
              else if (tinput.x1 !== undefined) tobj = `(${tinput.x1},${tinput.y1})→(${tinput.x2},${tinput.y2})`;
              else if (tinput.title) tobj = tinput.title;
              else if (tinput.action) tobj = tinput.action;
            }
          } catch { /* ignore */ }
          onAct({ verb: 'test', tool: evt.tool_name, obj: tobj, running: true });
        }
        if (!cur.current) break;
        flushThink();
        let obj = '';
        try {
          const input = typeof evt.tool_input === 'string' ? JSON.parse(evt.tool_input) : evt.tool_input;
          if (input) {
            if (input.file_path) obj = String(input.file_path).split(/[\\/]/).pop();
            else if (input.path) obj = String(input.path).split(/[\\/]/).pop();
            else if (input.pattern) obj = input.pattern;
            else if (input.command) obj = input.command;
            else if (input.cmd) obj = input.cmd;
            else if (input.query) obj = input.query;
            else if (input.action) obj = `flutter ${input.action}`;
          }
        } catch { /* ignore */ }
        cur.current.steps.push({ kind: 'act', id: nid(), verb: evt.tool_name, obj, st: '…', cls: 'run', detail: '', toolUseId: evt.tool_use_id, expand: EXPANDABLE.has(evt.tool_name) });
        sync();
        if (onAct && (evt.tool_name === 'Write' || evt.tool_name === 'Edit')) onAct({ verb: evt.tool_name, running: true });
        break;
      }
      case 'tool_done': {
        // 测试完成事件同样不依赖 cur.current（后台执行场景）
        if (onAct && TEST_TOOLS.has(evt.tool_name)) {
          const done = evt.tool_name === 'test_report';
          onAct({ verb: 'test', tool: evt.tool_name, obj: '', running: !done, done });
        }
        if (!cur.current) break;
        const act = cur.current.steps.find((s) => s.kind === 'act' && s.toolUseId === evt.tool_use_id);
        if (act) {
          const s = summarizeResult(evt.tool_name, evt.tool_result);
          act.st = s.st; act.cls = s.cls; act.detail = s.detail;
          act.expand = act.expand || s.cls === 'err' || !!(evt.tool_result && evt.tool_result.length > 40);
          const m = (evt.tool_result || '').match(/(?:已写入|已替换\s*\d+\s*处匹配\s*\()\s*([E-Za-z]:[^)\s]+)/);
          if (m) act.obj = m[1].replace(/^.*[\\/]([^\s]+)$/, '$1');
          else if ((evt.tool_result || '').startsWith('$ ')) act.obj = (evt.tool_result.split('\n')[0].slice(2));
          if (onAct && (evt.tool_name === 'Write' || evt.tool_name === 'Edit')) {
            const full = (evt.tool_result || '').match(/([E-Za-z]:[\\/\w.\-\/]+)/);
            onAct({ verb: evt.tool_name, file: full ? full[1] : null, result: evt.tool_result });
          }
          if (onAct && s.isAnalyze) onAct({ verb: 'flutter', analyzeResult: evt.tool_result });
        }
        sync();
        break;
      }
      case 'permission_request': {
        setItems((arr) => [...arr, {
          id: nid(), type: 'approve',
          requestId: evt.request_id, sessionId: evt.session_id,
          toolName: evt.tool_name, toolInput: evt.tool_input, permission: evt.permission,
        }]);
        break;
      }
      case 'turn_complete': {
        // goagent 每轮模型响应都发 turn_complete（一次对话有 N 个），
        // 这里只刷新思考缓冲，不收尾 —— 真正的整轮结束是 done 事件
        if (!cur.current) break;
        flushThink();
        sync();
        break;
      }
      case 'done': {
        if (!cur.current) break;
        flushThink();
        cur.current.running = false;
        cur.current.title = sumBuf.current.trim().split('\n')[0].slice(0, 30) || cur.current.title;
        sync();
        cur.current = null; sumBuf.current = '';
        break;
      }
      case 'compaction': {
        setItems((arr) => [...arr, { id: nid(), type: 'sys', text: evt.text || '已压缩上下文' }]);
        break;
      }
      case 'usage': {
        if (onUsage && evt.usage) onUsage(evt.usage);
        break;
      }
      case 'error': {
        if (cur.current) { cur.current.running = false; sync(); cur.current = null; }
        setItems((arr) => [...arr, { id: nid(), type: 'sys', text: '⚠ ' + (evt.error || '引擎错误'), cls: 'err' }]);
        break;
      }
      default: break;
    }
  }, []); // 空依赖：所有可变状态走 ref，引用永远稳定

  const send = useCallback(async (message) => {
    if (!message.trim()) return;
    // busy 时也允许发（随时插话是设计特性）：goagent 单会话串行处理，
    // 插话会排队进同一会话；前端立即显示，SSE 事件由当前流继续驱动。
    if (busyRef.current) {
      setItems((arr) => [...arr, { id: nid(), type: 'user', text: message.trim() }]);
      window.amc.engine.chat({ message: message.trim(), sessionId: sessionIdRef.current })
        .catch((e) => console.error('[chat] 插话发送失败:', e));
      return;
    }
    setItems((arr) => [...arr, { id: nid(), type: 'user', text: message.trim() }]);
    cur.current = { id: nid(), type: 'turn', title: '执行中…', running: true, steps: [], sum: '' };
    sumBuf.current = ''; thinkBuf.current = ''; inThink.current = false;
    setItems((arr) => [...arr, cur.current]);
    setBusyBoth(true);

    const offBegin = window.amc.engine.onSseBegin(() => {});
    const offEvent = window.amc.engine.onSseEvent(handleEvent);
    const offErr = window.amc.engine.onSseError((e) => handleEvent({ type: 'error', error: String(e) }));
    let streamBroke = false; // SSE 流中断（非正常结束）→ 检查引擎侧任务是否还活着
    try {
      await window.amc.engine.chat({ message: message.trim(), sessionId: sessionIdRef.current });
    } catch (e) {
      streamBroke = true;
      handleEvent({ type: 'error', error: String(e) });
    } finally {
      offBegin(); offEvent(); offErr();
      if (cur.current) { cur.current.running = false; sync(); cur.current = null; }
      setBusyBoth(false);
      // 流断了但引擎任务可能还在跑（连接断 ≠ 任务死）：进入轮询跟踪模式，
      // 每 3s 拉会话状态和历史，任务结束时刷出完整结果
      if (streamBroke && sessionIdRef.current) {
        try {
          const r = await window.amc.engine.get('/sessions');
          const s = ((r && r.body) || []).find((x) => x.id === sessionIdRef.current);
          if (s && s.state === 'running') {
            setResumeState('running');
            resumeTimer.current = setInterval(async () => {
              try {
                const r2 = await window.amc.engine.get('/sessions');
                const s2 = ((r2 && r.body) || []).find((x) => x.id === sessionIdRef.current);
                const res = await window.amc.engine.get(`/sessions/${sessionIdRef.current}/messages`);
                if (res && res.body) setItems(historyToItems(res.body));
                if (!s2 || s2.state !== 'running') {
                  if (resumeTimer.current) { clearInterval(resumeTimer.current); resumeTimer.current = null; }
                  setResumeState(null);
                }
              } catch { /* 引擎暂不可达，下个周期再试 */ }
            }, 3000);
          }
        } catch { /* 状态查询失败：按已结束处理 */ }
      }
    }
  }, [handleEvent, sessionIdRef]);

  // 重开项目：恢复会话历史到对话流。sessionId 变化时调用。
  // 若会话仍在后台执行（前端刷新丢了 SSE 直播），进入轮询跟踪模式：
  // 引擎在整轮结束才落盘消息，轮询 /sessions 状态 + 历史，
  // 状态翻到 idle 后刷出完整结果并停止。
  // 恢复模式：null=正常 | 'running'=引擎仍在后台跑（轮询跟踪）
  // | 'interrupted'=上次进程被杀，任务中断在半路（可继续）
  const [resumeState, setResumeState] = useState(null);
  const resumeTimer = useRef(null);
  const restore = useCallback(async (sessionId) => {
    if (resumeTimer.current) { clearInterval(resumeTimer.current); resumeTimer.current = null; }
    setResumeState(null);
    if (!sessionId) { setItems([]); return; }

    const load = async () => {
      const res = await window.amc.engine.get(`/sessions/${sessionId}/messages`);
      const messages = (res && res.body) || [];
      setItems(historyToItems(messages));
      return messages;
    };
    try { await load(); } catch { setItems([]); return; }

    // 会话状态：running → 轮询跟踪；interrupted → 显示断点续传条
    try {
      const r = await window.amc.engine.get('/sessions');
      const s = ((r && r.body) || []).find((x) => x.id === sessionId);
      if (s && s.state === 'running') {
        setResumeState('running');
        resumeTimer.current = setInterval(async () => {
          try {
            const r2 = await window.amc.engine.get('/sessions');
            const s2 = ((r2 && r2.body) || []).find((x) => x.id === sessionId);
            await load();
            if (!s2 || s2.state !== 'running') {
              if (resumeTimer.current) { clearInterval(resumeTimer.current); resumeTimer.current = null; }
              setResumeState(null);
            }
          } catch { /* 引擎暂不可达（重启切换中），下个周期再试 */ }
        }, 3000);
      } else if (s && s.state === 'interrupted') {
        setResumeState('interrupted');
      }
    } catch { /* 状态不可得 → 只回放历史 */ }
  }, []);

  useEffect(() => () => { if (resumeTimer.current) clearInterval(resumeTimer.current); }, []);

  // 终止正在执行的任务（后台或当前直播中均可）
  const interrupt = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await window.amc.engine.post('/interrupt', { session_id: sid, reason: '用户请求终止' });
    } catch { /* 引擎可能刚好结束 */ }
    if (resumeTimer.current) { clearInterval(resumeTimer.current); resumeTimer.current = null; }
    setResumeState(null);
  }, [sessionIdRef]);

  const approve = useCallback(async (item, allow) => {
    await window.amc.engine.post('/approve', {
      request_id: item.requestId, session_id: item.sessionId || sessionIdRef.current,
      allow, always_allow: false,
    });
    setItems((arr) => arr.map((x) => x.id === item.id ? { ...x, resolved: allow ? 'approved' : 'denied' } : x));
  }, [sessionIdRef]);

  return { items, busy, send, approve, restore, resumeState, interrupt };
}
