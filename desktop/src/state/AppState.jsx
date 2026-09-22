// 全局应用状态：当前项目 / 会话 / 引擎状态 / 屏幕路由
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }) {
  const [screen, setScreen] = useState(0); // 0=项目列表 1=新建 2=工作台
  const [project, setProject] = useState(null); // 当前项目（registry 项）
  const [sessionId, setSessionId] = useState(null);
  const [engine, setEngine] = useState({ status: 'unknown', addr: '', model: '' });
  const [config, setConfig] = useState(null);
  const [usage, setUsage] = useState({ input: 0, output: 0 });

  useEffect(() => {
    window.amc.config.get().then((cfg) => {
      setConfig(cfg);
      setEngine((e) => ({ ...e, model: cfg.engine.model }));
    });
    window.amc.engine.status().then((s) => setEngine((e) => ({ ...e, ...s })));
    const off = window.amc.engine.onStatus((s) => setEngine((e) => ({ ...e, ...s })));
    // 引擎重启后刷新 model 显示
    const t = setInterval(() => {
      window.amc.config.get().then((cfg) => setEngine((e) => (e.model === cfg.engine.model ? e : { ...e, model: cfg.engine.model })));
    }, 3000);
    return () => { off(); clearInterval(t); };
  }, []);

  // 会话 ID 规则：每项目一个持久会话（amc-<目录名>），重开项目可恢复历史
  const sessionIdOf = (p) =>
    p && p.dir ? 'amc-' + p.dir.split(/[\\/]/).filter(Boolean).pop() : null;

  const openProject = useCallback((p) => {
    setProject(p);
    const sid = sessionIdOf(p);
    setSessionId(sid);
    setUsage({ input: 0, output: 0 });
    setScreen(2);
    // 登记 session→项目映射：引擎按会话扎根项目目录（session-map.json），
    // 引擎不重启——切项目只是切会话，另一项目的对话可并行执行互不干扰。
    if (sid && p && p.dir) window.amc.engine.bindProject(sid, p.dir);
  }, []);

  return (
    <AppCtx.Provider value={{
      screen, setScreen, project, openProject,
      sessionId, setSessionId,
      engine, config,
      usage, setUsage,
    }}>
      {children}
    </AppCtx.Provider>
  );
}
