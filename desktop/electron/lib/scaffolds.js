// scaffolds — 新建项目脚手架注册表。
// mode.json 的 scaffold 字段引用这里的 id（引擎只透传，不解释）；未声明
// scaffold 的模式新建项目 = 打开已有目录。脚手架收到表单字段值
//（mode.json projectFields 声明的 id → 值），在 dir 里生成工程，返回要并入
// 项目注册表的附加字段。新增脚手架 = 在此注册一个函数 + mode.json 引用 id。
const fs = require('fs');
const path = require('path');
const { run } = require('./tools');

const scaffolds = {
  // Flutter 应用：空目录 flutter create → SPEC 草稿 → git init + 首提交
  'flutter-app': async ({ name, dir, idea, kind, color }) => {
    if (!name) return { ok: false, error: '项目名称必填' };
    if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
      return { ok: false, error: '目录非空，请选择空目录' };
    }
    const projectName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^(\d)/, 'a$1');
    fs.mkdirSync(dir, { recursive: true });
    const created = await run('flutter', ['create', '--org', 'com.amobile', '--project-name', projectName, '--platforms', 'android,ios', dir]);
    if (!created.ok) return { ok: false, error: `flutter create 失败: ${created.stderr || created.error}` };

    // 项目级技能目录：引擎按 项目 .yume/commands/ > 模式插件技能 > 全局 skills/
    // 的优先级取用，母本不复制进项目（复制会造成旧拷贝覆盖母本更新），
    // 这里只建空目录供项目定制。
    try {
      fs.mkdirSync(path.join(dir, '.yume', 'commands'), { recursive: true });
    } catch (e) {
      return { ok: false, error: `创建 .yume 失败: ${e.message}` };
    }

    const brand = color || '#3D5AFE';
    fs.writeFileSync(path.join(dir, 'SPEC.md'),
      `# ${name} · 产品规格书 SPEC v1（草稿）\n\n## 想法\n${idea || '（待补充）'}\n\n` +
      `## 应用形态\n${kind === 'go' ? 'App + Go 后端（Gin+GORM）' : '纯移动 App（本地优先）'}\n\n## 品牌主色\n${brand}\n`,
      'utf-8');

    await run('git', ['-C', dir, 'init']);
    await run('git', ['-C', dir, 'add', '.']);
    await run('git', ['-C', dir, 'commit', '-m', 'chore: flutter 脚手架 + SPEC 草稿（amobileCreater）']);
    return { ok: true, record: { idea: idea || '', kind: kind || 'app', color: brand } };
  },
};

module.exports = { scaffolds };
