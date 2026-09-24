// skillsdir.go 目录式技能扫描（skills/<name>/SKILL.md 布局）。
//
// goagent Registry 原生只认平铺 <name>.md（项目 .yume/commands/ 沿用）；
// 目录式布局（每个技能一个目录，定义文件固定 SKILL.md，同目录可携带
// 参考资产）由宿主侧扫描：解析 frontmatter → 构造 skill.Skill → 经
// 导出 API Register 进主注册表。库不需要感知目录布局概念。
//
// 扫描策略：深度上限 8 层兜底；跳过 node_modules/dist 等内容目录与
// 点目录（这些目录里不存技能，递归吃进去会把单次扫描拖到秒级）。
package main

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/Dream355873200/GoAgent/skill"
)

const skillFileName = "SKILL.md"
const maxSkillScanDepth = 8

// skillScanExcluded 递归扫描直接跳过的子目录名。
var skillScanExcluded = map[string]bool{
	"node_modules": true, "dist": true, "build": true, "out": true,
	"target": true, "vendor": true, "coverage": true, ".cache": true,
	".next": true, ".turbo": true, ".venv": true, "__pycache__": true,
}

// registerDirSkills 扫描 dir 下的目录式技能并注册进 reg（同名让位：
// 已注册的不覆盖，调用方保证优先级顺序——先注册高优先级层）。
func registerDirSkills(reg *skill.Registry, dir string) {
	if dir == "" {
		return
	}
	walkSkillDirs(dir, 0, func(skillDir string) {
		s, ok := loadDirSkill(skillDir)
		if !ok {
			return
		}
		if reg.Get(s.Name) == nil {
			reg.Register(s)
		}
	})
}

// walkSkillDirs 深度优先找出每个含 SKILL.md 的目录。
func walkSkillDirs(dir string, depth int, visit func(skillDir string)) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() || skillScanExcluded[e.Name()] || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		sub := filepath.Join(dir, e.Name())
		if _, err := os.Stat(filepath.Join(sub, skillFileName)); err == nil {
			visit(sub)
			continue // 技能目录不再深入（技能不嵌套技能）
		}
		if depth < maxSkillScanDepth {
			walkSkillDirs(sub, depth+1, visit)
		}
	}
}

// loadDirSkill 读取一个目录式技能：frontmatter（name/description/
// when-to-use/allowed-tools）+ 正文。无 name 时回落目录名；frontmatter
// 缺失或正文为空视为无效技能（跳过，不算错误）。
func loadDirSkill(dir string) (*skill.Skill, bool) {
	data, err := os.ReadFile(filepath.Join(dir, skillFileName))
	if err != nil {
		return nil, false
	}
	content, fm := parseFrontmatter(string(data))
	name := fm["name"]
	if name == "" {
		name = filepath.Base(dir)
	}
	if strings.TrimSpace(content) == "" {
		return nil, false
	}
	// 目录式技能可携带参考资产（如 styles/）：正文前置技能目录绝对路径，
	// 模型按「相对本技能目录」的引用即可 Read 到资产，不依赖会话工作目录。
	content = "技能目录: " + filepath.ToSlash(dir) + "（正文引用的相对路径以此为基准）\n\n" + content
	return &skill.Skill{
		Name:         name,
		Description:  fm["description"],
		WhenToUse:    fm["when-to-use"],
		AllowedTools: fm["allowed-tools"],
		Content:      content,
		Source:       skill.SourceUser,
		Mode:         skill.ModeInline,
		FilePath:     filepath.Join(dir, skillFileName),
	}, true
}

// parseFrontmatter 剥离 YAML frontmatter，返回正文与字段表。
// 只解析所需子集：单行 `key: value` 与 `key:` 后的缩进块（多行
// description 折成一行）；完整 YAML 语法不承诺。
func parseFrontmatter(content string) (string, map[string]string) {
	fm := map[string]string{}
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(normalized, "---\n") {
		return normalized, fm
	}
	rest := normalized[4:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return normalized, fm
	}
	block := rest[:end]
	body := strings.TrimPrefix(rest[end+1:], "---\n")
	body = strings.TrimPrefix(body, "\n")
	var key, multiline string
	flush := func() {
		if key != "" && multiline != "" {
			fm[key] = strings.TrimSpace(multiline)
		}
		multiline = ""
	}
	for _, line := range strings.Split(block, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "-") || trimmed == "" {
			continue
		}
		if line[0] == ' ' || line[0] == '\t' { // 多行块的缩进续行
			if key != "" {
				multiline += " " + trimmed
			}
			continue
		}
		flush()
		k, v, found := strings.Cut(trimmed, ":")
		if !found {
			key = ""
			continue
		}
		key = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if v != "" {
			fm[key] = strings.Trim(v, `"'`)
			multiline = ""
		}
	}
	flush()
	return body, fm
}
