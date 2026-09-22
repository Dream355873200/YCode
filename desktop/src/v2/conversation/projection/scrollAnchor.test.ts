import { describe, it, expect } from 'vitest';
import {
  onUserScroll, shouldAutoScroll, showJumpBack, jumpToBottom, resetAnchor, NEAR_BOTTOM_PX,
} from './scrollAnchor';

describe('scrollAnchor 贴底跟随状态机', () => {
  it('初始为 following，内容追加自动滚底', () => {
    const s = resetAnchor();
    expect(shouldAutoScroll(s)).toBe(true);
    expect(showJumpBack(s, 0)).toBe(false);
  });

  it('用户向上滚动脱离跟随；内容追加不再滚底', () => {
    let s = resetAnchor();
    s = onUserScroll(s, 500);
    expect(s.state).toBe('detached');
    expect(shouldAutoScroll(s)).toBe(false);
  });

  it('用户滚回底部（余量内）恢复跟随', () => {
    let s = resetAnchor();
    s = onUserScroll(s, 500);
    s = onUserScroll(s, NEAR_BOTTOM_PX - 5);
    expect(s.state).toBe('following');
  });

  it('detached 且距底超余量 → 显示回到底部', () => {
    let s = resetAnchor();
    s = onUserScroll(s, 100);
    expect(showJumpBack(s, 100)).toBe(true);
    expect(showJumpBack(s, NEAR_BOTTOM_PX)).toBe(false);
  });

  it('点击回到底部恢复跟随', () => {
    let s = resetAnchor();
    s = onUserScroll(s, 300);
    s = jumpToBottom(s);
    expect(shouldAutoScroll(s)).toBe(true);
  });
});
