// flutterRun — 「运行到手机」的状态镜像。flutter run 进程由主进程持有（每个项目一个），
// 这里镜像阶段与日志尾，右栏面板切走再切回不丢；对话一轮改完 Dart 文件后按偏好自动热重载。
import { create } from 'zustand';
import type { FlutterLogLine, FlutterRunStatus } from '../protocol';
import type { Row } from '../conversation/projection/rows';
import { lastTurnEdits } from '../conversation/projection/turns';
import { normalizeDir } from '../app/dirs';

export interface FlutterRun {
  runId: number;
  status: FlutterRunStatus | 'exited';
  deviceId: string;
  log: FlutterLogLine[];
  /** 退出码（exited 时）。 */
  code?: number | null;
  error?: string;
  /** 用户点了停止（退出不算故障）。 */
  stopped?: boolean;
  /** 最近一次重载的结果与时间（面板短暂显示）。 */
  result?: 'reloaded' | 'restarted' | 'failed';
  resultAt?: number;
}

const LOG_TAIL = 80;
const AUTO_KEY = 'ycode.flutter.autoReload';

interface FlutterRunState {
  runs: Record<string, FlutterRun>;
  autoReload: boolean;
  setAutoReload(on: boolean): void;
  /** 面板挂载时对账主进程里的真实运行。 */
  load(dir: string): Promise<void>;
  /** 返回错误文案；成功为 null。 */
  start(dir: string, deviceId: string): Promise<string | null>;
  stop(dir: string): Promise<void>;
  reload(dir: string, full?: boolean): Promise<string | null>;
}

const bridge = () => window.amc.flutter;

export const useFlutterRun = create<FlutterRunState>((set, get) => ({
  runs: {},
  autoReload: localStorage.getItem(AUTO_KEY) !== '0',
  setAutoReload(on) {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0');
    set({ autoReload: on });
  },
  async load(dir) {
    subscribe();
    const key = normalizeDir(dir);
    const r = await bridge().status(dir);
    set((s) => {
      const cur = s.runs[key];
      if (r.running) {
        if (cur && cur.runId === r.runId) return { runs: { ...s.runs, [key]: { ...cur, status: r.status } } };
        return { runs: { ...s.runs, [key]: { runId: r.runId, status: r.status, deviceId: r.deviceId, log: r.log.slice(-LOG_TAIL) } } };
      }
      if (cur && cur.status !== 'exited') return { runs: { ...s.runs, [key]: { ...cur, status: 'exited' } } };
      if (!cur && r.last) {
        const { runId, code, error, log } = r.last;
        return { runs: { ...s.runs, [key]: { runId, status: 'exited', deviceId: '', log, code, error } } };
      }
      return s;
    });
  },
  async start(dir, deviceId) {
    subscribe();
    const r = await bridge().start({ projectDir: dir, deviceId });
    if (!r.ok) return r.error || '启动失败';
    const key = normalizeDir(dir);
    set((s) => {
      const cur = s.runs[key];
      if (cur && r.runId !== undefined && cur.runId >= r.runId) return s;
      return { runs: { ...s.runs, [key]: { runId: r.runId ?? 0, status: 'building', deviceId, log: [] } } };
    });
    return null;
  },
  async stop(dir) {
    const key = normalizeDir(dir);
    set((s) => {
      const cur = s.runs[key];
      return cur ? { runs: { ...s.runs, [key]: { ...cur, status: 'exited', stopped: true } } } : s;
    });
    await bridge().stop(dir);
  },
  async reload(dir, full = false) {
    const cur = get().runs[normalizeDir(dir)];
    if (!cur || cur.status !== 'running') return '应用不在运行';
    const r = full ? await bridge().restart(dir) : await bridge().reload(dir);
    return r.ok ? null : r.error || '重载失败';
  },
}));

// ---------- 主进程事件 → 状态 ----------
// 构建期日志很密：按项目攒批，约每 120ms 合并一次，避免每行一次重渲染。

let subscribed = false;
const pendingLogs = new Map<string, { runId: number; lines: FlutterLogLine[] }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushLogs(): void {
  flushTimer = null;
  if (!pendingLogs.size) return;
  const batch = new Map(pendingLogs);
  pendingLogs.clear();
  useFlutterRun.setState((s) => {
    const runs = { ...s.runs };
    for (const [key, { runId, lines }] of batch) {
      const cur = runs[key];
      if (!cur || cur.runId !== runId) continue;
      runs[key] = { ...cur, log: [...cur.log, ...lines].slice(-LOG_TAIL) };
    }
    return { runs };
  });
}

function subscribe(): void {
  if (subscribed) return;
  subscribed = true;
  bridge().onEvent((e) => {
    const key = normalizeDir(e.projectDir);
    if (e.evt === 'log') {
      const p = pendingLogs.get(key);
      if (p && p.runId === e.runId) p.lines.push({ level: e.level, text: e.text });
      else pendingLogs.set(key, { runId: e.runId, lines: [{ level: e.level, text: e.text }] });
      if (!flushTimer) flushTimer = setTimeout(flushLogs, 120);
      return;
    }
    flushLogs();
    useFlutterRun.setState((s) => {
      const cur = s.runs[key];
      if (cur && e.runId < cur.runId) return s;
      if (e.evt === 'status') {
        const base: FlutterRun = cur && cur.runId === e.runId
          ? cur
          : { runId: e.runId, status: e.status, deviceId: e.deviceId, log: [] };
        if (base.stopped) return s;
        const next: FlutterRun = { ...base, status: e.status, deviceId: e.deviceId };
        if (e.result) { next.result = e.result; next.resultAt = Date.now(); }
        return { runs: { ...s.runs, [key]: next } };
      }
      if (!cur || cur.runId !== e.runId) return s;
      return { runs: { ...s.runs, [key]: { ...cur, status: 'exited', code: e.code, error: e.error } } };
    });
  });
}

// ---------- 改完自动热重载 ----------

/** 项目里有正在运行的应用、偏好开着、这轮改了 Dart → 热重载。返回 null 表示没触发。 */
export async function autoReloadAfterTurn(dir: string, rows: Row[]): Promise<{ ok: boolean; error?: string } | null> {
  const st = useFlutterRun.getState();
  if (!st.autoReload || st.runs[normalizeDir(dir)]?.status !== 'running') return null;
  if (!lastTurnEdits(rows).some((f) => /\.dart$/i.test(f))) return null;
  const err = await st.reload(dir);
  return err ? { ok: false, error: err } : { ok: true };
}
