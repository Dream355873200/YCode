// 会话 ID：每项目一个持久会话，引擎按会话扎根项目目录。
// 形如 amc-<目录名>-<路径哈希 8 位>：目录名便于辨认，哈希区分不同位置的
// 同名目录（旧规则 amc-<目录名> 会让同名项目共用同一段对话）。
// 旧 ID 的历史由主进程在首次绑定时迁移（electron/lib/engine.js bindSession）。
// legacy UI（src/state/AppState.jsx）也从这里取，两套界面共用同一会话。

const baseName = (dir: string): string => dir.split(/[\\/]/).filter(Boolean).pop() ?? '';

/** 路径归一：分隔符统一为 /、去掉尾部分隔符；盘符路径（Windows）不区分大小写。 */
export function normalizeDir(dir: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:/.test(d) ? d.toLowerCase() : d;
}

/** FNV-1a 32 位 → 8 位十六进制（同步、无依赖）。 */
export function dirHash(dir: string): string {
  const s = normalizeDir(dir);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 项目目录 → 会话 ID；目录为空时返回 null。 */
export function projectSessionId(dir: string | null | undefined): string | null {
  return dir ? `amc-${baseName(dir)}-${dirHash(dir)}` : null;
}
