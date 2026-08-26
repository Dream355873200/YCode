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

  const openProject = useCallback((p) => {
    setProject(p);
    setSessionId(null);
    setUsage({ input: 0, output: 0 });
    setScreen(2);
    // 引擎工作区切到项目目录（文件工具必须在项目内工作）
    if (p && p.dir) window.amc.engine.bindProject(p.dir);
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
