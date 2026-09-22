// 对话流状态机：把 goagent SSE 事件流规约为 UI 条目序列
// 条目类型：user 气泡 / turn（思考块+行动+总结）/ approve 审批条 / sys 系统行
//
// 架构：直播状态放模块级 per-session store（不绑 React 组件生命周期）——
// 退出项目页面组件卸载后，SSE 事件继续流入 store 并持久化 localStorage；
// 重进项目瞬时拿到最新状态且直播续上。SSE 事件按 evt.session_id 路由，
// 多项目并行时各自会话的流互不串扰（旧引擎事件不带 session_id 时
// 兜底路由到最后发起 run 的会话）。
import { useCallback, useEffect, useState } from 'react';
import { emitToolDone } from './refreshBus.js';
import { actObj, summarizeResult, resolveRenderer } from './toolRender.jsx';

let idSeq = 0;
const nid = () => ++idSeq;
// 测试类工具（左栏测试状态卡的数据源）
const TEST_TOOLS = new Set([
  'ui_tree', 'tap', 'swipe', 'type', 'back', 'wait_for',
  'screenshot', 'screen_diff', 'logcat', 'net', 'vision_ask', 'test_report', 'patrol_dump',
]);

// stripReminderTags 剥 system-reminder 包装（goagent 统一提醒通道在
// 注入上下文的文本外打的标记）——展示层不显示标记，只显示提醒正文。
const stripReminderTags = (t) => String(t || '')
  .replace(/<\/?system-reminder[^>]*>/g, '')
  .trim();

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
      const shown = stripReminderTags(text);
      if (shown) items.push({ id: nid(), type: 'user', text: shown });
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
          let input = null;
          try { input = typeof b.input === 'string' ? JSON.parse(b.input) : b.input; } catch { /* ignore */ }
          const act = {
            kind: 'act', id: nid(), verb: b.name, input,
            obj: actObj(b.name, input), st: '…', cls: 'run', detail: '',
            toolUseId: b.id, expand: resolveRenderer(b.name).expandable,
          };
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

// ---------- 模块级 per-session 直播 store ----------

const stores = new Map(); // sessionId -> store
let busInstalled = false;
let lastRunSid = null; // 最近发起 run 的会话（旧引擎事件无 session_id 时兜底）

function getStore(sid) {
  let st = stores.get(sid);
  if (!st) {
    st = createStore(sid);
    stores.set(sid, st);
  }
  return st;
}

// ensureBus 安装全局 SSE 监听（进程生命周期内一次）。事件按 session_id
// 路由到对应 store——组件挂不挂载都无关，事件永远有人接。
function ensureBus() {
  if (busInstalled || typeof window === 'undefined' || !window.amc) return;
  busInstalled = true;
  window.amc.engine.onSseEvent((evt) => {
    if (!evt || !evt.type) return;
    const sid = evt.session_id || lastRunSid;
    if (!sid) return;
    if (evt.session_id) lastRunSid = evt.session_id;
    getStore(sid).handleEvent(evt);
  });
}

function createStore(sid) {
  const st = {
    sid,
    items: [],
    cur: null, // 进行中的 turn
    busy: false,
    // 流式解析状态（think 标签状态机）
    inThink: false,
    thinkCloseTag: '</think>',
    thinkBuf: '',
    sumBuf: '',
    thinkStart: 0,
    // 订阅与回调（挂载中的组件注册；未挂载时为空集，状态照常更新）
    subscribers: new Set(),
    actCbs: new Set(),
    usageCbs: new Set(),
    // 恢复状态：null=正常 | 'running'=引擎后台执行中（轮询跟踪）
    resumeState: null,
    resumeTimer: null,
    restored: false, // 是否已从 localStorage 恢复过
    lastPersist: 0,
  };

  st.notify = () => { for (const fn of st.subscribers) fn(); };
  st.persistNow = () => {
    try { localStorage.setItem('amc.chat.' + sid, JSON.stringify(st.items)); } catch { /* 满/不可用：引擎冷备份兜底 */ }
    st.lastPersist = Date.now();
  };
  // 流式高频更新节流落盘（text_delta 每 token 一次，不能每次都写）
  st.persistThrottled = () => {
    if (Date.now() - st.lastPersist > 800) st.persistNow();
  };
  // 离散更新（user 气泡/审批条/新 turn 壳）：立即落盘
  st.updateItems = (fn) => {
    st.items = typeof fn === 'function' ? fn(st.items) : fn;
    st.persistNow();
    st.notify();
  };
  // 流式同步（turn 内容更新）：节流落盘 + 通知
  st.sync = () => {
    const snap = st.cur;
    if (!snap) return;
    snap.sum = st.sumBuf;
    const i = st.items.findIndex((x) => x && x.id === snap.id);
    if (i >= 0) st.items = st.items.map((x, j) => j === i ? { ...snap, steps: [...snap.steps] } : x);
    st.persistThrottled();
    st.notify();
  };
  st.setBusy = (v) => { st.busy = v; st.notify(); };

  st.flushThink = () => {
    if (!st.cur) { st.thinkBuf = ''; st.inThink = false; return; }
    if (st.thinkBuf.trim()) {
      const body = st.thinkBuf.trim();
      // 按到达顺序推进 steps：思考块与工具调用交错呈现（真实执行序）
      st.cur.steps.push({
        kind: 'think',
        id: nid(),
        sum: body.split('\n')[0].slice(0, 40),
        body,
        secs: st.thinkStart ? ((Date.now() - st.thinkStart) / 1000).toFixed(1) + 's' : '',
      });
    }
    st.thinkBuf = '';
    st.inThink = false;
  };

  // pushCard 确认/问答卡入流：作为 turn 的 step 插入（按事件到达的真实时序，
  // 不会被后续思考/行动挤到界面底部）。batch=true 时聚合成队列卡——
  // 同批次（total 相同）的第 N 张卡在已存在队列卡未答完时替换其当前问题，
  // 已答的进历史。
  st.pushCard = (card, batch) => {
    if (!st.cur) {
      // run 已结束（恢复回放场景）：退化为顶层 item
      st.updateItems((arr) => [...arr, { ...card, type: card.kind }]);
      return;
    }
    if (batch) {
      // 找本 turn 里未完成的同批次队列卡
      const existing = st.cur.steps.find((s) => s.kind === 'confirm' && s.total === card.total && !s.resolved);
      if (existing && existing.index !== card.index) {
        // 新一张问题（引擎逐个发）→ 前一张已答（answerAsk 会先 resolve），
        // 队列卡推进到当前问题，历史保留在 answered 数组
        existing.index = card.index;
        existing.question = card.question;
        existing.mode = card.mode;
        existing.choices = card.choices;
        existing.detail = card.detail;
        existing.requestId = card.requestId; // 回传走当前问题的请求 ID
        existing.answeredCount = (existing.answeredCount || 0) + 1;
        st.sync();
        return;
      }
    }
    st.cur.steps.push(card);
    st.sync();
  };

  st.handleEvent = (evt) => {
    const onAct = (a) => { for (const fn of st.actCbs) fn(a); };
    const onUsage = (u) => { for (const fn of st.usageCbs) fn(u); };
    switch (evt.type) {
      case 'text_delta': {
        if (!st.cur) break;
        let text = evt.text || '';
        // 思考标签解析：<think>（DeepSeek 惯用）与 <thinking>（GLM/Qwen 惯用）
        while (text.length) {
          if (st.inThink) {
            const close = st.thinkCloseTag;
            const end = text.indexOf(close);
            if (end >= 0) {
              st.thinkBuf += text.slice(0, end);
              st.flushThink();
              text = text.slice(end + close.length);
            } else { st.thinkBuf += text; text = ''; }
          } else {
            let start = text.indexOf('<think>');
            let tagLen = 7;
            if (start < 0) { start = text.indexOf('<thinking>'); tagLen = 10; }
            if (start >= 0) {
              st.sumBuf += text.slice(0, start);
              st.inThink = true;
              st.thinkCloseTag = tagLen === 7 ? '</think>' : '</thinking>';
              st.thinkStart = Date.now();
              text = text.slice(start + tagLen);
            } else { st.sumBuf += text; text = ''; }
          }
        }
        st.sync();
        break;
      }
      case 'thinking': {
        if (!st.cur) break;
        // 注意：不动 inThink —— 那是 text_delta 里 <think> 标签解析器的状态；
        // 这里的 thinking 事件来自独立通道（reasoning_content），与正文流互不影响
        if (!st.thinkStart) st.thinkStart = Date.now();
        st.thinkBuf += evt.thinking || '';
        st.sync();
        break;
      }
      case 'tool_start': {
        if (TEST_TOOLS.has(evt.tool_name)) {
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
        if (!st.cur) break;
        st.flushThink();
        let input = null;
        try { input = typeof evt.tool_input === 'string' ? JSON.parse(evt.tool_input) : evt.tool_input; } catch { /* ignore */ }
        st.cur.steps.push({
          kind: 'act', id: nid(), verb: evt.tool_name, input,
          obj: actObj(evt.tool_name, input), st: '…', cls: 'run', detail: '',
          toolUseId: evt.tool_use_id, expand: resolveRenderer(evt.tool_name).expandable,
        });
        st.sync();
        if (evt.tool_name === 'Write' || evt.tool_name === 'Edit') onAct({ verb: evt.tool_name, running: true });
        break;
      }
      case 'tool_done': {
        // 面板刷新信号（事件驱动，面板轮询降级为慢速兜底）
        emitToolDone(evt);
        if (TEST_TOOLS.has(evt.tool_name)) {
          const done = evt.tool_name === 'test_report';
          onAct({ verb: 'test', tool: evt.tool_name, obj: '', running: !done, done });
        }
        if (!st.cur) break;
        const act = st.cur.steps.find((s) => s.kind === 'act' && s.toolUseId === evt.tool_use_id);
        if (act) {
          const s = summarizeResult(evt.tool_name, evt.tool_result);
          act.st = s.st; act.cls = s.cls; act.detail = s.detail;
          act.expand = act.expand || s.cls === 'err' || !!(evt.tool_result && evt.tool_result.length > 40);
          const m = (evt.tool_result || '').match(/(?:已写入|已替换\s*\d+\s*处匹配\s*\()\s*([E-Za-z]:[^)\s]+)/);
          if (m) act.obj = m[1].replace(/^.*[\\/]([^\s]+)$/, '$1');
          else if ((evt.tool_result || '').startsWith('$ ')) act.obj = (evt.tool_result.split('\n')[0].slice(2));
          if (evt.tool_name === 'Write' || evt.tool_name === 'Edit') {
            const full = (evt.tool_result || '').match(/([E-Za-z]:[\\/\w.\-\/]+)/);
            onAct({ verb: evt.tool_name, file: full ? full[1] : null, result: evt.tool_result });
          }
          if (s.isAnalyze) onAct({ verb: 'flutter', analyzeResult: evt.tool_result });
        }
        st.sync();
        break;
      }
      case 'permission_request': {
        st.updateItems((arr) => [...arr, {
          id: nid(), type: 'approve',
          requestId: evt.request_id, sessionId: evt.session_id || sid,
          toolName: evt.tool_name, toolInput: evt.tool_input, permission: evt.permission,
        }]);
        break;
      }
      case 'ask_user': {
        // 结构化载荷（evt.payload，协议 ask_user 帧）→ 确认卡；旧文本
        // 前缀协议（[confirm]{json}\n问题，历史会话回放）兜底解析；
        // 都不是 → 普通 AskUser 问答卡。
        // 卡片作为 turn 的 step 按到达顺序插入（和其他行动/思考一样的时序位置）；
        // 批量 confirm（index/total）→ 前端聚合成一张队列卡（1/N 逐张作答）。
        let q = evt.question || '';
        let payload = evt.payload || null;
        if (!payload) {
          const m = q.match(/^\[confirm\](\{.*?\})\n([\s\S]*)$/);
          if (m) {
            try { payload = JSON.parse(m[1]); } catch { /* 协议坏 → 退化为问答卡 */ }
            if (payload) q = m[2];
          }
        }
        if (payload && payload.kind !== 'ask') {
          const card = {
            kind: 'confirm', id: nid(),
            requestId: evt.request_id, sessionId: evt.session_id || sid,
            question: q, mode: payload.mode || 'single',
            choices: payload.choices || [], detail: payload.detail || '',
            index: payload.index || 0, total: payload.total || 0,
          };
          pushCard(st, card, payload.total > 1);
          break;
        }
        pushCard(st, {
          kind: 'ask', id: nid(),
          requestId: evt.request_id, sessionId: evt.session_id || sid,
          question: q,
        }, false);
        break;
      }
      case 'turn_complete': {
        // goagent 每轮模型响应都发 turn_complete（一次对话有 N 个），
        // 这里只刷新思考缓冲，不收尾 —— 真正的整轮结束是 done 事件
        if (!st.cur) break;
        st.flushThink();
        st.sync();
        break;
      }
      case 'done': {
        if (!st.cur) break;
        st.flushThink();
        st.cur.running = false;
        st.cur.title = st.sumBuf.trim().split('\n')[0].slice(0, 30) || st.cur.title;
        st.sync();
        st.persistNow(); // 整轮结束：最终状态立即落盘
        st.cur = null; st.sumBuf = '';
        break;
      }
      case 'progress': {
        // 带 status_key 的是状态行（如 429 重试倒计时）：按 key 原地更新，
        // Text 空 = 清除。不带 key 的退化为普通系统行。
        if (evt.status_key) {
          st.updateItems((arr) => {
            const i = arr.findIndex((x) => x.type === 'status' && x.key === evt.status_key);
            if (evt.text === '') {
              return i >= 0 ? arr.filter((_, j) => j !== i) : arr; // 清除
            }
            if (i >= 0) {
              const copy = [...arr];
              copy[i] = { ...copy[i], text: evt.text };
              return copy;
            }
            return [...arr, { id: nid(), type: 'status', key: evt.status_key, text: evt.text }];
          });
        }
        break;
      }
      case 'compaction': {
        st.updateItems((arr) => [...arr, { id: nid(), type: 'sys', text: evt.text || '已压缩上下文' }]);
        break;
      }
      case 'usage': {
        if (evt.usage) onUsage(evt.usage);
        break;
      }
      case 'error': {
        if (st.cur) { st.cur.running = false; st.sync(); st.persistNow(); st.cur = null; }
        st.updateItems((arr) => [...arr, { id: nid(), type: 'sys', text: '⚠ ' + (evt.error || '引擎错误'), cls: 'err' }]);
        break;
      }
      case 'steer': {
        // 插话/排队/系统注入进入模型上下文（goagent EventSteer）。
        // 渲染为用户气泡：插话按钮路径前端已本地推过同文气泡——只与
        // 最后一条 user 气泡比对去重（中间隔了新消息就照常渲染）。
        // 协议层统一打 system-reminder 标记（source=steer），展示层剥壳。
        const text = stripReminderTags(evt.text || '');
        if (!text) break;
        let dup = false;
        for (let i = st.items.length - 1; i >= 0; i--) {
          const x = st.items[i];
          if (x.type === 'user') { dup = x.text === text; break; }
          if (x.type === 'turn') break; // 隔了一轮执行 → 不会是同一条
        }
        if (!dup) st.updateItems((arr) => [...arr, { id: nid(), type: 'user', text }]);
        break;
      }
      case 'interrupted': {
        // 用户主动终止（⏹ 按钮 → POST /interrupt）——goagent 一等事件，
        // 与引擎错误分家：清运行态 + 中性「已停止」提示（非报错样式）。
        if (st.cur) { st.cur.running = false; st.sync(); st.persistNow(); st.cur = null; }
        st.updateItems((arr) => [...arr, { id: nid(), type: 'sys', text: '⏹ ' + (evt.text || '已停止') }]);
        break;
      }
      default: break;
    }
  };

  // ---- 后台跟踪（应用重启/SSE 断流后引擎任务仍在跑）----
  st.stopResumePoll = () => {
    if (st.resumeTimer) { clearInterval(st.resumeTimer); st.resumeTimer = null; }
    st.resumeState = null;
    st.notify();
  };
  st.startResumePoll = () => {
    if (st.resumeTimer) return;
    st.resumeState = 'running';
    st.notify();
    st.resumeTimer = setInterval(async () => {
      try {
        const r2 = await window.amc.engine.get('/sessions');
        const s2 = ((r2 && r2.body) || []).find((x) => x.id === sid);
        // 引擎侧消息是唯一真源（localStorage 没人更新了）
        const res = await window.amc.engine.get(`/sessions/${sid}/messages`);
        if (res && res.body) {
          st.items = historyToItems(res.body);
          st.persistNow();
          st.notify();
        }
        if (!s2 || s2.state !== 'running') st.stopResumePoll();
      } catch { /* 引擎暂不可达，下个周期再试 */ }
    }, 3000);
  };

  // ask_user/confirm 回答提交：POST /askuser → 卡片状态更新。
  // 队列卡（total>1 且还有后续）答完当前题 → 答案进 history、保持未落定
  //（引擎会发下一张卡推进 index）；最后一张答完 → 卡片落定。
  st.answerAsk = async (itemId, requestId, answerText) => {
    try {
      await window.amc.engine.post('/askuser', { request_id: requestId, answer: answerText });
    } catch (e) {
      console.error('[ask] 回传失败:', e);
    }
    const apply = (x) => {
      if (x.id !== itemId) return x;
      if (x.total > 1 && x.index < x.total) {
        // 队列推进：当前题进 history，等待引擎发下一张（pushCard 接手）
        return { ...x, history: [...(x.history || []), { question: x.question, answer: answerText }] };
      }
      return { ...x, resolved: true, answer: answerText };
    };
    // 卡片在 turn.steps 里（常见）或顶层 items（回放退化路径），两处都更新
    st.updateItems((arr) => arr.map((it) => {
      if (it && it.type === 'turn' && Array.isArray(it.steps)) {
        const i = it.steps.findIndex((s) => s && s.id === itemId);
        if (i >= 0) {
          const steps = [...it.steps];
          steps[i] = apply(steps[i]);
          return { ...it, steps };
        }
      }
      return apply(it);
    }));
  };

  // ---- 恢复：localStorage 瞬时 + 引擎历史校正（旧缓存可能缺尾巴）----
  st.refresh = async () => {    if (!st.restored) {
      st.restored = true;
      try {
        const raw = localStorage.getItem('amc.chat.' + sid);
        const cached = raw ? JSON.parse(raw) : null;
        if (cached && Array.isArray(cached) && cached.length) st.items = cached;
      } catch { /* localStorage 不可读 */ }
      st.notify();
    }
    // 引擎历史比本地长 → 本地缓存是旧的（流断/异常退出没写全），用引擎版本
    try {
      const res = await window.amc.engine.get(`/sessions/${sid}/messages`);
      const engineItems = historyToItems((res && res.body) || []);
      if (engineItems.length > st.items.length) {
        st.items = engineItems;
        st.persistNow();
        st.notify();
      }
    } catch { /* 引擎不可达（启动窗口期）：先用本地缓存 */ }
    // 会话在引擎侧还在跑（应用重启过的场景）→ 轮询跟踪
    try {
      const r = await window.amc.engine.get('/sessions');
      const s = ((r && r.body) || []).find((x) => x.id === sid);
      if (s && s.state === 'running') st.startResumePoll();
      else if (st.resumeTimer) st.stopResumePoll();
    } catch { /* 状态不可得 → 只回放历史 */ }
  };

  return st;
}

// ---------- React hook：订阅模块级 store ----------

export function useChat({ onUsage, onAct, sessionIdRef, sessionId }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [resumeState, setResumeState] = useState(null);

  // 回调注册进 store（事件来时 store 直接调，不经 React state）
  useEffect(() => {
    if (!sessionId) return;
    const st = getStore(sessionId);
    const act = (a) => onAct && onAct(a);
    const usage = (u) => onUsage && onUsage(u);
    st.actCbs.add(act);
    st.usageCbs.add(usage);
    return () => { st.actCbs.delete(act); st.usageCbs.delete(usage); };
  }, [sessionId, onUsage, onAct]);

  // 订阅当前会话的 store：sessionId 变化即切换订阅
  useEffect(() => {
    if (!sessionId) { setItems([]); setBusy(false); setResumeState(null); return; }
    ensureBus();
    const st = getStore(sessionId);
    const fn = () => { setItems(st.items); setBusy(st.busy); setResumeState(st.resumeState); };
    st.subscribers.add(fn);
    fn(); // 立即同步一次
    return () => { st.subscribers.delete(fn); };
  }, [sessionId]);

  // 重进项目：恢复历史 + 检查引擎侧是否仍在跑
  const restore = useCallback(async (sid) => {
    if (!sid) return;
    ensureBus();
    await getStore(sid).refresh();
  }, []);

  const send = useCallback(async (message) => {
    const sid = sessionIdRef && sessionIdRef.current;
    if (!sid || !message || !message.trim()) return;
    const st = getStore(sid);
    lastRunSid = sid;
    // busy 时也允许发（随时插话是设计特性）：goagent 单会话串行处理，
    // 插话排队进同一会话；前端立即显示，事件由模块总线继续驱动。
    if (st.busy) {
      st.updateItems((arr) => [...arr, { id: nid(), type: 'user', text: message.trim() }]);
      window.amc.engine.chat({ message: message.trim(), sessionId: sid })
        .catch((e) => console.error('[chat] 插话发送失败:', e));
      return;
    }
    st.updateItems((arr) => [...arr, { id: nid(), type: 'user', text: message.trim() }]);
    st.cur = { id: nid(), type: 'turn', title: '执行中…', running: true, steps: [], sum: '' };
    st.sumBuf = ''; st.thinkBuf = ''; st.inThink = false;
    st.updateItems((arr) => [...arr, st.cur]);
    st.setBusy(true);

    let streamBroke = false;
    try {
      await window.amc.engine.chat({ message: message.trim(), sessionId: sid });
    } catch (e) {
      streamBroke = true;
      st.handleEvent({ type: 'error', error: String(e) });
    } finally {
      // 注：send 的闭包在组件卸载后仍会走到这里（async 不随 unmount 死亡），
      // store 是模块级的，收尾照常生效
      if (st.cur) { st.cur.running = false; st.sync(); st.persistNow(); st.cur = null; }
      st.setBusy(false);
      // 流断了但引擎任务可能还在跑（连接断 ≠ 任务死）：轮询跟踪
      if (streamBroke) {
        try {
          const r = await window.amc.engine.get('/sessions');
          const s = ((r && r.body) || []).find((x) => x.id === sid);
          if (s && s.state === 'running') st.startResumePoll();
        } catch { /* 查询失败：按已结束处理 */ }
      }
    }
  }, [sessionIdRef]);

  // 终止正在执行的任务（后台或当前直播中均可）
  const interrupt = useCallback(async () => {
    const sid = sessionIdRef && sessionIdRef.current;
    if (!sid) return;
    try {
      await window.amc.engine.post('/interrupt', { session_id: sid, reason: '用户请求终止' });
    } catch { /* 引擎可能刚好结束 */ }
    getStore(sid).stopResumePoll();
  }, [sessionIdRef]);

  const approve = useCallback(async (item, allow) => {
    const sid = sessionIdRef && sessionIdRef.current;
    await window.amc.engine.post('/approve', {
      request_id: item.requestId, session_id: item.sessionId || sid,
      allow, always_allow: false,
    });
    if (sid) {
      getStore(sid).updateItems((arr) => arr.map((x) => x.id === item.id ? { ...x, resolved: allow ? 'approved' : 'denied' } : x));
    }
  }, [sessionIdRef]);

  // ask_user/confirm 回答（卡片 onAnswer）：路由到条目所属会话的 store。
  // 条目自带 sessionId（多项目并行时回答可能来自非当前项目的历史回放）。
  const answerAsk = useCallback(async (item, answerText) => {
    const st = getStore(item.sessionId || (sessionIdRef && sessionIdRef.current));
    if (st && st.answerAsk) await st.answerAsk(item.id, item.requestId, answerText);
  }, [sessionIdRef]);

  return { items, busy, send, approve, restore, resumeState, interrupt, answerAsk };
}
