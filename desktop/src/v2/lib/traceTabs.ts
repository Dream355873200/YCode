// traceTabs — 右栏轨迹面板 tab 的 id 编解码（pipeline 节点 / 子代理共用）。
// 独立成中性模块：conversation/RowView（发起打开）与 pane/*TracePane（承接
// 渲染）都引用它，避免两者互相 import 成环。
export function nodeTraceTabId(runId: string, node: string): string {
  return `pnode:${runId}:${node}`;
}
export function parseNodeTraceTabId(id: string): { runId: string; node: string } | null {
  if (!id.startsWith('pnode:')) return null;
  const rest = id.slice(6);
  const i = rest.indexOf(':');
  if (i <= 0) return null;
  return { runId: rest.slice(0, i), node: rest.slice(i + 1) };
}

export function subAgentTraceTabId(sessionID: string, toolUseID: string): string {
  return `subtrace:${sessionID}:${toolUseID}`;
}
export function parseSubAgentTraceTabId(id: string): { sessionID: string; toolUseID: string } | null {
  if (!id.startsWith('subtrace:')) return null;
  const rest = id.slice(9);
  const i = rest.indexOf(':');
  if (i <= 0) return null;
  return { sessionID: rest.slice(0, i), toolUseID: rest.slice(i + 1) };
}
