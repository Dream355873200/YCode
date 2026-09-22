// toolLang.js — 测试工具的人话翻译（左栏测试时间线 / 测试横幅专用）。
// 对话流的人话动词/对象摘要/展开细节在 toolRender.jsx 注册表（本文件的
// TOOL_LABELS 被其引用，保证两处说法一致）；本文件只保留测试时间线视角。

// 测试工具名 → 人话（测试时间线 / 测试横幅）
export const TOOL_LABELS = {
  ui_tree: '读取界面结构', tap: '点击屏幕', swipe: '滑动屏幕', type: '输入文本',
  back: '按返回键', wait_for: '等待页面元素', screenshot: '截取屏幕', screen_diff: '对比截图',
  logcat: '查设备日志', net: '网络联调', vision_ask: '视觉判断', test_report: '生成测试报告',
};

// testLogArg 从工具入参提取「意图」摘要（测试时间线每步的参数列）。
export function testLogArg(s) {
  const i = s.input || {};
  if (i.x !== undefined && i.y !== undefined) return `(${i.x},${i.y})`;
  if (i.x1 !== undefined) return `(${i.x1},${i.y1})→(${i.x2},${i.y2})`;
  if (i.text) return `"${String(i.text).slice(0, 16)}"`;
  if (i.text_to) return `"${String(i.text_to).slice(0, 16)}"`;
  if (i.title) return String(i.title).slice(0, 16);
  if (i.before && i.after) return '前后对比';
  if (i.action) return String(i.action);
  if (i.tag) return `tag=${i.tag}`;
  if (i.grep) return `/${String(i.grep).slice(0, 14)}/`;
  if (i.stable) return '等稳定';
  return '';
}
