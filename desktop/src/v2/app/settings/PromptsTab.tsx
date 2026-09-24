// 提示词分区：决定模型「怎么想」的文本资产，分两类——
//   系统提示词：内置通用 Agent 提示词 + 提示词组（prompts/<name>/ 分段覆盖），模式引用一组；
//   领域规范：插件的 rules 文件，模式引用插件即每轮作为项目上下文注入。
import { FileTextIcon, ScrollTextIcon } from 'lucide-react';
import { pluginById, useCatalog, type PluginItem } from './catalog';
import { BUILTIN_PROMPT_ID, ruleId, useNav } from './nav';
import {
  baseName, Chip, DetailFrame, DetailSection, ErrorBox, FileSection, GroupHeader, Loading,
  RefreshButton, ResourceList, ResourceRow,
} from './ui';

/** 规范文件绝对路径（新引擎直接给 rulesFile；老引擎按插件目录拼接）。 */
const rulesPath = (p: PluginItem): string => p.rulesFile || `${p.dir}/${p.rules ?? ''}`;

function BuiltinPromptDetail() {
  return (
    <DetailFrame icon={<FileTextIcon className="size-5" />} title="内置通用 Agent"
      desc="引擎内置的完整系统提示词，按段组装（身份 / 任务执行 / 语气风格 / 工具使用…），跟随引擎升级。"
      actions={<Chip>内置</Chip>}>
      <DetailSection title="覆盖方式">
        <div className="text-ui-xs text-foreground-subtle">
          在 &lt;应用根&gt;/prompts/&lt;组名&gt;/ 下放与内置段同名的 .md 文件即可改写该段，其余段沿用内置；
          再在模式的 mode.json 里写 "prompts": "&lt;组名&gt;" 引用。未引用提示词组的模式直接使用内置提示词。
        </div>
      </DetailSection>
    </DetailFrame>
  );
}

function PromptGroupDetail({ name }: { name: string }) {
  const catalog = useCatalog();
  const g = catalog.prompts.find((x) => x.name === name);
  if (!g) return <ErrorBox message={`提示词组 ${name} 不存在`} />;
  const files = g.files ?? [];
  return (
    <DetailFrame icon={<FileTextIcon className="size-5" />} title={g.name}
      desc="组内每个文件覆盖同名的内置提示词段；没有覆盖的段沿用内置通用 Agent 提示词。修改后重启引擎生效。">
      <section className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-ui-sm font-medium text-foreground">
          覆盖段<span className="font-normal text-foreground-subtlest">{files.length}</span>
        </h3>
        {files.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-ui-sm text-foreground-subtlest">
            目录下没有 .md 分段文件（全部使用内置提示词）
          </div>
        ) : g.dir ? (
          <div className="space-y-3 rounded-xl border border-border/50 bg-surface px-4 py-3">
            {files.map((f) => <FileSection key={f} title={f.replace(/\.md$/, '')} path={`${g.dir}/${f}`} defaultOpen={false} />)}
          </div>
        ) : (
          <DetailSection title="分段文件">
            {files.map((f) => <div key={f} className="font-mono text-ui-sm text-foreground">{f}</div>)}
          </DetailSection>
        )}
      </section>
    </DetailFrame>
  );
}

function RuleDetail({ pluginId }: { pluginId: string }) {
  const catalog = useCatalog();
  const p = pluginById(catalog, pluginId);
  if (!p?.rules) return <ErrorBox message={`插件 ${pluginId} 没有声明领域规范`} />;
  return (
    <DetailFrame icon={<ScrollTextIcon className="size-5" />} title={`${p.id} 规范`}
      desc="领域规范：模式引用插件后，每轮对话把它作为项目上下文注入，约束模型在该领域的做法。修改后下一轮生效。">
      <FileSection title="内容" path={rulesPath(p)} />
    </DetailFrame>
  );
}

export function PromptsTab() {
  const catalog = useCatalog();
  const { route, go } = useNav();
  if (catalog.error) return <ErrorBox message={catalog.error} />;
  if (route.id === BUILTIN_PROMPT_ID) return <BuiltinPromptDetail />;
  if (route.id?.startsWith('rule:')) return <RuleDetail pluginId={route.id.slice(5)} />;
  if (route.id) return <PromptGroupDetail name={route.id} />;
  const rulePlugins = catalog.plugins.filter((p) => p.rules);
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <GroupHeader title="系统提示词" count={1 + catalog.prompts.length} actions={<RefreshButton />} />
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
              />
            ))}
          </ResourceList>
        )}
      </div>
      <div className="space-y-3">
        <GroupHeader title="领域规范" count={rulePlugins.length} />
        {catalog.loaded && rulePlugins.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-ui-sm text-foreground-subtlest">
            还没有插件声明领域规范（plugin.json 的 rules 字段）
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
      <p className="text-ui-xs text-foreground-subtlest">
        系统提示词按段组装，提示词组只放要改写的段，模式在 mode.json 的 prompts 里按名引用；领域规范随插件走，模式引用插件即生效。
      </p>
    </div>
  );
}
