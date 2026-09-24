// 提示词分区：决定模型「怎么想」的文本资产，分两类——
//   系统提示词：内置通用 Agent 提示词 + 提示词组（prompts/<name>/ 分段覆盖），模式引用一组；
//   领域规范：插件的 rules 文件，模式引用插件即每轮作为项目上下文注入。
// 自定义提示词组（用户资产目录）逐段编辑：预填内置文本，保存即覆盖该段，
//「恢复内置」删除覆盖文件；内置组「复制为自定义」后再改。
import { useEffect, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, EyeIcon, FileTextIcon, PlusIcon, ScrollTextIcon } from 'lucide-react';
import { engine } from '../../protocol';
import { useApp } from '../appState';
import { pluginById, useCatalog, type PromptGroupItem, type PluginItem } from './catalog';
import { AssetActions, EditorFrame, FormField, OriginChip, useFileText, useSaver } from './editing';
import { ID_RE } from './manifest';
import { BUILTIN_PROMPT_ID, NEW_ID, ruleId, useNav } from './nav';
import {
  baseName, Chip, DetailFrame, DetailSection, ErrorBox, FileSection, GroupHeader, Loading,
  RefreshButton, ResourceList, ResourceRow,
} from './ui';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../components/lib/utils';

/** 规范文件绝对路径（新引擎直接给 rulesFile；老引擎按插件目录拼接）。 */
const rulesPath = (p: PluginItem): string => p.rulesFile || `${p.dir}/${p.rules ?? ''}`;

/** 内置段的显示名（文件名 → 中文）。 */
const SECTION_LABEL: Record<string, string> = {
  'system-identity.prompt.md': '身份',
  'system-doing-tasks.prompt.md': '任务执行',
  'system-actions.prompt.md': '操作分寸',
  'system-using-tools.prompt.md': '工具使用',
  'system-tone-style.prompt.md': '语气风格',
  'system-output-efficiency.prompt.md': '输出效率',
  'system-reminder.prompt.md': '系统提醒',
  'compact.prompt.md': '上下文压缩',
  'yolo-classifier.prompt.md': '自动审批分类器',
};
const sectionLabel = (f: string): string => SECTION_LABEL[f] ?? f.replace(/\.md$/, '');

interface Section { name: string; content: string }

/** 内置提示词全部分段（引擎 GET /prompts/defaults）。 */
function useDefaultSections(): { sections: Section[]; loaded: boolean } {
  const [state, setState] = useState<{ sections: Section[]; loaded: boolean }>({ sections: [], loaded: false });
  useEffect(() => {
    let alive = true;
    engine.get('/prompts/defaults').then((r) => {
      const body = r.body as { sections?: Section[] } | undefined;
      if (alive) setState({ sections: body?.sections ?? [], loaded: true });
    }).catch(() => { if (alive) setState({ sections: [], loaded: true }); });
    return () => { alive = false; };
  }, []);
  return state;
}

/** 可折叠的只读文本段。 */
function TextSection({ title, meta, text }: { title: string; meta?: React.ReactNode; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2.5">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-left text-ui-sm font-medium text-foreground">
        {open ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
        {title}
        <span className="ml-auto flex items-center gap-1.5 font-normal">{meta}</span>
      </button>
      {open && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 font-mono text-ui-xs leading-relaxed text-foreground-subtle">
          {text || '（空）'}
        </pre>
      )}
    </section>
  );
}

/** 当前项目会话的生效系统提示词（按会话模式与提示词组实际组装）。 */
function EffectivePrompt() {
  const { sid, project } = useApp();
  const [state, setState] = useState<{ loading: boolean; error: string; mode?: string; prompt?: string } | null>(null);
  if (!sid) return null;
  const load = () => {
    setState({ loading: true, error: '' });
    engine.get(`/sessions/${encodeURIComponent(sid)}/system-prompt`).then((r) => {
      const body = r.body as { mode?: string; prompt?: string; error?: string } | undefined;
      if (r.unreachable || !body?.prompt) setState({ loading: false, error: body?.error || '引擎未返回系统提示词' });
      else setState({ loading: false, error: '', mode: body.mode, prompt: body.prompt });
    }).catch((e: unknown) => setState({ loading: false, error: e instanceof Error ? e.message : String(e) }));
  };
  return (
    <DetailSection title="生效系统提示词">
      <div className="flex items-center gap-2 text-ui-xs text-foreground-subtle">
        <span className="min-w-0 flex-1 truncate">
          {project?.name ?? '当前项目'}{state?.mode ? ` · 模式 ${state.mode}` : ''}
        </span>
        <Button type="button" size="sm" variant="outline" disabled={state?.loading} onClick={load}>
          <EyeIcon className="size-3.5" />{state?.prompt ? '刷新' : '查看'}
        </Button>
      </div>
      {state?.error && <ErrorBox message={state.error} />}
      {state?.prompt && (
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background px-3 py-2 font-mono text-ui-xs leading-relaxed text-foreground-subtle">
          {state.prompt}
        </pre>
      )}
    </DetailSection>
  );
}

function BuiltinPromptDetail() {
  const { sections, loaded } = useDefaultSections();
  return (
    <DetailFrame icon={<FileTextIcon className="size-5" />} title="内置通用 Agent"
      desc="引擎内置的完整系统提示词，按段组装（身份 / 任务执行 / 语气风格 / 工具使用…），跟随引擎升级。"
      actions={<Chip>内置</Chip>}>
      <section className="space-y-3">
        <h3 className="text-ui-sm font-medium text-foreground">分段</h3>
        {!loaded ? <Loading /> : (
          <div className="space-y-3 rounded-xl border border-border/50 bg-surface px-4 py-3">
            {sections.map((s) => (
              <TextSection key={s.name} title={sectionLabel(s.name)} text={s.content}
                meta={<span className="font-mono text-ui-2xs text-foreground-subtlest">{s.name}</span>} />
            ))}
          </div>
        )}
      </section>
      <DetailSection title="覆盖方式">
        <div className="text-ui-xs text-foreground-subtle">
          新建一个提示词组，逐段改写要替换的部分，其余段沿用内置；再在模式里选用该组。未选提示词组的模式直接使用内置提示词。
        </div>
      </DetailSection>
    </DetailFrame>
  );
}

/** 单段编辑器：预填覆盖内容（已覆盖）或内置文本（未覆盖）。 */
function SectionEditor({ group, name, fallback, overridden, onClose }: {
  group: PromptGroupItem; name: string; fallback: string; overridden: boolean; onClose(): void;
}) {
  const file = useFileText(overridden && group.dir ? `${group.dir}/${name}` : undefined);
  const [text, setText] = useState<string | null>(null);
  const { saving, error, run } = useSaver();
  if (!file.loaded) return <Loading />;
  const value = text ?? (overridden ? file.text : fallback);
  return (
    <EditorFrame title={`${sectionLabel(name)} · ${name}`} error={error || file.error} saving={saving}
      onCancel={onClose} onSave={() => void run([{ write: { path: `prompts/${group.name}/${name}`, content: value } }], onClose)}>
      <Textarea value={value} onChange={(e) => setText(e.target.value)}
        className="max-h-[36rem] min-h-60 font-mono text-ui-xs" />
      {!overridden && <div className="text-ui-2xs text-foreground-subtlest">已预填内置文本；保存后该段改用这里的内容。</div>}
    </EditorFrame>
  );
}

function PromptGroupDetail({ name }: { name: string }) {
  const catalog = useCatalog();
  const nav = useNav();
  const { sections, loaded } = useDefaultSections();
  const [editing, setEditing] = useState<string | null>(null);
  const { saving, error, run } = useSaver();
  const g = catalog.prompts.find((x) => x.name === name);
  if (!g) return catalog.loaded ? <ErrorBox message={`提示词组 ${name} 不存在`} /> : <Loading />;
  const files = g.files ?? [];
  const isUser = g.origin === 'user';
  const known = new Set(sections.map((s) => s.name));
  const extra = files.filter((f) => !known.has(f));
  if (editing) {
    const fallback = sections.find((s) => s.name === editing)?.content ?? '';
    return <SectionEditor group={g} name={editing} fallback={fallback} overridden={files.includes(editing)} onClose={() => setEditing(null)} />;
  }
  return (
    <DetailFrame icon={<FileTextIcon className="size-5" />} title={g.name}
      desc="组内每个文件覆盖同名的内置提示词段；没有覆盖的段沿用内置通用 Agent 提示词。修改在下一轮对话生效。"
      actions={
        <>
          <OriginChip origin={g.origin} />
          <AssetActions origin={g.origin} busy={saving}
            onCopy={g.dir ? () => void run([{ copy: { src: g.dir!, dest: `prompts/${g.name}` } }]) : undefined}
            onDelete={() => void run([{ rm: `prompts/${g.name}` }], nav.back)} />
        </>
      }>
      {error && <ErrorBox message={error} />}
      <section className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-ui-sm font-medium text-foreground">
          分段<span className="font-normal text-foreground-subtlest">已覆盖 {files.filter((f) => known.has(f)).length} / {sections.length}</span>
        </h3>
        {!loaded ? <Loading /> : (
          <ResourceList>
            {sections.map((s) => {
              const over = files.includes(s.name);
              return (
                <ResourceRow key={s.name}
                  icon={<FileTextIcon className={cn('size-4', over && 'text-brand')} />}
                  name={sectionLabel(s.name)}
                  desc={s.name}
                  onClick={isUser ? () => setEditing(s.name) : undefined}
                  right={
                    <>
                      {over ? <Chip tone="brand">已覆盖</Chip> : <Chip>使用内置</Chip>}
                      {isUser && over && (
                        <Button type="button" size="xs" variant="ghost" disabled={saving}
                          onClick={(e) => { e.stopPropagation(); void run([{ rm: `prompts/${g.name}/${s.name}` }]); }}>
                          恢复内置
                        </Button>
                      )}
                    </>
                  }
                />
              );
            })}
          </ResourceList>
        )}
        {!isUser && files.length > 0 && g.dir && (
          <div className="space-y-3 rounded-xl border border-border/50 bg-surface px-4 py-3">
            {files.map((f) => <FileSection key={f} title={sectionLabel(f)} path={`${g.dir}/${f}`} defaultOpen={false} />)}
          </div>
        )}
        {isUser && extra.length > 0 && (
          <div className="text-ui-xs text-foreground-subtlest">
            非内置段名的文件不参与组装：{extra.join('、')}
          </div>
        )}
      </section>
    </DetailFrame>
  );
}

function NewPromptGroup({ onDone, onCancel }: { onDone(name: string): void; onCancel(): void }) {
  const catalog = useCatalog();
  const [name, setName] = useState('');
  const { saving, error, run } = useSaver();
  const save = () => {
    const n = name.trim();
    if (!ID_RE.test(n)) return void run({ error: '组名只能含字母、数字、_、-' });
    if (catalog.prompts.some((g) => g.name === n)) return void run({ error: `提示词组 ${n} 已存在` });
    void run([{ mkdir: `prompts/${n}` }], () => onDone(n));
  };
  return (
    <EditorFrame title="新建提示词组" error={error} saving={saving} onCancel={onCancel} onSave={save}>
      <FormField label="组名" hint="新组是空组（等同内置）；建好后逐段覆盖，再在模式里选用">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="reviewer" />
      </FormField>
    </EditorFrame>
  );
}

function RuleDetail({ pluginId }: { pluginId: string }) {
  const catalog = useCatalog();
  const p = pluginById(catalog, pluginId);
  if (!p?.rules) return <ErrorBox message={`插件 ${pluginId} 没有声明领域规范`} />;
  return (
    <DetailFrame icon={<ScrollTextIcon className="size-5" />} title={`${p.id} 规范`}
      desc="领域规范：模式引用插件后，每轮对话把它作为项目上下文注入，约束模型在该领域的做法。修改后下一轮生效；自定义插件在插件编辑里改。">
      <FileSection title="内容" path={rulesPath(p)} />
    </DetailFrame>
  );
}

export function PromptsTab() {
  const catalog = useCatalog();
  const { route, go, replace, back } = useNav();
  if (catalog.error) return <ErrorBox message={catalog.error} />;
  if (route.id === BUILTIN_PROMPT_ID) return <BuiltinPromptDetail />;
  if (route.id === NEW_ID) return <NewPromptGroup onDone={(n) => replace('prompts', n)} onCancel={back} />;
  if (route.id?.startsWith('rule:')) return <RuleDetail pluginId={route.id.slice(5)} />;
  if (route.id) return <PromptGroupDetail name={route.id} />;
  const rulePlugins = catalog.plugins.filter((p) => p.rules);
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <GroupHeader title="系统提示词" count={1 + catalog.prompts.length} actions={
          <div className="flex items-center gap-1">
            <Button type="button" size="sm" variant="outline" onClick={() => go('prompts', NEW_ID)}>
              <PlusIcon className="size-3.5" />新建提示词组
            </Button>
            <RefreshButton />
          </div>
        } />
        {!catalog.loaded ? <Loading /> : (
          <ResourceList>
            <ResourceRow
              icon={<FileTextIcon className="size-4" />}
              name="内置通用 Agent"
              desc="引擎内置的完整提示词；未引用提示词组的模式直接使用"
              onClick={() => go('prompts', BUILTIN_PROMPT_ID)}
              right={<Chip>内置</Chip>}
            />
            {catalog.prompts.map((g) => (
              <ResourceRow
                key={g.name}
                icon={<FileTextIcon className="size-4" />}
                name={g.name}
                desc={(g.files?.length ?? 0) > 0 ? `提示词组 · 覆盖 ${g.files!.length} 段` : '提示词组 · 空组（等同内置）'}
                onClick={() => go('prompts', g.name)}
                right={g.origin === 'user' ? <OriginChip origin="user" /> : undefined}
              />
            ))}
          </ResourceList>
        )}
      </div>
      <div className="space-y-3">
        <GroupHeader title="领域规范" count={rulePlugins.length} />
        {catalog.loaded && rulePlugins.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-ui-sm text-foreground-subtlest">
            还没有插件声明领域规范（插件编辑里填写）
          </div>
        ) : (
          <ResourceList>
            {rulePlugins.map((p) => (
              <ResourceRow
                key={p.id}
                icon={<ScrollTextIcon className="size-4" />}
                name={`${p.id} 规范`}
                desc={baseName(rulesPath(p))}
                onClick={() => go('prompts', ruleId(p.id))}
              />
            ))}
          </ResourceList>
        )}
      </div>
      <EffectivePrompt />
      <p className="text-ui-xs text-foreground-subtlest">
        系统提示词按段组装，提示词组只放要改写的段，模式按名引用；领域规范随插件走，模式引用插件即生效。
      </p>
    </div>
  );
}
