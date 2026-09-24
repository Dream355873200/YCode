// contextBridge：renderer 安全访问主进程能力
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('amc', {
  // 窗口控制（v2 自绘标题栏）
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
  },
  // 引擎（goagent daemon）
  engine: {
    get: (apiPath) => ipcRenderer.invoke('engine:get', apiPath),
    post: (apiPath, body) => ipcRenderer.invoke('engine:post', apiPath, body),
    chat: (payload) => ipcRenderer.invoke('engine:chat', payload),
    restart: () => ipcRenderer.invoke('engine:restart'),
    status: () => ipcRenderer.invoke('engine:status'),
    listModels: () => ipcRenderer.invoke('engine:listModels'),
    bindProject: (sessionId, dir, mode) => ipcRenderer.invoke('engine:bindProject', sessionId, dir, mode),
    onStatus: (cb) => {
      const h = (_e, s) => cb(s);
      ipcRenderer.on('engine:status', h);
      return () => ipcRenderer.removeListener('engine:status', h);
    },
    // SSE 事件流
    onSseBegin: (cb) => { const h = (_e, x) => cb(x); ipcRenderer.on('sse:begin', h); return () => ipcRenderer.removeListener('sse:begin', h); },
    onSseEvent: (cb) => { const h = (_e, x) => cb(x); ipcRenderer.on('sse:event', h); return () => ipcRenderer.removeListener('sse:event', h); },
    onSseDone: (cb) => { const h = (_e, x) => cb(x); ipcRenderer.on('sse:done', h); return () => ipcRenderer.removeListener('sse:done', h); },
    onSseError: (cb) => { const h = (_e, x) => cb(x); ipcRenderer.on('sse:error', h); return () => ipcRenderer.removeListener('sse:error', h); },
  },
  // Git 面板（右栏）：分支/变更/最近提交
  git: {
    status: (dir) => ipcRenderer.invoke('git:status', dir),
  },
  // 配置
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (cfg) => ipcRenderer.invoke('config:save', cfg),
  },
  // 项目
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    create: (p) => ipcRenderer.invoke('projects:create', p),
    setMode: (dir, mode) => ipcRenderer.invoke('projects:setMode', dir, mode),
    remove: (dir) => ipcRenderer.invoke('projects:remove', dir),
    pickDir: () => ipcRenderer.invoke('projects:pickDir'),
    filetree: (dir) => ipcRenderer.invoke('projects:filetree', dir),
  },
  // 文件
  fs: {
    readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
    writeFile: (p, content) => ipcRenderer.invoke('fs:writeFile', p, content),
    listDir: (p) => ipcRenderer.invoke('fs:listDir', p),
    readImage: (p) => ipcRenderer.invoke('fs:readImage', p),
    readFileBase64: (p) => ipcRenderer.invoke('fs:readFileBase64', p),
  },
  // 用户资产目录（设置页编辑器：路径可相对用户资产根；写删限定在其内）
  assets: {
    root: () => ipcRenderer.invoke('assets:root'),
    exists: (p) => ipcRenderer.invoke('assets:exists', p),
    write: (p, content) => ipcRenderer.invoke('assets:write', p, content),
    mkdir: (p) => ipcRenderer.invoke('assets:mkdir', p),
    rm: (p) => ipcRenderer.invoke('assets:rm', p),
    copy: (src, dest) => ipcRenderer.invoke('assets:copy', src, dest),
  },
  // Android 设备与投屏（P2：Web 原生投屏，renderer WebCodecs 解码到 canvas）
  devices: {
    list: () => ipcRenderer.invoke('devices:list'),
    onChanged: (cb) => {
      const h = (_e, x) => cb(x);
      ipcRenderer.on('devices:changed', h);
      return () => ipcRenderer.removeListener('devices:changed', h);
    },
    startMirror: (id) => ipcRenderer.invoke('scrcpy:start', id),
    connectMirror: (id) => ipcRenderer.invoke('scrcpy:connect', id),
    stopMirror: (id) => ipcRenderer.invoke('scrcpy:stop', id),
    onMirrorExited: (cb) => {
      const h = (_e, x) => cb(x);
      ipcRenderer.on('scrcpy:exited', h);
      return () => ipcRenderer.removeListener('scrcpy:exited', h);
    },
    // 主进程经普通 IPC 推 scrcpy 原始流（contextBridge 无法转移 MessagePort）
    onMirrorReady: (cb) => {
      const h = (_e, id) => cb(id);
      ipcRenderer.on('mirror:ready', h);
      return () => ipcRenderer.removeListener('mirror:ready', h);
    },
    onMirrorData: (cb) => {
      const h = (_e, id, chunk) => cb(id, chunk);
      ipcRenderer.on('mirror:data', h);
      return () => ipcRenderer.removeListener('mirror:data', h);
    },
    onMirrorClosed: (cb) => {
      const h = (_e, id) => cb(id);
      ipcRenderer.on('mirror:closed', h);
      return () => ipcRenderer.removeListener('mirror:closed', h);
    },
    writeMirror: (id, chunk) => ipcRenderer.send('mirror:write', id, chunk),
  },
  // 内置浏览器（右栏面板）：实例列表/激活/开关 + 浏览区矩形上报 + 变更推送
  browser: {
    list: () => ipcRenderer.invoke('browser:list'),
    open: (url) => ipcRenderer.invoke('browser:open', url),
    activate: (id) => ipcRenderer.invoke('browser:activate', id),
    back: (id) => ipcRenderer.invoke('browser:back', id),
    forward: (id) => ipcRenderer.invoke('browser:forward', id),
    reload: (id) => ipcRenderer.invoke('browser:reload', id),
    navigate: (id, url) => ipcRenderer.invoke('browser:navigate', id, url),
    devtools: (id) => ipcRenderer.invoke('browser:devtools', id),
    pick: (id) => ipcRenderer.invoke('browser:pick', id),
    pickCancel: (id) => ipcRenderer.invoke('browser:pickCancel', id),
    viewport: (id, fit, vw) => ipcRenderer.invoke('browser:viewport', id, fit, vw),
    close: (id) => ipcRenderer.invoke('browser:close', id),
    setRect: (rect) => ipcRenderer.invoke('browser:rect', rect),
    onChanged: (cb) => {
      const h = (_e, x) => cb(x);
      ipcRenderer.on('browser:changed', h);
      return () => ipcRenderer.removeListener('browser:changed', h);
    },
  },
  // flutter run 部署 + Hot Reload
  flutter: {
    start: (payload) => ipcRenderer.invoke('flutter:start', payload),
    stop: (dir) => ipcRenderer.invoke('flutter:stop', dir),
    reload: (dir) => ipcRenderer.invoke('flutter:reload', dir),
    restart: (dir) => ipcRenderer.invoke('flutter:restart', dir),
    status: (dir) => ipcRenderer.invoke('flutter:status', dir),
    onEvent: (cb) => {
      const h = (_e, x) => cb(x);
      ipcRenderer.on('flutter:evt', h);
      return () => ipcRenderer.removeListener('flutter:evt', h);
    },
  },
});
