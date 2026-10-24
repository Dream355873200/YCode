// 相对时间（侧栏对话列表 / 命令面板 / 团队群聊共用）。
export function relTime(ms: number, now = Date.now()): string {
  if (!ms) return '';
  const d = Math.max(0, now - ms);
  const min = Math.floor(d / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day} 天`;
  const t = new Date(ms);
  const sameYear = t.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${t.getMonth() + 1}月${t.getDate()}日` : `${t.getFullYear()}/${t.getMonth() + 1}/${t.getDate()}`;
}

/** 时钟时间（群聊消息时间戳）。 */
export function clock(ms: number): string {
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}
