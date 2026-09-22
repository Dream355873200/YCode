// 前端刷新总线：SSE 事件（tool_done 等）→ 相关面板按需拉一次数据。
// 事件驱动为主、慢速轮询兜底——总线只发「该刷新了」的信号，不传数据；
// 无事件时各面板退回低频轮询（间隔远大于原来的 2~8s）。
const subs = new Map(); // topic -> Set<fn>

export function emit(topic, arg) {
  const set = subs.get(topic);
  if (!set) return;
  for (const fn of set) {
    try { fn(arg); } catch { /* 单个订阅者异常不影响其他 */ }
  }
}

// on 订阅一组主题，返回取消函数（useEffect cleanup 直接用）。
export function on(topics, fn) {
  const list = Array.isArray(topics) ? topics : [topics];
  for (const t of list) {
    if (!subs.has(t)) subs.set(t, new Set());
    subs.get(t).add(fn);
  }
  return () => { for (const t of list) { const s = subs.get(t); if (s) s.delete(fn); } };
}

// debounce 尾沿去抖：工具批量完成时只触发最后一次拉取。
export function debounce(fn, ms = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// task 工具集 → 任务/问题面板
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'IssueReport']);
// 测试工具集 → 测试时间线（test-log）
const TEST_TOOLS = new Set(['ui_tree', 'tap', 'swipe', 'type', 'back', 'wait_for',
  'screenshot', 'screen_diff', 'logcat', 'net', 'test_report']);

// emitToolDone 把 tool_done 帧映射成面板刷新信号。tool_input 优先取
// file_path，取不到从 tool_result 里捞（与 TurnView 的提取逻辑同源）。
export function emitToolDone(evt) {
  const n = evt.tool_name || '';
  if (TASK_TOOLS.has(n)) emit('tasks');
  if (TEST_TOOLS.has(n)) emit('test-log');
  if (n === 'net' || n === 'logcat') emit('net-log');
  if (n === 'test_report') emit('report');
  if (n === 'EnterPlanMode' || n === 'ExitPlanMode') emit('plan');
  if (n === 'Write' || n === 'Edit') {
    let p = (evt.tool_input && evt.tool_input.file_path) || '';
    if (!p) {
      const m = (evt.tool_result || '').match(/([E-Za-z]:[\\/][^\s")]+)/);
      p = m ? m[1] : '';
    }
    emit('files', p);
    emit('tree'); // 文件树 NEW/MOD 徽标（git status 派生）
    if (/(^|[\\\/])SPEC\.md$/i.test(p)) emit('spec');
    if (/\.yume[\\\/]plans[\\\/]/i.test(p)) emit('plan');
  }
}
