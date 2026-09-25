// Timeline — 时间线：rows → foldTurns → 渲染单元流。
// 内容居中列（max-width），左缘轮次轨（minimap 语义），底部工作计时。
// 贴底跟随状态机（scrollAnchor 纯函数）：following 时内容追加自动滚底，
// 用户上滚脱离、滚回底部恢复、detached 显示「回到底部」浮标。
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { pendingBackgroundAgents, type Row } from './projection/rows';
import { foldTurns, type TurnUnit } from './projection/turns';
import {
  onUserScroll, shouldAutoScroll, showJumpBack, resetAnchor, type AnchorState,
} from './projection/scrollAnchor';
import { RowView, foldReads, ReadGroup } from './RowView';
import { useConversation } from './store';
import { Collapse } from '../components/ui/collapse';

function TurnBlock({ unit, sid, live }: { unit: Extract<TurnUnit, { type: 'turn' }>; sid: string; live?: boolean }) {
  const { work, tail } = unit;
  // 运行中判定取「本单元是最后一轮 && 会话 busy」，不用 runningTools——
  // 模型流式输出/思考期间 runningTools 归零，会让头部在「计时 ↔ 摘要」
  // 之间来回跳。整轮结束后才切到摘要展示。
  const running = !!live;
  // 异常收尾（出错/中断）：没有「最终正文」可留——保持展开，之前直播
  // 着的过程内容原样保留，不允许收起把它藏掉。
  const aborted = unit.aborted;
  const expanded = running || aborted;
  const hasWork = work.toolCount > 0 || work.reasoningCount > 0;
  // 工作段展开状态：运行中/异常收尾强制展开（内容在段内按时间交错直播，
  // 不可收起）；正常完成后收起，只留轮尾最终正文 + 摘要行；用户手动展开
  // 历史轮次后不抢
  const [manual, setManual] = useState<boolean | null>(null);
  const open = expanded ? true : (manual ?? false);
  // 用户正在悬停阅读工作段时，回合完成不自动收起——「在看的内容不被折叠」：
  // 完成瞬间若鼠标在块内，转为用户手动展开（此后由用户自己收起）。
  const hoverRef = useRef(false);
  const runningPrev = useRef(running);
  useEffect(() => {
    if (runningPrev.current && !running && !aborted && hoverRef.current) {
      setManual(true);
    }
    runningPrev.current = running;
  }, [running, aborted]);

  // 工作计时：起点用 store 的 runStartedAt（跨会话切换持久，切回续算不归零）；
  // 运行中每秒跳动，轮次结束后冻结；历史轮次不显示秒数
  const runStartedAt = useConversation((s) => s.sessions[sid]?.runStartedAt ?? null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !runStartedAt) return;
    setElapsed(Math.max(1, Math.floor((Date.now() - runStartedAt) / 1000)));
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - runStartedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running, runStartedAt]);

  const summary = [
    work.toolCount > 0 ? `${work.toolCount} 个操作` : '',
    work.reasoningCount > 0 ? `${work.reasoningCount} 次思考` : '',
    work.errorTools > 0 ? `${work.errorTools} 个失败` : '',
  ].filter(Boolean).join(' · ');

  // 运行中/异常收尾：轮尾（流式正文/交互卡/通知行）也并入段内直播——
  // 正文在段内长出来；正常完成后拆出轮尾（工作段收起，只留最终正文 + 摘要行）
  const bodyRows = expanded ? [...unit.visibleRows, ...unit.tail] : unit.visibleRows;
  const showBody = open && (hasWork || running || aborted);
  
  return (
    <div className="my-1" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 600px' }}
      onMouseEnter={() => { hoverRef.current = true; }}
      onMouseLeave={() => { hoverRef.current = false; }}>
      {(hasWork || running) && (
        <div className="mb-0.5">
          <button type="button" onClick={() => { if (!running && !aborted) setManual(!open); }}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-ui-xs text-foreground-subtlest hover:bg-hover">
            {!expanded && <span className={`inline-block transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▸</span>}
            <span>工作过程</span>
            {running ? (
              <>
                <span className="font-mono tabular-nums text-foreground-subtle">{fmtDur(elapsed)}</span>
                {/* 呼吸灯（不用旋转 spinner）：与思考直播同语言的活跃指示 */}
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />
              </>
            ) : (
              summary && <span className="text-foreground-subtlest">· {summary}</span>
            )}
          </button>
        </div>
      )}
      <Collapse open={showBody} className={`mt-0.5 pt-1 ${hasWork ? 'border-t border-border' : ''}`}>
        {foldReads(bodyRows).map((r) =>
          r.kind === 'readgroup' ? (
            <ReadGroup key={r.id} group={r} />
          ) : (
            <RowView key={r.id} row={r as Row} sid={sid}
              liveThinking={r.kind === 'reasoning' && r.id === bodyRows[bodyRows.length - 1]?.id && running} />
          )
        )}
        <div className="h-1.5" />
      </Collapse>
      {!expanded && tail.map((r) => <RowView key={r.id} row={r} sid={sid} />)}
    </div>
  );
}

/** 轮次导航（左缘竖向轨道，每轮一个横向 tick）。
 * tick 组从轨道中部向两端生长：轮次少时聚拢在中间（固定小间距），
 * 轮次多到放不下才压缩间距、最终铺满轨道。当前位置的 tick 只「点亮」
 * （白色，尺寸不变）；鼠标触发时左端固定、向右伸展（白色点亮），
 * 悬停弹出该轮的用户输入 + agent 回复摘要，点击平滑滚到该轮。 */
function TurnRail({ turns, containerRef, onJump }: {
  turns: { id: string; title: string; reply: string }[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  onJump: (id: string) => void;
}) {
  const [active, setActive] = useState(-1);
  const [hover, setHover] = useState(-1);
  const railRef = useRef<HTMLDivElement>(null);
  const [railH, setRailH] = useState(0);

  // 轨道高度测量（tick 用像素定位，组从中部生长）
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const measure = () => setRailH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 当前轮次高亮：视口 35% 高度线以上最近的轮次。
  // rAF 节流：滚动高频触发，逐轮 getElementById+getBoundingClientRect
  // 是布局抖动，消息多时是缩放/滚动卡顿的元凶之一。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || turns.length === 0) return;
    let raf = 0;
    const compute = () => {
      raf = 0;
      const line = el.scrollTop + el.clientHeight * 0.35;
      let a = -1;
      turns.forEach((t, i) => {
        const node = document.getElementById(`turn-${t.id}`);
        if (!node) return;
        const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
        if (top >= 0 && top <= line) a = i;
      });
      setActive(a);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(compute); };
    el.addEventListener('scroll', onScroll, { passive: true });
    compute();
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [turns, containerRef]);

  if (turns.length === 0) return null;
  const n = turns.length;
  // tick 间距：固定 10px；放不下时压缩到最小 6px 并转为可滚动列表
  //（对齐 ZCode：不再无限压缩挤成一团，滚动查看即可），溢出时自动把
  // 当前/悬停 tick 滚进可视区。
  const GAP_MAX = 10;
  const GAP_MIN = 6;
  const usable = Math.max(0, railH - 16);
  const gap = n > 1 ? Math.min(GAP_MAX, Math.max(GAP_MIN, usable / (n - 1))) : GAP_MAX;
  const contentH = n > 1 ? (n - 1) * gap + 6 : 6;
  const overflow = contentH > usable;
  // 溢出滚动模式：当前轮次变化时把对应 tick 滚进轨道可视区
  useEffect(() => {
    if (!overflow || active < 0 || !railRef.current) return;
    const el = railRef.current;
    const top = 3 + active * gap;
    if (top < el.scrollTop + 2 || top > el.scrollTop + el.clientHeight - 2) {
      el.scrollTop = top - el.clientHeight / 2;
    }
  }, [active, overflow, gap]);
  const center = overflow ? 3 + contentH / 2 : railH / 2;
  return (
    <div ref={railRef} onMouseLeave={() => setHover(-1)}
      className={`absolute bottom-2 left-0 top-2 z-10 w-5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${overflow ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {turns.map((t, i) => {
        // 视觉规则：当前位置的 tick「点亮」= 白色（尺寸不变）；鼠标触发 =
        // 左端固定、向右伸展（最长），并向两侧按距离递减成波浪；非悬停时
        // 全部回到基础宽，仅当前轮次保持白色点亮
        const dist = hover < 0 ? -1 : Math.abs(i - hover);
        const w = dist === 0 ? 20 : dist === 1 ? 14 : dist === 2 ? 11 : 10;
        const lit = dist === 0 || i === active;
        return (
          <button key={t.id} type="button" aria-label="跳转到这轮对话"
            className="group pointer-events-auto absolute left-0 flex h-4 w-5 -translate-y-1/2 items-center justify-start"
            style={{ top: overflow ? 3 + i * gap : center + (i - (n - 1) / 2) * gap }}
            onMouseEnter={() => setHover(i)}
            onClick={() => onJump(t.id)}>
            <span
              className={`rounded-full transition-all duration-200 ${dist === 0 || i === active ? 'bg-white' : 'bg-border'}`}
              style={{ width: w, height: 3 }} />
            {/* 悬浮信息条：该轮用户输入 + agent 回复摘要（淡入 + 右移动效） */}
            <span className="pointer-events-none absolute left-6 top-1/2 z-20 min-w-40 max-w-80 -translate-y-1/2 rounded-md border border-border bg-card px-2 py-1 text-ui-xs opacity-0 shadow-md transition-all duration-150 group-hover:translate-x-1 group-hover:opacity-100">
              <span className="block max-w-80 truncate text-foreground-subtle">{t.title}</span>
              <span className="block max-w-72 truncate text-foreground-subtlest">
                {t.reply ? t.reply : '（未回复）'}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 秒 → 「45 秒」/「1 分 12 秒」。 */
function fmtDur(sec: number): string {
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

/** 时间线。memo：外壳（侧栏/右栏开合等 appState 变化）重渲染时，
 *  rows 引用不变就不重算整条对话。 */
export const Timeline = memo(function Timeline({ rows, sid }: { rows: Row[]; sid: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<AnchorState>(resetAnchor);
  const units = useMemo(() => foldTurns(rows), [rows]);
  const busy = useConversation((s) => s.sessions[sid]?.busy ?? false);
  const turns = useMemo(
    () => units.flatMap((u, i) => {
      if (u.type !== 'user') return [];
      // 相邻的轮单元取 agent 最终回答（轮内最后的正文行），hover 信息条用
      const next = units[i + 1];
      const reply = next?.type === 'turn'
        ? [...next.rows].reverse().find((r) => r.kind === 'assistant_text')?.text
        : undefined;
      return [{ id: u.id, title: u.text, reply: reply || '' }];
    }),
    [units],
  );

  // 待回答的提问/确认卡（对话流末尾「正在询问」提示；提问面板本体在流内）
  const pendingAsk = useMemo(
    () => rows.findLast((r): r is Extract<Row, { kind: 'confirm' | 'ask' }> =>
      (r.kind === 'confirm' || r.kind === 'ask') && !r.resolved),
    [rows],
  );
  const waiting = useMemo(() => pendingBackgroundAgents(rows).length, [rows]);

  const onScroll = (): void => {
    if (jumpingRef.current) return; // 程序化平滑滚动进行中：不翻锚状态（见 beginJump）
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAnchor((a) => onUserScroll(a, dist));
  };

  // 内容追加：following 时贴底（一次性 scrollTo，不与用户滚动抢）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && shouldAutoScroll(anchor)) el.scrollTop = el.scrollHeight;
  }, [rows, anchor]);

  // 切会话：重置为跟随
  useEffect(() => { setAnchor(resetAnchor()); }, [sid]);

  // 程序化跳转保护窗：贴底（following）时点 tick，若不设保护，第一个
  // scroll 事件就把锚翻回 following → 贴底 effect 的 scrollTop 赋值会
  // 当场打断平滑动画（「在最底部点其他条没反应」的根因）。
  const jumpingRef = useRef(false);
  const jumpTimerRef = useRef(0);

  /** 开启跳转：先脱离跟随，动画结束落点贴底才恢复，避免贴底 effect 打架。 */
  const beginJump = (): void => {
    jumpingRef.current = true;
    setAnchor({ state: 'detached' });
    window.clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = window.setTimeout(() => {
      jumpingRef.current = false;
      const el = scrollRef.current;
      if (el) setAnchor(onUserScroll({ state: 'detached' }, el.scrollHeight - el.scrollTop - el.clientHeight));
    }, 1200);
  };

  /** 平滑滚到某轮（容器相对坐标，滚到轮首上方 8px）。 */
  const jumpToTurn = (id: string): void => {
    const el = scrollRef.current;
    const node = document.getElementById(`turn-${id}`);
    if (!el || !node) return;
    beginJump();
    const top = node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8;
    el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  const jumpBack = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    beginJump();
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="relative min-h-0 flex-1">
      {/* 左缘轮次轨：固定在视口左缘，不随内容滚动 */}
      <TurnRail turns={turns} containerRef={scrollRef} onJump={jumpToTurn} />
      <div ref={scrollRef} onScroll={onScroll} className="scroll-fine h-full overflow-y-auto">
        <div className="mx-auto h-full max-w-3xl px-6 py-3">
          {units.map((u, i) =>
            u.type === 'user'
              ? (
                <div key={u.id} id={`turn-${u.id}`} className="scroll-mt-2"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 200px' }}>
                  <RowView row={{ kind: 'user', id: u.id, text: u.text, steered: u.steered } as Row} sid={sid} />
                </div>
              )
              : <TurnBlock key={u.id} unit={u} sid={sid} live={busy && i === units.length - 1} />)}
          <div className="h-2" />

          {/* 工作计时 / 思考直播已并入工作段头部（TurnBlock）；这里只留询问中提示 */}
          {pendingAsk && (
            <div className="flex items-center gap-1.5 px-1 py-1 text-ui-xs text-foreground-subtlest">
              <span>❓</span>
              <span>正在询问</span>
            </div>
          )}
          {/* 主 agent 空闲但后台子 agent 仍在跑：完成后自动唤醒续跑 */}
          {!busy && waiting > 0 && (
            <div className="flex items-center gap-1.5 px-1 py-1 text-ui-xs text-foreground-subtlest">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />
              <span>等待 {waiting} 个后台子代理完成…完成后自动继续</span>
            </div>
          )}
        </div>
      </div>
      {showJumpBack(anchor, bottomDist(scrollRef.current)) && (
        <button type="button" onClick={jumpBack}
          className="absolute bottom-12 left-1/2 -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1 text-ui-xs text-foreground-subtle shadow-md hover:text-foreground">
          ↓ 回到底部
        </button>
      )}
    </div>
  );
});

function bottomDist(el: HTMLElement | null): number {
  if (!el) return 0;
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}
