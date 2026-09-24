// 配置与项目注册表（userData 目录持久化）
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const dataDir = () => app.getPath('userData');
const configPath = () => path.join(dataDir(), 'config.json');
const registryPath = () => path.join(dataDir(), 'projects.json');

// 开发模式下项目根 = desktop/..；打包后用可执行文件旁目录
function projectRoot() {
  if (process.env.AMC_ROOT) return process.env.AMC_ROOT;
  return path.resolve(__dirname, '..', '..', '..'); // electron/lib/ → desktop/ → amobileCreater/
}

function defaultConfig() {
  return {
    engine: {
      binary: path.join(projectRoot(), 'engine', 'flai-engine.exe'),
      addr: '127.0.0.1:8420',
      // 默认模式（modes/ 目录下的模式包 id）：新建项目的预选模式，以及
      // 未记录模式的项目的回落值。模式是项目级的（projects.json 的 mode
      // 字段），切换不重启引擎。缺省 code（通用代码 Agent）；可在设置页
      //「模式」里改。
      mode: 'code',
      model: 'DeepSeek-V4-Flash',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      contextWindow: 1_000_000,
      autoStart: true,
    },
    theme: 'dark',
    uiVersion: 'v2', // v2 重构期开关：v2 = 新三帧 UI，v1 = legacy（P4 清理）
  };
}

function loadConfig() {
  const def = defaultConfig();
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf-8'));
    // engine 段逐字段合并：旧配置缺的新字段（如 mode）取默认值
    return { ...def, ...saved, engine: { ...def.engine, ...(saved.engine || {}) } };
  } catch {
    return def;
  }
}
function saveConfig(cfg) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}
function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), 'utf-8'));
  } catch {
    return { projects: [] };
  }
}
function saveRegistry(reg) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2), 'utf-8');
}

module.exports = { projectRoot, loadConfig, saveConfig, loadRegistry, saveRegistry };
