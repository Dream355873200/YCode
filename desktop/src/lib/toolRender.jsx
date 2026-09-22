// toolRender.jsx — 工具卡片分发渲染器注册表
// 对话行动条目（ActView）是骨架组件：按工具名 resolve 出渲染器，
// 每种工具自带「人话动词 / 对象摘要 / 状态摘要 / 展开细节」。
// 新工具只需在 TOOL_RENDERERS 注册一条，对话流/状态行自动升级。
import { diffLines, highlightLines, langOf } from './codediff.js';
import { TOOL_LABELS, testLogArg } from './toolLang.js';

const base = (p) => String(p || '').split(/[\\/]/).pop();

// ---------- 展开细节组件 ----------

// 纯文本输出（Bash/flutter 等命令类工具的输出尾）
function RawPre({ act }) {
  return act.detail ? <pre className="a-raw">{act.detail}</pre> : null;
}

// Edit：old_string/new_string 行级 diff（绿增红删 + 语法高亮，复用直播的 .cl 行样式）
function DiffDetail({ act }) {
  const i = act.input || {};
  if (!i.old_string && !i.new_string) return <RawPre act={act} />;
  const lang = langOf(i.file_path);
  const rows = diffLines(i.old_string || '', i.new_string || '');
  return (
    <div className="a-detail-code">
      {rows.slice(-400).map((r, k) => (
        <div key={k} className={'cl' + (r.type === 'add' ? ' cl-add' : r.type === 'del' ? ' cl-del' : '')}>
          <span className="cl-sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}</span>
          <code dangerouslySetInnerHTML={{ __html: highlightLines(r.text || ' ', lang)[0] }} />
        </div>
      ))}
      {rows.length > 400 && <div className="a-more">…（仅显示最后 400 行 diff）</div>}
    </div>
  );
}

// Write：新文件内容预览（行号 + 高亮，超长截断）
function WriteDetail({ act }) {
  const i = act.input || {};
  const content = String(i.content || act.detail || '');
  const lang = langOf(i.file_path);
  const lines = content.split('\n');
  const cap = 200;
  return (
    <div className="a-detail-code">
      {lines.slice(0, cap).map((l, k) => (
        <div key={k} className="cl">
          <span className="cl-no">{k + 1}</span>
          <code dangerouslySetInnerHTML={{ __html: highlightLines(l || ' ', lang)[0] }} />
        </div>
      ))}
      {lines.length > cap && <div className="a-more">…（其余 {lines.length - cap} 行省略）</div>}
    </div>
  );
}

// Bash/Git/flutter：命令行 + 输出
function CmdDetail({ act }) {
  const i = act.input || {};
  const cmd = i.command || i.cmd || (i.action ? `flutter ${i.action}` : '');
  return (
    <div className="a-detail-code">
      {cmd && <div className="a-cmd">$ {cmd}</div>}
      <RawPre act={act} />
    </div>
  );
}

// 测试工具：入参键值 + 设备回执
function TestDetail({ act }) {
  const i = act.input || {};
  const args = Object.entries(i)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 6)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v)}`)
    .join('  ');
  return (
    <div className="a-detail-code">
      {args && <div className="a-cmd">{args}</div>}
      <RawPre act={act} />
    </div>
  );
}

// ---------- 状态摘要 ----------

const flutterSt = (r = '') => {
  const hasErr = /error\s+-|^\s*\d+\s*error/i.test(r);
  if (/No issues found!/i.test(r)) return { st: 'No issues', cls: 'ok' };
  if (hasErr) return { st: 'error', cls: 'err' };
  const issues = r.match(/(\d+)\s*issues? found/i);
  if (issues) return { st: `${issues[1]} issues`, cls: 'warn' };
  return { st: '✓', cls: 'ok' };
};

// ---------- 注册表 ----------

// 每条目可选字段：
//   label      人话动词（行动条目 + 状态行共用；缺省原样显示工具名）
//   obj(i)     入参 → 一行对象摘要
//   st(r)      结果 → { st, cls }（缺省走通用推断）
//   expandable 是否默认可展开
//   Detail     展开细节组件（缺省 <pre> 原始结果）
export const TOOL_RENDERERS = {
  Edit: {
    label: '✏️ 修改了', expandable: true, Detail: DiffDetail,
    obj: (i = {}) => base(i.file_path || i.path),
    st: (r = '') => {
      const m = r.match(/已替换\s*(\d+)\s*处匹配\s*\(([^)]+)\)/);
      return m ? { st: `✓ ${m[1]} 处`, cls: 'ok' } : null;
    },
  },
  Write: {
    label: '📝 创建了', expandable: true, Detail: WriteDetail,
    obj: (i = {}) => base(i.file_path || i.path),
    st: (r = '') => {
      const m = r.match(/已写入\s+(\S+)/);
      if (!m) return null;
      const lines = (r.match(/\((\d+)\s*行/) || [])[1];
      return { st: '✓' + (lines ? ` +${lines} 行` : ''), cls: 'ok' };
    },
  },
  Read: { label: '📖 查看了', expandable: true, obj: (i = {}) => base(i.file_path || i.path) },
  Bash: { label: '⚙️ 执行命令', expandable: true, Detail: CmdDetail, obj: (i = {}) => String(i.command || i.cmd || '').slice(0, 60) },
  Shell: { label: '⚙️ 执行命令', expandable: true, Detail: CmdDetail, obj: (i = {}) => String(i.command || i.cmd || '').slice(0, 60) },
  flutter: { label: '🛠️ 构建应用', expandable: true, Detail: CmdDetail, obj: (i = {}) => (i.action ? `flutter ${i.action}` : ''), st: flutterSt },
  Git: { label: '💾 保存版本', expandable: true, Detail: CmdDetail, obj: (i = {}) => String(i.command || '').slice(0, 60) },
  Glob: { label: '🔍 查找文件', expandable: true, obj: (i = {}) => i.pattern },
  Grep: { label: '🔍 搜索代码', expandable: true, obj: (i = {}) => i.query || i.pattern },
  TaskCreate: { label: '📋 记录任务', obj: (i = {}) => i.subject },
  TaskUpdate: { label: '📋 更新任务', obj: (i = {}) => i.subject || i.task_id },
  TaskList: { label: '📋 查看任务' },
  TaskGet: { label: '📋 查看任务', obj: (i = {}) => i.task_id },
  IssueReport: { label: '⚠️ 记录问题', obj: (i = {}) => String(i.title || i.description || '').slice(0, 24) },
  IssueResolve: { label: '✔️ 解决问题', obj: (i = {}) => i.issue_id },
  Skill: { label: '📖 调用技能', obj: (i = {}) => i.name || i.skill },
  EnterPlanMode: { label: '🧭 进入规划' },
  ExitPlanMode: { label: '🧭 提交方案' },
  test_report: { label: '📱 生成测试报告', expandable: true, Detail: TestDetail },
};

// 测试工具（AI 操作 App 的每一步）批量注册：对象摘要沿用测试时间线的
// 参数提取（testLogArg），保证对话流与左栏时间线说法一致。
for (const [k, v] of Object.entries(TOOL_LABELS)) {
  TOOL_RENDERERS[k] = {
    label: '📱 ' + v, expandable: true, Detail: TestDetail,
    obj: (i = {}) => testLogArg({ input: i }),
  };
}

const DEFAULT_RENDERER = { expandable: false };

// resolveRenderer 按工具名取渲染器；未注册工具走默认骨架（原样工具名 +
// 通用状态推断 + <pre> 细节）。
export function resolveRenderer(name) {
  return TOOL_RENDERERS[name] || DEFAULT_RENDERER;
}

// actObj 工具入参 → 一行对象摘要（注册表 obj 优先，通用兜底链次之）。
export function actObj(name, input) {
  const i = input || {};
  const v = resolveRenderer(name).obj && resolveRenderer(name).obj(i);
  if (v) return String(v);
  if (i.file_path) return base(i.file_path);
  if (i.path) return base(i.path);
  if (i.pattern) return i.pattern;
  if (i.command) return i.command;
  if (i.cmd) return i.cmd;
  if (i.query) return i.query;
  if (i.action) return `flutter ${i.action}`;
  return '';
}

// summarizeResult 工具结果 → { st, cls, detail }（注册表 st 优先，通用推断兜底）。
// isAnalyze：flutter 结果驱动工作台的 analyze 横幅（宿主 onAct 联动用）。
export function summarizeResult(toolName, result) {
  if (!result) return { st: '', cls: 'run', detail: '' };
  const r = resolveRenderer(toolName);
  const s = r.st && r.st(result);
  if (s) return { ...s, detail: result, isAnalyze: toolName === 'flutter' };
  if (result.includes('退出码非零') || result.includes('error') || result.includes('失败')) return { st: '✗', cls: 'err', detail: result };
  if (result.startsWith('(无匹配') || result.startsWith('(无输出')) return { st: '✓', cls: 'ok', detail: result };
  const n = result.match(/\((\d+)\s*个文件\)/);
  if (n) return { st: `${n[1]} 文件`, cls: 'ok', detail: result };
  return { st: '✓', cls: 'ok', detail: result };
}

// actVerbPlain 状态行用的人话动词（剥 emoji 与「了」尾）：
// 「✏️ 修改了」→「修改」，拼进「正在 …」。
export function actVerbPlain(name) {
  const label = resolveRenderer(name).label;
  if (!label) return name;
  return label.replace(/^[^一-龥]+/, '').replace(/了$/, '');
}

// toolStats 编辑/写入工具的 ± 行数统计（卡片头部的 +N −N 徽标）。
// Edit 由 old/new 的行级 diff 计数；Write 统计新内容行数。其余工具返回 null。
export function toolStats(name, input) {
  if (input == null || typeof input !== 'object') return null;
  if (name === 'Edit' && (input.old_string != null || input.new_string != null)) {
    const rows = diffLines(String(input.old_string || ''), String(input.new_string || ''));
    let add = 0, del = 0;
    for (const r of rows) {
      if (r.type === 'add') add++;
      else if (r.type === 'del') del++;
    }
    if (!add && !del) return null;
    return { add, del };
  }
  if (name === 'Write' && typeof input.content === 'string') {
    const n = input.content ? input.content.split('\n').length : 0;
    return n > 0 ? { add: n, del: 0 } : null;
  }
  return null;
}
