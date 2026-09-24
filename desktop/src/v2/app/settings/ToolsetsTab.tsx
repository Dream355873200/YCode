// 工具集分区：引擎原生元能力（Go 代码实现），模式与插件只能按 id 引用。
// 清单首行是「基础工具」——不属于任何工具集、所有模式恒可用的那部分工具。
import { BlocksIcon, WrenchIcon } from 'lucide-react';
import { baseTools, useCatalog, type ToolInfo } from './catalog';
import { BASE_TOOLSET_ID, useNav } from './nav';
import {
  Chip, DetailFrame, DetailSection, ErrorBox, GroupHeader, Loading, RefreshButton, ResourceList, ResourceRow,
} from './ui';

const PERMISSION: Record<string, string> = {
  ReadOnly: '只读', Normal: '常规', RequireApproval: '需审批', Dangerous: '危险',
};

/** 工具清单：名称 + 权限 + 描述首段（描述来自引擎注册表）。 */
function ToolList({ names, tools }: { names: string[]; tools: ToolInfo[] }) {
  return (
    <>
      {names.map((n) => {
        const t = tools.find((x) => x.name === n);
        const desc = t?.description.split('\n').find((l) => l.trim()) ?? '';
        return (
          <div key={n} className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-ui-sm text-foreground">{n}</span>
              {t && <Chip>{PERMISSION[t.permission] ?? t.permission}</Chip>}
              {t?.concurrent && <Chip>可并发</Chip>}
            </div>
            {desc && <div className="line-clamp-2 text-ui-xs text-foreground-subtlest">{desc}</div>}
          </div>
        );
      })}
    </>
  );
}

function BaseToolsDetail() {
  const catalog = useCatalog();
  const tools = baseTools(catalog);
  return (
    <DetailFrame icon={<WrenchIcon className="size-5" />} title="基础工具"
      desc="引擎内置、所有模式恒可用的工具：文件读写、Bash、检索、任务、计划、提问等。不属于任何工具集，模式无法裁剪。">
      <DetailSection title={`工具（${tools.length}）`}>
        {tools.length
          ? <ToolList names={tools.map((t) => t.name)} tools={catalog.tools} />
          : <span className="text-ui-sm text-foreground-subtlest">引擎未返回工具清单</span>}
      </DetailSection>
    </DetailFrame>
  );
}

function ToolsetDetail({ id }: { id: string }) {
  const catalog = useCatalog();
  const d = catalog.toolsets[id];
  if (!d) return <ErrorBox message={`工具集 ${id} 不存在`} />;
  return (
    <DetailFrame icon={<BlocksIcon className="size-5" />} title={id}
      desc="原生工具集：引擎代码实现，由插件的 toolsets 按 id 打包、模式经插件引用；未启用它的模式会话看不到这些工具。">
      <DetailSection title={`注册工具（${d.tools?.length ?? 0}）`}>
        {(d.tools?.length ?? 0) === 0
          ? <span className="text-ui-sm text-foreground-subtlest">无独立工具（运行期机制型工具集）</span>
          : <ToolList names={d.tools!} tools={catalog.tools} />}
      </DetailSection>
      {(d.notes?.length ?? 0) > 0 && (
        <DetailSection title="运行期机制">
          {d.notes!.map((n, i) => <div key={i} className="text-ui-xs text-foreground-subtle">· {n}</div>)}
        </DetailSection>
      )}
    </DetailFrame>
  );
}

export function ToolsetsTab() {
  const catalog = useCatalog();
  const { route, go } = useNav();
  const { loaded, error } = catalog;
  if (error) return <ErrorBox message={error} />;
  if (route.id === BASE_TOOLSET_ID) return <BaseToolsDetail />;
  if (route.id) return <ToolsetDetail id={route.id} />;
  const entries = Object.entries(catalog.toolsets).sort(([a], [b]) => a.localeCompare(b));
  const base = baseTools(catalog);
  return (
    <div className="space-y-4">
      <GroupHeader title="原生工具集" count={entries.length} actions={<RefreshButton />} />
      {!loaded ? <Loading /> : (
        <ResourceList>
          <ResourceRow
            icon={<WrenchIcon className="size-4" />}
            name="基础工具"
            desc={`${base.length} 个工具 · 所有模式恒可用`}
            onClick={() => go('toolsets', BASE_TOOLSET_ID)}
            right={<Chip>内置</Chip>}
          />
          {entries.map(([id, d]) => (
            <ResourceRow
              key={id}
              icon={<BlocksIcon className="size-4" />}
              name={id}
              desc={(d.tools?.length ?? 0) > 0 ? `工具：${d.tools!.join('、')}` : '运行期机制（无独立工具）'}
              onClick={() => go('toolsets', id)}
            />
          ))}
        </ResourceList>
      )}
      <p className="text-ui-xs text-foreground-subtlest">
        能力分层：原生工具集（本页，引擎 Go 代码）→ 声明层（提示词 / 规范 / 技能 / 子代理 / MCP / 面板）→ 聚合层（插件）→ 组装层（模式 = 提示词组 + 插件）。上层只能引用下层。
      </p>
    </div>
  );
}
