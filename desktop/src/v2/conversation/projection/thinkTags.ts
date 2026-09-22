// thinkTags.ts — 正文流里 <think>/<thinking> 标签的流式解析（纯状态机）。
// DeepSeek 惯用 <think>、GLM/Qwen 惯用 <thinking>；模型可能不走独立
// reasoning 通道而把思考打进正文——从 legacy useChat 迁移，抽成可测试
// 的纯状态机（原实现内嵌在事件分支里零覆盖）。
export interface ThinkPiece {
  /** 正文片段（进 sumBuf / assistant_text）。 */
  text?: string;
  /** 思考片段（进 reasoning row）。 */
  think?: string;
}

export class ThinkTagSplitter {
  private inThink = false;
  private closeTag = '</think>';
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
        const end = full.indexOf(this.closeTag);
        if (end >= 0) {
          const think = full.slice(0, end);
          if (think.trim()) pieces.push({ think: think.trim() });
          this.buf = '';
          this.inThink = false;
          t = full.slice(end + this.closeTag.length);
        } else {
          // 未见闭合：扣住疑似闭标签前缀尾巴，其余增量产出（流式可见）；
          // 没有任何疑似尾巴时整体留在缓冲（flush 兜底按闭合处理）
          let hold = 0;
          for (let l = Math.min(full.length, this.closeTag.length - 1); l >= 1; l--) {
            if (this.closeTag.startsWith(full.slice(full.length - l))) { hold = l; break; }
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
        // <think> 与 <thinking> 都可能：取最先出现的
        const s7 = t.indexOf('<think>');
        const s10 = t.indexOf('<thinking>');
        let start = -1;
        let tagLen = 0;
        if (s7 >= 0 && (s10 < 0 || s7 <= s10)) { start = s7; tagLen = 7; }
        else if (s10 >= 0) { start = s10; tagLen = 10; }
        if (start >= 0) {
          if (start > 0) pieces.push({ text: t.slice(0, start) });
          this.inThink = true;
          this.closeTag = tagLen === 7 ? '</think>' : '</thinking>';
          t = t.slice(start + tagLen);
        } else {
          // 无完整标签：扣住疑似开标签前缀尾巴（'<' 到 '<thinking'），防
          // 标签跨包时被当正文漏出（如 '前文<thi' + 'nk>…'）
          let hold = 0;
          for (let l = Math.min(t.length, 9); l >= 1; l--) {
            if ('<thinking>'.startsWith(t.slice(t.length - l))) { hold = l; break; }
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
