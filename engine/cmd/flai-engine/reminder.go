// reminder.go 压缩后固定资产重注入（SPEC / 最新测试报告）。
//
// 全量压缩把旧轮次连同 SPEC 约定、测试结论一起折叠成摘要——模型会
// 「忘了范围契约」或「忘了上次哪些用例失败」。本源作为
// compaction.ReminderSource 在每次实际压缩完成后重注：
//   - 项目根的 SPEC.md（范围契约，节选重注全文）
//   - .yume/test-reports/ 下最新的测试报告（最新结论优先）
//
// 已读文件的重水合（Read 回放）由库内 builtin.NewReadStateRehydrater
// 负责（main.go 一并注册）；本文件只管宿主自己的固定资产。
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	goagent "github.com/Dream355873200/GoAgent"
)

// 固定资产重注预算（字符）：压缩刚省下上下文，重注不能反手撑爆。
const (
	assetSpecMax   = 12000 // SPEC.md 节选上限
	assetReportMax = 6000  // 最新测试报告节选上限
)

// assetRehydrater 宿主固定资产重注入源。
type assetRehydrater struct {
	// resolve 会话 → 项目根（与 WithSessionWorkDir 同源，切项目不重启引擎）。
	resolve func(sessionID string) string
}

// Reminders 实现 compaction.ReminderSource。
func (a assetRehydrater) Reminders(ctx context.Context) []string {
	if a.resolve == nil {
		return nil
	}
	root := a.resolve(goagent.SessionIDFromContext(ctx))
	if root == "" {
		return nil
	}

	var out []string
	if b, err := os.ReadFile(filepath.Join(root, "SPEC.md")); err == nil && len(strings.TrimSpace(string(b))) > 0 {
		out = append(out, fmt.Sprintf(
			"[上下文重注] 项目范围契约 SPEC.md（压缩移除了此前的完整内容，以下为当前文件全文/节选——继续开发必须遵守其中的范围与风格约定）:\n\n%s",
			clipAsset(string(b), assetSpecMax)))
	}
	if report := latestTestReport(filepath.Join(root, ".yume", "test-reports")); report != "" {
		out = append(out, fmt.Sprintf(
			"[上下文重注] 最新测试报告（压缩前的测试结论已随上下文折叠，以下为最新一份——后续改动勿回归其中已通过的用例）:\n\n%s",
			clipAsset(report, assetReportMax)))
	}
	return out
}

// clipAsset 超长节选（保留头部——契约与结论多在开头）。
func clipAsset(s string, max int) string {
	s = strings.TrimRight(s, "\n")
	if len(s) <= max {
		return s
	}
	return s[:max] + "\n…（超长截断，完整内容请 Read SPEC.md / 测试报告文件）"
}

// latestTestReport 返回最新一份测试报告内容（按文件名时间戳序，目录
// 不存在或为空返回空串）。
func latestTestReport(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".md") {
			names = append(names, e.Name())
		}
	}
	if len(names) == 0 {
		return ""
	}
	sort.Strings(names) // 报告文件名带 20060102-150405 时间戳前缀，字典序即时间序
	b, err := os.ReadFile(filepath.Join(dir, names[len(names)-1]))
	if err != nil {
		return ""
	}
	return string(b)
}
