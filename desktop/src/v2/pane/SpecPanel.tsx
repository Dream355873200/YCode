// SPEC 规范面板（自 legacy StagePanel SPEC 页签移植，槽位消费方）：
// 轮询读项目根 SPEC.md（AI 与用户对话敲定的「范围契约」，必须反映最新
// 内容），Markdown 渲染。挂载即读（SidePane tab 切换 = 重新挂载 = 刷新）。
import { useEffect, useState } from 'react';
import { useApp } from '../app/appState';
import { renderMD } from '../../lib/markdown';

const PLACEHOLDER = '（SPEC.md 尚未生成 — 与 AI 对话后创建）';

export default function SpecPanel() {
  const { project } = useApp();
  const [spec, setSpec] = useState(PLACEHOLDER);

  useEffect(() => {
    if (!project) return;
    let alive = true;
    const load = () => (window.amc.fs as unknown as {
      readFile(p: string): Promise<{ ok: boolean; content?: string }>;
    }).readFile(project.dir + '/SPEC.md')
      .then((r) => { if (alive) setSpec(r.ok && r.content ? r.content : PLACEHOLDER); })
      .catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => { alive = false; clearInterval(t); };
  }, [project]);

  if (!project) return null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
      <div className="v2-md" dangerouslySetInnerHTML={{ __html: renderMD(spec) }} />
    </div>
  );
}
