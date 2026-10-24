// 项目目录比较：引擎注册表按原样存目录，前端按同一把尺子归一后再比
//（与引擎 threads.go 的 normDir 一致）。

/** 路径归一：分隔符统一为 /、去掉尾部分隔符；盘符路径（Windows）不区分大小写。 */
export function normalizeDir(dir: string): string {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-zA-Z]:/.test(d) ? d.toLowerCase() : d;
}
