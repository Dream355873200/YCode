// 技能分区：搜索过滤 + 按容器分组（各插件 / 用户 / 全局），点行进详情。项目级技能
//（<项目>/.yume/commands/）随会话加载，不在此列出。用户技能（用户资产目录
// skills/<name>/SKILL.md，所有模式可用）可新建 / 编辑 / 删除。
import { useState } from 'react';
import { PlusIcon, SearchIcon, SparklesIcon } from 'lucide-react';
import { skillKey, useCatalog, type SkillItem } from './catalog';
import { AssetActions, EditorFrame, FormField, OriginChip, useFileText, useSaver } from './editing';
import { buildSkillFile, splitFrontmatter, type SkillForm } from './manifest';
import { NEW_ID, useNav } from './nav';
import {
  DetailFrame, DetailSection, EmptyHint, ErrorBox, FileSection, GroupHeader, InfoRow,
  Loading, RefreshButton, ResourceList, ResourceRow,
} from './ui';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';

/** 技能在用户资产目录里占的路径：目录式技能删整个目录，单文件技能删文件。 */
const skillAssetPath = (s: SkillItem): string =>
  /[\\/]SKILL\.md$/i.test(s.filePath ?? '') ? s.filePath!.replace(/[\\/]SKILL\.md$/i, '') : s.filePath!;

function SkillFields({ skill, initial, onDone, onCancel }: {
  skill?: SkillItem; initial: SkillForm; onDone(key: string): void; onCancel(): void;
}) {
  const catalog = useCatalog();
  const [form, setForm] = useState(initial);
  const { saving, error, run } = useSaver();
  const set = <K extends keyof SkillForm>(k: K, v: SkillForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => {
    const r = buildSkillFile(form, {
      isNew: !skill,
      skillNames: catalog.skills.filter((x) => x.origin === 'user').map((x) => x.name),
      path: skill?.filePath,
    });
    void run(r.ok ? [{ write: r.value }] : { error: r.error }, () => onDone(r.ok ? r.value.path : ''));
  };
  return (
    <EditorFrame title={skill ? `编辑技能 ${skill.name}` : '新建技能'} error={error} saving={saving}
      onCancel={onCancel} onSave={save}>
      <FormField label="名称" hint="只能含字母、数字、_、-；对话里以 /<名称> 调用">
        <Input value={form.name} disabled={!!skill} onChange={(e) => set('name', e.target.value)} placeholder="release-notes" />
      </FormField>
      <FormField label="描述">
        <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
      </FormField>
      <FormField label="何时使用" hint="模型据此判断何时主动调用（可留空）">
        <Input value={form.whenToUse} onChange={(e) => set('whenToUse', e.target.value)} />
      </FormField>
      <FormField label="正文">
        <Textarea value={form.body} onChange={(e) => set('body', e.target.value)} className="max-h-[32rem] min-h-48 font-mono text-ui-xs" />
      </FormField>
    </EditorFrame>
  );
}

/** 技能编辑器：编辑时先读原文件拆出正文。 */
function SkillEditor({ skill, onDone, onCancel }: { skill?: SkillItem; onDone(key: string): void; onCancel(): void }) {
  const file = useFileText(skill?.filePath);
  if (!file.loaded) return <Loading />;
  const initial: SkillForm = skill
    ? { name: skill.name, description: skill.description ?? '', whenToUse: skill.whenToUse ?? '', body: splitFrontmatter(file.text).body }
    : { name: '', description: '', whenToUse: '', body: '' };
  return <SkillFields skill={skill} initial={initial} onDone={onDone} onCancel={onCancel} />;
}

function SkillDetail({ id }: { id: string }) {
  const catalog = useCatalog();
  const nav = useNav();
  const [editing, setEditing] = useState(false);
  const { saving, error, run } = useSaver();
  const skill = catalog.skills.find((s) => skillKey(s) === id);
  if (!skill) return catalog.loaded ? <ErrorBox message="技能不存在（可能已被移除）" /> : <Loading />;
  // 用户技能与自定义插件里的技能可编辑
  const editable = !!skill.filePath && (skill.origin === 'user'
    || (skill.origin === 'plugin' && catalog.plugins.find((p) => p.id === skill.plugin)?.origin === 'user'));
  if (editing) return <SkillEditor skill={skill} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  return (
    <DetailFrame icon={<SparklesIcon className="size-5" />} title={skill.name} desc={skill.description}
      actions={
        <>
          <OriginChip origin={editable ? 'user' : 'bundled'} />
          {editable && (
            <AssetActions origin="user" busy={saving} onEdit={() => setEditing(true)}
              onDelete={() => void run([{ rm: skillAssetPath(skill) }], nav.back)} />
          )}
        </>
      }>
      {error && <ErrorBox message={error} />}
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
  const { route, go, replace, back } = useNav();
  const [query, setQuery] = useState('');
  if (catalog.error) return <ErrorBox message={catalog.error} />;
  if (route.id === NEW_ID) {
    // 保存后回清单（新技能出现在「我的技能」组）
    return <SkillEditor onDone={() => replace('skills')} onCancel={back} />;
  }
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
    { key: 'user', title: '我的技能（所有模式可用）', rows: filtered.filter((s) => s.origin === 'user') },
    { key: 'global', title: '全局技能（所有模式可用）', rows: filtered.filter((s) => s.origin === 'global') },
  ].filter((g) => g.rows.length > 0);
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-foreground-subtlest" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索技能…" className="pl-8" />
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => go('skills', NEW_ID)}>
          <PlusIcon className="size-3.5" />新建技能
        </Button>
        <RefreshButton />
      </div>
      {!catalog.loaded ? <Loading /> : groups.length === 0 ? (
        <EmptyHint
          icon={<SparklesIcon className="size-8" />}
          title={q ? '没有匹配的技能' : '还没有技能'}
          desc="技能来源（优先级从高到低）：<项目>/.yume/commands/、模式引用插件的 skills/、我的技能、<应用根>/skills/。点「新建技能」写一个所有模式可用的技能。"
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
