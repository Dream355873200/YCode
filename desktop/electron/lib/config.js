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
      model: 'DeepSeek-V4-Flash',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      contextWindow: 1_000_000,
      autoStart: true,
    },
    knowledgeDir: path.join(projectRoot(), 'knowledge', 'skills'),
    theme: 'dark',
  };
}

function loadConfig() {
  try {
    return { ...defaultConfig(), ...JSON.parse(fs.readFileSync(configPath(), 'utf-8')) };
  } catch {
    return defaultConfig();
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
