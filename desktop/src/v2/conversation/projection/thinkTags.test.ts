import { describe, it, expect } from 'vitest';
import { ThinkTagSplitter, stripThinkMarks } from './thinkTags';

describe('ThinkTagSplitter', () => {
  it('无标签：原样透传', () => {
    const s = new ThinkTagSplitter();
    expect(s.feed('你好世界')).toEqual([{ text: '你好世界' }]);
    expect(s.flush()).toEqual([]);
  });

  it('<think> 闭合：思考与正文分离', () => {
    const s = new ThinkTagSplitter();
    expect(s.feed('前文<think>思考中</think>后文')).toEqual([
      { text: '前文' },
      { think: '思考中' },
      { text: '后文' },
    ]);
  });

  it('跨 chunk 分帧：开标签跨包、闭标签跨包', () => {
    const s = new ThinkTagSplitter();
    expect(s.feed('前文<thi')).toEqual([{ text: '前文' }]);
    expect(s.feed('nk>第一段')).toEqual([]); // 思考进缓冲
    expect(s.feed('继续</thi')).toEqual([{ think: '第一段继续' }]);
    expect(s.feed('nk>完')).toEqual([{ text: '完' }]);
  });

  it('<thinking> 变体（GLM/Qwen 惯用）', () => {
    const s = new ThinkTagSplitter();
    expect(s.feed('<thinking>长思考</thinking>答')).toEqual([
      { think: '长思考' },
      { text: '答' },
    ]);
  });

  it('连续多段思考', () => {
    const s = new ThinkTagSplitter();
    expect(s.feed('<think>A</think>x<think>B</think>')).toEqual([
      { think: 'A' },
      { text: 'x' },
      { think: 'B' },
    ]);
  });

  it('flush：未闭合的思考按闭合处理', () => {
    const s = new ThinkTagSplitter();
    s.feed('<think>没写完');
    expect(s.flush()).toEqual([{ think: '没写完' }]);
    // flush 后状态复位
    expect(s.feed('正文')).toEqual([{ text: '正文' }]);
  });

  it('纯空白思考不产出片段', () => {
    const s = new ThinkTagSplitter();
    expect(s.feed('<think>   </think>')).toEqual([]);
  });
});

describe('analysis 家族与混用容错', () => {
  it('<analysis> 包裹的思考被切到 think，正文保留', () => {
    const sp = new ThinkTagSplitter();
    const pieces = sp.feed('<analysis>推理过程</analysis>最终答案');
    expect(pieces).toEqual([{ think: '推理过程' }, { text: '最终答案' }]);
  });

  it('<think> 开、</analysis> 收的混用能闭合（实测踩坑：否则正文整段吞进思考卡）', () => {
    const sp = new ThinkTagSplitter();
    const pieces = sp.feed('<think>先分析一下</analysis>这是正文');
    expect(pieces).toEqual([{ think: '先分析一下' }, { text: '这是正文' }]);
  });

  it('跨包的 </analysis> 尾巴被扣住不定性为正文', () => {
    const sp = new ThinkTagSplitter();
    const pieces = [
      ...sp.feed('<analysis>思考中…</analy'),
      ...sp.feed('sis>正文'),
    ];
    const all = pieces.flatMap((p) => (p.think ? ['think'] : ['text']));
    expect(all).toEqual(['think', 'text']);
  });

  it('stripThinkMarks 剥离 analysis 标记', () => {
    expect(stripThinkMarks('a</analysis>\n<b analysis>')).toBe('a\n<b analysis>');
  });
});
