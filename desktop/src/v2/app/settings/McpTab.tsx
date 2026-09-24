// MCP 分区：插件声明的 server + 引擎实时连接状态（清单 → 详情）。
// 工具名 mcp__<server>__<tool>，只对引用该插件的模式可见。
import { CableIcon } from 'lucide-react';
import type { MCPServerStatus } from '../modeRegistry';
import { allMcp, useCatalog } from './catalog';
import { useNav } from './nav';
import {
  Chip, DetailFrame, DetailSection, EmptyHint, ErrorBox, GroupHeader, InfoRow, Loading,
  mcpSummary, McpStatusBadge, RefreshButton, ResourceList, ResourceRow, ToolPill,
} from './ui';

function McpDetail({ name }: { name: string }) {
  const catalog = useCatalog();
  const row = allMcp(catalog).find((r) => r.decl.name === name);
  if (!row) return <ErrorBox message={`MCP server ${name} 不存在`} />;
  const { decl: d, status: st } = row;
  // env / headers 只列键名：值常含密钥
  const keys = (m?: Record<string, string>): string => Object.keys(m ?? {}).join('、');
  return (
    <DetailFrame icon={<CableIcon className="size-5" />} title={d.name}
      desc={st?.server ? `服务端：${st.server}` : undefined}
      actions={<McpStatusBadge status={st} />}>
      {st?.status === 'error' && st.error && (
        <div className="break-all rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-xs text-destructive">
          {st.error}
        </div>
      )}
      <DetailSection title="声明">
        <InfoRow label="传输">{d.url ? 'HTTP' : 'stdio'}</InfoRow>
        {d.url
          ? <InfoRow label="URL"><span className="break-all font-mono text-ui-xs">{d.url}</span></InfoRow>
          : <InfoRow label="命令"><span className="break-all font-mono text-ui-xs">{mcpSummary(d)}</span></InfoRow>}
        {d.env && <InfoRow label="环境变量"><span className="font-mono text-ui-xs">{keys(d.env)}</span></InfoRow>}
        {d.headers && <InfoRow label="请求头"><span className="font-mono text-ui-xs">{keys(d.headers)}</span></InfoRow>}
      </DetailSection>
      <DetailSection title={`工具（${st?.tools.length ?? 0}）`}>
        {st?.tools.length
          ? <div className="flex flex-wrap gap-1">{st.tools.map((t) => <ToolPill key={t} name={t} />)}</div>
          : <span className="text-ui-sm text-foreground-subtlest">{st?.status === 'connected' ? '服务端未提供工具' : '连接成功后列出'}</span>}
      </DetailSection>
    </DetailFrame>
  );
}

export function McpTab() {
  const catalog = useCatalog();
  const { route, go } = useNav();
  if (catalog.error) return <ErrorBox message={catalog.error} />;
  if (route.id) return <McpDetail name={route.id} />;
  const rows = allMcp(catalog);
  const count = (st: MCPServerStatus['status']): number => rows.filter((r) => r.status?.status === st).length;
  return (
    <div className="space-y-4">
      <GroupHeader
        title="MCP server"
        count={rows.length}
        actions={
          <div className="flex items-center gap-1.5">
            {count('connected') > 0 && <Chip>已连接 {count('connected')}</Chip>}
            {count('connecting') > 0 && <Chip>连接中 {count('connecting')}</Chip>}
            {count('error') > 0 && <Chip>失败 {count('error')}</Chip>}
            <RefreshButton />
          </div>
        }
      />
      {!catalog.loaded ? <Loading /> : rows.length === 0 ? (
        <EmptyHint
          icon={<CableIcon className="size-8" />}
          title="还没有 MCP server"
          desc="在插件清单（plugin.json）的 mcpServers 里声明 server（name + command 或 url），支持 ${PLUGIN_DIR} 与 ${环境变量} 展开。引擎启动时后台连接，工具只对引用该插件的模式可见。"
        />
      ) : (
        catalog.plugins.filter((p) => (p.mcpServers?.length ?? 0) > 0).map((p) => (
          <div key={p.id} className="space-y-3">
            <GroupHeader title={`${p.id} 插件`} count={p.mcpServers!.length}
              actions={p.usedBy.length === 0 ? <Chip>未启用</Chip> : undefined} />
            <ResourceList>
              {rows.filter((r) => r.plugin.id === p.id).map(({ decl: d, status: st }) => (
                <ResourceRow
                  key={d.name}
                  icon={<CableIcon className="size-4" />}
                  name={d.name}
                  desc={st?.status === 'error' && st.error ? st.error : mcpSummary(d)}
                  onClick={() => go('mcp', d.name)}
                  right={<McpStatusBadge status={st} />}
                />
              ))}
            </ResourceList>
          </div>
        ))
      )}
      <p className="text-ui-xs text-foreground-subtlest">
        修改 MCP 声明后重启引擎生效；连接失败不影响引擎启动，其余工具照常可用。
      </p>
    </div>
  );
}
