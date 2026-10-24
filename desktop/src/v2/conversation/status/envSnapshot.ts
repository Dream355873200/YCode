// envSnapshot — 当前智能体的插件此刻持有的环境资源（状态面板「工作区」区块）：
// 内置浏览器页面（带浏览器操作插件时）、已连接的真机（带设备插件时）、
// 插件声明的 MCP 服务健康度。只统计与当前智能体相关的资源。
import { useEffect, useMemo, useState } from 'react';
import { engine } from '../../protocol';
import type { ModeDecl } from '../../app/modeRegistry';
import { useBrowserInsts } from '../../pane/browserStore';
import type { EnvSnapshot } from './statusPanelModel';

interface Device { id: string; model?: string; state: string }
type McpServer = NonNullable<EnvSnapshot['mcp']>[number] & { plugin: string };

function useDevices(enabled: boolean): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) { setNames([]); return; }
    const pick = (ds: Device[] | undefined): void =>
      setNames((ds ?? []).filter((d) => d.state === 'device').map((d) => d.model || d.id));
    const amc = window.amc.devices;
    void (amc.list() as Promise<{ devices?: Device[] } | Device[]>)
      .then((r) => pick(Array.isArray(r) ? r : r?.devices))
      .catch(() => {});
    return amc.onChanged((p) => pick((p as { devices?: Device[] }).devices));
  }, [enabled]);
  return names;
}

function useMcp(pluginIds: string[], enabled: boolean): McpServer[] {
  const [servers, setServers] = useState<McpServer[]>([]);
  const key = pluginIds.join(',');
  useEffect(() => {
    if (!enabled || !key) { setServers([]); return; }
    let alive = true;
    const load = (): void => {
      engine.get('/mcp').then((r) => {
        const list = (r.body as { servers?: McpServer[] } | undefined)?.servers;
        if (alive && Array.isArray(list)) setServers(list.filter((s) => key.split(',').includes(s.plugin)));
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [key, enabled]);
  return servers;
}

/** 当前智能体的环境资源快照。enabled = 有对话（草稿态不需要环境明细）。 */
export function useEnvSnapshot(mode: ModeDecl | null, enabled: boolean): EnvSnapshot {
  const plugins = mode?.plugins ?? [];
  const insts = useBrowserInsts();
  const devices = useDevices(enabled && plugins.includes('android-device'));
  const mcp = useMcp(plugins, enabled);
  const browserPages = plugins.includes('browser-use') ? insts.length : 0;
  const deviceKey = devices.join('\u0000');
  const mcpKey = mcp.map((s) => `${s.name}:${s.status}:${s.error ?? ''}`).join('\u0000');
  return useMemo(() => ({
    browserPages,
    devices: deviceKey ? deviceKey.split('\u0000') : [],
    mcp: mcp.map(({ name, status, error }) => ({ name, status, error })),
  // mcp 由 mcpKey 代表其内容
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [browserPages, deviceKey, mcpKey]);
}
