// v2 协议层：直接复用 vendored goagent-client 的类型与常量。
// 渲染层的 HTTP/SSE 仍走 preload IPC 桥（legacy 复用同一 preload），
// 本层提供类型化能力面供 store 与组件消费。
export type { Envelope, ChatRequest, Description } from 'goagent-client';

import type { Envelope } from 'goagent-client';

/** 帧类型的字面量联合（switch 收窄用）。 */
export type FrameTypeUnion = Envelope['type'];

/** SSE 流生命周期回调包（engine.chat 的 begin/done/error 配套）。 */
export interface SseHandlers {
  onSseBegin: (evt: Envelope) => void;
  onSseEvent: (evt: Envelope) => void;
  onSseDone: () => void;
  onSseError: (err: string) => void;
}

/** SSE 流收尾元数据（sse:done / sse:error 携带，按会话精确收尾）。 */
export interface SseMeta {
  session_id?: string;
  error?: string;
}

/**
 * 渲染层引擎访问口——preload 注入的 window.amc.engine 能力面（类型化）。
 */
export interface EngineBridge {
  get(apiPath: string): Promise<{ unreachable?: boolean; status?: number; body?: unknown }>;
  post(apiPath: string, body?: unknown): Promise<{ status?: number; body?: unknown }>;
  del(apiPath: string): Promise<{ status?: number; body?: unknown }>;
  chat(payload: { message: string; sessionId?: string; resumeQueue?: boolean }): Promise<void>;
  restart(): Promise<unknown>;
  /** 引擎没在跑就拉起（已在跑立即返回）。 */
  ensure(): Promise<unknown>;
  status(): Promise<{ status: string; addr: string }>;
  listModels(): Promise<unknown>;
  onStatus(cb: (s: { status: string; addr: string }) => void): () => void;
  onSseBegin(cb: (evt: Envelope) => void): () => void;
  onSseEvent(cb: (evt: Envelope) => void): () => void;
  onSseDone(cb: (meta?: SseMeta) => void): () => void;
  // preload 单参转发整个 payload（{ session_id, error }），非 (err, meta) 双参
  onSseError(cb: (payload: SseMeta) => void): () => void;
}

/** 用户资产目录操作结果。 */
export interface AssetResult {
  ok: boolean;
  error?: string;
  path?: string;
}

/** 用户资产目录访问口（路径可相对用户资产根；写/删/复制目标越界即失败）。 */
export interface AssetsBridge {
  root(): Promise<string>;
  exists(p: string): Promise<boolean>;
  write(p: string, content: string): Promise<AssetResult>;
  mkdir(p: string): Promise<AssetResult>;
  rm(p: string): Promise<AssetResult>;
  /** 复制内置资产为自定义（src 任意位置，dest 须在用户资产目录内且不存在）。 */
  copy(src: string, dest: string): Promise<AssetResult>;
}

/** 单文件 +/−（git:numstat）。 */
export interface GitFileStat {
  path: string;
  added: number;
  deleted: number;
  binary?: boolean;
  untracked?: boolean;
}

export interface GitBridge {
  status(dir: string): Promise<unknown>;
  numstat(dir: string): Promise<{ ok: boolean; error?: string; files?: GitFileStat[]; added?: number; deleted?: number }>;
  diff(dir: string, file: string, untracked?: boolean): Promise<{ ok: boolean; diff?: string; error?: string }>;
  diffAll(dir: string): Promise<{ ok: boolean; stat?: string; diff?: string }>;
  restore(dir: string, file: string, untracked?: boolean): Promise<{ ok: boolean; error?: string }>;
  commit(dir: string, message: string): Promise<{ ok: boolean; error?: string }>;
  init(dir: string): Promise<{ ok: boolean; error?: string }>;
  branches(dir: string): Promise<{ ok: boolean; error?: string; branches?: Array<{ name: string; current: boolean; when: string }> }>;
  checkout(dir: string, name: string): Promise<{ ok: boolean; error?: string }>;
  createBranch(dir: string, name: string): Promise<{ ok: boolean; error?: string }>;
  push(dir: string): Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    amc: {
      win: {
        minimize(): Promise<void>;
        maximize(): Promise<void>;
        close(): Promise<void>;
      };
      engine: EngineBridge;
      git: GitBridge;
      config: { get(): Promise<Record<string, unknown>>; save(cfg: Record<string, unknown>): Promise<unknown> };
      projects: {
        list(): Promise<unknown>;
        create(p: Record<string, unknown>): Promise<unknown>;
        setMode(dir: string, mode: string): Promise<{ ok: boolean; error?: string }>;
        remove(dir: string): Promise<unknown>;
        rename(dir: string, name: string): Promise<{ ok: boolean; error?: string }>;
        reveal(dir: string): Promise<{ ok: boolean; error?: string }>;
        pickDir(): Promise<string | null>;
        filetree(dir: string): Promise<unknown>;
      };
      fs: {
        readFile(p: string): Promise<unknown>;
        writeFile(p: string, content: string): Promise<unknown>;
        listDir(p: string): Promise<unknown>;
        readImage(p: string): Promise<unknown>;
        readFileBase64(p: string): Promise<{ ok: boolean; b64?: string; error?: string }>;
      };
      assets: AssetsBridge;
      devices: Record<string, (...args: unknown[]) => unknown> & {
        list(): Promise<unknown>;
        onChanged(cb: (x: unknown) => void): () => void;
      };
      flutter: Record<string, (...args: unknown[]) => unknown>;
      browser: {
        list(): Promise<unknown>;
        open(url: string): Promise<unknown>;
        activate(id: string): Promise<unknown>;
        back(id: string): Promise<unknown>;
        forward(id: string): Promise<unknown>;
        reload(id: string): Promise<unknown>;
        navigate(id: string, url: string): Promise<unknown>;
        devtools(id: string): Promise<unknown>;
        pick(id: string): Promise<unknown>;
        pickCancel(id: string): Promise<unknown>;
        close(id: string): Promise<unknown>;
        setRect(rect: { x: number; y: number; width: number; height: number } | null): Promise<unknown>;
        onChanged(cb: (x: unknown) => void): () => void;
      };
    };
  }
}

export const engine: EngineBridge = window.amc.engine;
