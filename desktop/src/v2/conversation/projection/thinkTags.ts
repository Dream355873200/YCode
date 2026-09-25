// thinkTags.ts — 正文流里思考标签的流式解析（纯状态机）。
// DeepSeek 惯用 <think>、GLM/Qwen 惯用 <thinking>、o-series 风格惯用
// <analysis>；模型可能不走独立 reasoning 通道而把思考打进正文——从
// legacy useChat 迁移，抽成可测试的纯状态机。
//
// 混用容错（实测踩坑）：provider 历史回填把思考包成 <thinking> 放进
// content，模型有时以 <analysis> 收尾（</analysis>）——闭合标签互认，
// 否则思考桶永不闭合，正文会被整段吞进思考卡。
export interface ThinkPiece {
  /** 正文片段（进 sumBuf / assistant_text）。 */
  text?: string;
  /** 思考片段（进 reasoning row）。 */
  think?: string;
}

const OPENS = ['<think>', '<thinking>', '<analysis>'] as const;
const CLOSES = ['</think>', '</thinking>', '</analysis>'] as const;
const ANY_TAG_PREFIX_MAX = Math.max(...[...OPENS, ...CLOSES].map((t) => t.length)) - 1;

/** 剥掉思考文本里残留的思考标记：切分状态机只处理正文流里的标签，
    部分供应商会把标签原样带进 reasoning 通道（GLM 系中转常见）——推理
    内容在投影层统一去标记，直播与历史回放都过这里。 */
export const stripThinkMarks = (s: string): string => s.replace(/<\/?(?:think|thinking|analysis)>/g, '');

/** 文本尾部是否是任一思考标签的前缀（跨包扣留用）。 */
function isTagPrefix(tail: string): boolean {
  for (const t of [...OPENS, ...CLOSES]) {
    if (t.startsWith(tail)) return true;
  }
  return false;
}

/** 在 buf 里找最早的闭合标签；返回 [index, tagLen]，无则 -1。 */
function findClose(buf: string): [number, number] {
  let idx = -1;
  let len = 0;
  for (const c of CLOSES) {
    const i = buf.indexOf(c);
    if (i >= 0 && (idx < 0 || i < idx)) {
      idx = i;
      len = c.length;
    }
  }
  return [idx, len];
}

export class ThinkTagSplitter {
  private inThink = false;
  private buf = '';
  /** 跨 chunk 扣住的疑似标签尾巴（开标签/闭标签前缀，等下一包定性）。 */
  private pending = '';

  /** 喂入一段正文流，返回切分出的片段（顺序保持）。 */
  feed(text: string): ThinkPiece[] {
    let t = this.pending + text;
    this.pending = '';
    const pieces: ThinkPiece[] = [];
    while (t.length) {
      if (this.inThink) {
        const full = this.buf + t;
        const [end, tagLen] = findClose(full);
        if (end >= 0) {
          const think = full.slice(0, end);
          if (think.trim()) pieces.push({ think: think.trim() });
          this.buf = '';
          this.inThink = false;
          t = full.slice(end + tagLen);
        } else {
          // 未见闭合：扣住疑似闭标签前缀尾巴，其余增量产出（流式可见）；
          // 没有任何疑似尾巴时整体留在缓冲（flush 兜底按闭合处理）
          let hold = 0;
          for (let l = Math.min(full.length, ANY_TAG_PREFIX_MAX); l >= 1; l--) {
            if (isTagPrefix(full.slice(full.length - l))) { hold = l; break; }
          }
          this.buf = '';
          if (hold > 0) {
            const part = full.slice(0, full.length - hold);
            if (part.trim()) pieces.push({ think: part.trim() });
            this.pending = full.slice(full.length - hold);
          } else {
            this.buf = full;
          }
          t = '';
        }
      } else {
        // 三种开标签都可能：取最先出现的
        let start = -1;
        let tagLen = 0;
        for (const o of OPENS) {
          const i = t.indexOf(o);
          if (i >= 0 && (start < 0 || i < start)) {
            start = i;
            tagLen = o.length;
          }
        }
        if (start >= 0) {
          if (start > 0) pieces.push({ text: t.slice(0, start) });
          this.inThink = true;
          t = t.slice(start + tagLen);
        } else {
          // 无完整标签：扣住疑似开标签前缀尾巴，防标签跨包时被当正文漏出
          let hold = 0;
          for (let l = Math.min(t.length, ANY_TAG_PREFIX_MAX); l >= 1; l--) {
            if (isTagPrefix(t.slice(t.length - l))) { hold = l; break; }
          }
          const part = t.slice(0, t.length - hold);
          if (part) pieces.push({ text: part });
          if (hold > 0) this.pending = t.slice(t.length - hold);
          t = '';
        }
      }
    }
    return pieces;
  }

  /** run 结束时冲刷：未闭合的思考按闭合处理，未完毕缓冲按正文处理。 */
  flush(): ThinkPiece[] {
    const pieces: ThinkPiece[] = [];
    if (this.inThink) {
      if (this.buf.trim()) pieces.push({ think: this.buf.trim() });
    } else if (this.pending) {
      pieces.push({ text: this.pending });
    }
    this.buf = '';
    this.pending = '';
    this.inThink = false;
    return pieces;
  }
}
