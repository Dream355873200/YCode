// 技能分区：搜索过滤 + 按容器分组（各插件 / 全局），点行进详情。项目级技能
//（<项目>/.yume/commands/）随会话加载，不在此列出。
import { useState } from 'react';
import { SearchIcon, SparklesIcon } from 'lucide-react';
import { skillKey, useCatalog } from './catalog';
import { useNav } from './nav';
import {
  DetailFrame, DetailSection, EmptyHint, ErrorBox, FileSection, GroupHeader, InfoRow,
  Loading, RefreshButton, ResourceList, ResourceRow,
} from './ui';
import { Input } from '../../components/ui/input';

function SkillDetail({ id }: { id: string }) {
  const catalog = useCatalog();
  const skill = catalog.skills.find((s) => skillKey(s) === id);
  if (!skill) return <ErrorBox message="技能不存在（可能已被移除）" />;
  return (
    <DetailFrame icon={<SparklesIcon className="size-5" />} title={skill.name} desc={skill.description}>
      {skill.whenToUse && (
        <DetailSection title="何时使用">
          <div className="text-ui-sm text-foreground-subtle">{skill.whenToUse}</div>
        </DetailSection>
      )}
      {skill.filePath ? <FileSection title="内容" path={skill.filePath} /> : (
        <DetailSection title="内容">
          <InfoRow label="文件">引擎未返回文件路径</InfoRow>
        </DetailSection>
      )}
    </DetailFrame>
  );
}

export function SkillsTab() {
  const catalog = useCatalog();
  const { route, go } = useNav();
  const [query, setQuery] = useState('');
  if (catalog.error) return <ErrorBox message={catalog.error} />;
  if (route.id) return <SkillDetail id={route.id} />;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? catalog.skills.filter((s) => `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q))
    : catalog.skills;
  // 按容器分组：每个插件一组，全局技能一组
  const pluginIds = [...new Set(filtered.filter((s) => s.origin === 'plugin').map((s) => s.plugin ?? ''))].sort();
  const groups = [
    ...pluginIds.map((id) => ({
      key: `plugin:${id}`, title: `${id} 插件`, rows: filtered.filter((s) => s.origin === 'plugin' && s.plugin === id),
    })),
    { key: 'global', title: '全局技能（所有模式可用）', rows: filtered.filter((s) => s.origin === 'global') },
  ].filter((g) => g.rows.length > 0);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtlest" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索技能…" className="pl-8" />
        </div>
        <RefreshButton />
      </div>
      {!catalog.loaded ? <Loading /> : groups.length === 0 ? (
        <EmptyHint
          icon={<SparklesIcon className="size-8" />}
          title={q ? '没有匹配的技能' : '还没有技能'}
          desc="技能来源（优先级从高到低）：<项目>/.yume/commands/、模式引用插件的 skills/、<应用根>/skills/。每项为 <name>/SKILL.md 或 <name>.md。"
        />
      ) : (
        groups.map((g) => (
          <div key={g.key} className="space-y-3">
            <GroupHeader title={g.title} count={g.rows.length} />
            <ResourceList>
              {g.rows.map((s) => (
                <ResourceRow
                  key={skillKey(s)}
                  icon={<SparklesIcon className="size-4" />}
                  name={s.name}
                  desc={s.description || s.whenToUse || '（无描述）'}
                  onClick={() => go('skills', skillKey(s))}
                />
              ))}
            </ResourceList>
          </div>
        ))
      )}
    </div>
  );
}
