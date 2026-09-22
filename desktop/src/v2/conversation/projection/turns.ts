// turns.ts — 轮级折叠：把 row 流折叠成「轮」渲染单元（纯函数，可测试）。
// 对齐成熟客户端的对话呈现约定：一轮 = 可见用户输入 + 可折叠工作段
// （思考/正文/工具按到达顺序交错）+ 轮尾最终回答。
import type { Row } from './rows';

/** 一个渲染单元（时间线的最小呈现块）。 */
export type TurnUnit =
  | { type: 'user'; id: string; text: string; steered?: boolean }
  | {
    type: 'turn'; id: string; rows: Row[]; visibleRows: Row[]; work: WorkSummary; tail: Row[];
    /** 异常收尾（出错/中断通知）：工作段保持展开，直播中的内容不折没。 */
    aborted: boolean;
  };

/** 工作段聚合信息。 */
export interface WorkSummary {
  toolCount: number;
  runningTools: number;
  errorTools: number;
  reasoningCount: number;
}

/** 判断 row 是否属于「工作段」（可折叠，非最终回答）。 */
function isWorkRow(r: Row): boolean {
  return r.kind === 'tool' || r.kind === 'reasoning';
}

export function summarizeWork(rows: readonly Row[]): WorkSummary {
  const s: WorkSummary = { toolCount: 0, runningTools: 0, errorTools: 0, reasoningCount: 0 };
  for (const r of rows) {
    if (r.kind === 'tool') {
      s.toolCount++;
      if (r.state === 'running') s.runningTools++;
      else if (r.state === 'err') s.errorTools++;
    } else if (r.kind === 'reasoning') {
      s.reasoningCount++;
    }
  }
  return s;
}

/**
 * 折叠 row 流为渲染单元。规则：
 * - user row 开新轮（steered 插话同属一轮的开头——它是对用户可见的输入）；
 * - 一轮 = 工作段 + 轮尾，切分点 = 最后一个工作行（工具/思考）：
 *   其之前的一切（含中途的正文流）按到达顺序交错进工作段——正文与思考、
 *   工具在段内按时间顺序直播呈现；其之后的是轮尾（最终正文 + 交互卡/通知）。
 *   正文归属由位置决定：后面还会干活 → 段内；后面没有活 → 轮尾最终回答。
 * - status 瞬时 UI（倒计时/重试提示）不折进单元；空的思考块被过滤。
 */
export function foldTurns(rows: readonly Row[]): TurnUnit[] {
  const units: TurnUnit[] = [];
  let cur: Extract<TurnUnit, { type: 'turn' }> | null = null;

  // 第一遍：按轮收拢原始行（切分依赖「最后一个工作行」这个后视信息，
  // 无法在单遍遍历里就地决定，收尾时统一切分）。
  // 用户行后立即建空工作单元（eager）：运行计时要从消息发出那刻就可见，
  // 不能等首个思考/正文帧到达才挂载（模型首 token 前有数秒空窗）。
  for (const r of rows) {
    if (r.kind === 'user') {
      units.push({ type: 'user', id: r.id, text: r.text, steered: r.steered });
      cur = { type: 'turn', id: `turn-${units.length}`, rows: [], visibleRows: [], work: { toolCount: 0, runningTools: 0, errorTools: 0, reasoningCount: 0 }, tail: [], aborted: false };
      units.push(cur);
      continue;
    }
    if (r.kind === 'status') {
      // 状态行是瞬时 UI（倒计时/重试提示），不折进工作段——由时间线
      // 组件按 key 原地渲染，避免折叠单元里出现已清除的行。
      continue;
    }
    if (!cur) {
      // 无对应用户行的孤儿输出（回放边界等）：就地建单元收容
      cur = { type: 'turn', id: `turn-${units.length}`, rows: [], visibleRows: [], work: { toolCount: 0, runningTools: 0, errorTools: 0, reasoningCount: 0 }, tail: [], aborted: false };
      units.push(cur);
    }
    cur.rows.push(r);
  }

  // 第二遍：切分工作段 / 轮尾；并识别异常收尾。
  for (const u of units) {
    if (u.type !== 'turn') continue;
    const keep = (r: Row): boolean => !(r.kind === 'reasoning' && !r.text.trim());
    let lastWork = -1;
    for (let i = 0; i < u.rows.length; i++) {
      const r = u.rows[i]!;
      if (isWorkRow(r) && keep(r)) lastWork = i;
    }
    u.visibleRows = u.rows.slice(0, lastWork + 1).filter(keep);
    u.tail = u.rows.slice(lastWork + 1);
    u.work = summarizeWork(u.visibleRows);
    // 异常收尾判定：轮内最后到达的是出错/停止通知（正常 done 不落行）。
    // 这类轮次没有「最终正文」，收起工作段等于把已直播的内容藏掉——
    // 展示层保持展开，之前的过程内容原样可见。
    const lastRow = u.rows[u.rows.length - 1];
    u.aborted = !!lastRow && lastRow.kind === 'notice' && lastRow.tone !== 'info';
  }
  return units;
}
