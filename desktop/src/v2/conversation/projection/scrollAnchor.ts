// scrollAnchor.ts — 贴底跟随状态机（纯函数，可测试）。
// 流式 UI 最大的体验坑：程序化滚动（内容追加触发 scrollTop 变化）会把
// 用户自己的阅读意图冲掉。三态模型：following（贴底跟随）/ detached
// （用户向上阅读）/ jump-back（提供「回到底部」）。用户滚动改变状态；
// 内容追加引发的几何变化不改变状态。
export type FollowState = 'following' | 'detached';

export interface AnchorState {
  state: FollowState;
}

/** 贴底判定余量（px）：距底 ≤ nearBottomPx 视为在底部。 */
export const NEAR_BOTTOM_PX = 24;

/** 状态单例：同态恒返回同一引用——scroll 是高频事件，每次 new 对象会让
 * 依赖 anchor 的 effect 反复空跑（更糟：贴底时 effect 的 scrollTop 赋值
 * 会打断进行中的程序化平滑滚动）。 */
const FOLLOWING: AnchorState = { state: 'following' };
const DETACHED: AnchorState = { state: 'detached' };

/** 用户滚动事件 → 新状态。distanceFromBottom 由组件测得。 */
export function onUserScroll(_s: AnchorState, distanceFromBottom: number): AnchorState {
  // 用户手动滚回底部 → 恢复跟随；离底 → 脱离
  return distanceFromBottom <= NEAR_BOTTOM_PX ? FOLLOWING : DETACHED;
}

/** 内容追加后：仅 following 态要求自动滚底；detached 态保持不动。 */
export function shouldAutoScroll(s: AnchorState): boolean {
  return s.state === 'following';
}

/** 是否显示「回到底部」按钮。 */
export function showJumpBack(s: AnchorState, distanceFromBottom: number): boolean {
  return s.state === 'detached' && distanceFromBottom > NEAR_BOTTOM_PX;
}

/** 点击「回到底部」→ 恢复跟随。 */
export function jumpToBottom(_s: AnchorState): AnchorState {
  return FOLLOWING;
}

/** 新会话/重置。 */
export function resetAnchor(): AnchorState {
  return FOLLOWING;
}
