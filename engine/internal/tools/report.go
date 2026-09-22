// report.go 测试报告工具：把测试过程与结论固化成 Markdown 报告文件，
// 落盘 .yume/test-reports/。报告页签直接读该目录展示（对话流只报结论）。
package tools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	goagent "github.com/Dream355873200/GoAgent"
)

type TestReportInput struct {
	Title string `json:"title" desc:"报告标题（如：登录功能全量测试）" required:"true"`
	// Verdict 总判定：pass / fail / partial（部分通过）
	Verdict string `json:"verdict" desc:"总判定" enum:"pass,fail,partial" required:"true"`
	// Items 结构化条目：名称/状态/证据（截图路径）/备注
	Items string `json:"items" desc:"测试条目 JSON 数组：[{name,status,note,evidence:[截图路径...]}]，status: pass/fail/skip" required:"true"`
	// Extra 自由补充段落（修复记录、环境说明等，Markdown 追加到正文末尾）
	Extra string `json:"extra,omitempty" desc:"补充 Markdown 段落（修复记录/环境说明），追加在条目之后"`
}

type reportItem struct {
	Name     string   `json:"name"`
	Status   string   `json:"status"` // pass | fail | skip
	Note     string   `json:"note,omitempty"`
	Evidence []string `json:"evidence,omitempty"` // 截图文件路径
}

// NewTestReportTool 生成测试报告文件。测试做完必须调用本工具落盘报告——
// 报告是交付物的一部分（报告页签展示、历史可回看），只在对话里说结论不够。
func NewTestReportTool() (string, goagent.ToolDef) {
	return "test_report", goagent.ToolDef{
		Description: "生成 Markdown 测试报告并保存到项目 .yume/test-reports/（含 PASS/FAIL 条目与截图证据）。" +
			"全量测试（收尾外环）完成后必须调用：条目用 items 传 JSON 数组，截图路径填 screenshot 工具返回的路径。" +
			"【截图是硬性要求】每个 pass/fail 条目都必须有 evidence 截图路径——无证据的条目会被拒绝。" +
			"【按页面组织条目】报告按证据截图自动分组：同一页面的条目把相同截图路径填进 evidence，" +
			"它们会归到同一张页面图下列出（一张图对应一组条目，不重复贴图）。" +
			"顺序建议：同页面的条目相邻排列。对话回复里只需告知结论摘要，报告细节由本工具固化。",
		Input:      TestReportInput{},
		Permission: goagent.ReadOnly, // 只写项目内 .yume/ 目录，无破坏性
		Concurrent: false,
		Execute: func(ctx goagent.Context, in TestReportInput) (string, error) {
			var items []reportItem
			if err := json.Unmarshal([]byte(in.Items), &items); err != nil {
				return "", fmt.Errorf("items 必须是 JSON 数组 [{name,status,note,evidence}]（注意：双引号包字符串、中文直接写不需转义、不要在 JSON 里换行加注释）: %v", err)
			}
			if len(items) == 0 {
				return "", fmt.Errorf("items 不能为空")
			}
			verdict := map[string]string{"pass": "✅ 全部通过", "fail": "❌ 存在失败", "partial": "◐ 部分通过"}[in.Verdict]
			if verdict == "" {
				return "", fmt.Errorf("verdict 必须是 pass/fail/partial")
			}
			// 截图硬校验：pass/fail 条目必须有证据（skip 豁免——跳过的
			// 没有可截的）。无图报告对用户毫无说服力，宁可打回让模型补截。
			var noEvidence []string
			for _, it := range items {
				if it.Status == "skip" {
					continue
				}
				if len(it.Evidence) == 0 {
					noEvidence = append(noEvidence, it.Name)
				}
			}
			if len(noEvidence) > 0 {
				return "", fmt.Errorf("以下条目缺少截图证据（pass/fail 必须带 evidence）: %s——"+
					"先对相应页面/功能调 screenshot 工具，再把返回的路径填进 evidence",
					strings.Join(noEvidence, "、"))
			}

			root := projectRootFrom(ctx)
			if root == "" {
				return "", fmt.Errorf("无法定位项目根（.yume/test-reports 需要）")
			}
			dir := filepath.Join(root, ".yume", "test-reports")
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return "", err
			}

			dev, _ := adbDevice(ctx.Context)
			ts := time.Now().Format("20060102-150405")
			slug := reportSlug(in.Title)
			file := filepath.Join(dir, fmt.Sprintf("%s-%s.md", ts, slug))

			npass, nfail := 0, 0
			for _, it := range items {
				switch it.Status {
				case "pass":
					npass++
				case "fail":
					nfail++
				}
			}

			// 证据路径归一化：绝对路径转「相对项目根」+ 正斜杠。
			// frontmatter 的 shots 和正文的图片引用共用此格式（前端
			// readImage 按项目根解析；md 链接里反斜杠/盘符都不合法）。
			relEvidence := func(e string) string {
				e = strings.TrimSpace(e)
				e = filepath.ToSlash(e)
				if rel, err := filepath.Rel(root, e); err == nil && !strings.HasPrefix(rel, "..") {
					return rel
				}
				return e // 已是相对路径或无法归一化：原样保留
			}

			var b strings.Builder
			// frontmatter：报告页签解析结构化字段（列表徽标/统计），正文人类可读
			b.WriteString("---\n")
			fmt.Fprintf(&b, "title: %s\n", in.Title)
			fmt.Fprintf(&b, "verdict: %s\n", in.Verdict)
			fmt.Fprintf(&b, "date: %s\n", time.Now().Format("2006-01-02 15:04:05"))
			fmt.Fprintf(&b, "device: %s\n", dev)
			fmt.Fprintf(&b, "pass: %d\nfail: %d\nskip: %d\ntotal: %d\n",
				npass, nfail, len(items)-npass-nfail, len(items))
			// 截图清单（页签缩略图用，相对项目根的路径）
			b.WriteString("shots:\n")
			for _, it := range items {
				for _, e := range it.Evidence {
					fmt.Fprintf(&b, "  - %s\n", relEvidence(e))
				}
			}
			b.WriteString("---\n\n")

			fmt.Fprintf(&b, "# %s\n\n%s · 设备 %s · %d 条目（✅%d ❌%d）\n\n",
				in.Title, verdict, dev, len(items), npass, nfail)

			// 按证据截图分组渲染：同页面的多个条目共用一张图——图只贴
			// 一次，它证明的所有条目列在图下（去重截图后报告不再一图多贴）。
			// 无证据的条目（skip）归入「跳过」小节。
			type shotGroup struct {
				img    string   // 归一化截图路径
				items  []int    // 引用该图的条目下标
			}
			var groups []*shotGroup
			groupOf := map[string]*shotGroup{}
			var skipped []int
			for i, it := range items {
				if len(it.Evidence) == 0 {
					skipped = append(skipped, i)
					continue
				}
				// 多证据的条目挂到第一张图（其余路径也登记进 frontmatter
				// 清单，详情页都有）。
				key := relEvidence(it.Evidence[0])
				g, ok := groupOf[key]
				if !ok {
					g = &shotGroup{img: key}
					groupOf[key] = g
					groups = append(groups, g)
				}
				g.items = append(g.items, i)
			}

			for gi, g := range groups {
				fmt.Fprintf(&b, "## 页面 %d\n\n", gi+1)
				fmt.Fprintf(&b, "![页面%d](%s)\n\n", gi+1, g.img)
				b.WriteString("| 状态 | 条目 | 备注 |\n|---|---|---|\n")
				for _, i := range g.items {
					it := items[i]
					icon := map[string]string{"pass": "✅", "fail": "❌", "skip": "⏭"}[it.Status]
					if icon == "" {
						icon = "❓"
					}
					note := strings.ReplaceAll(it.Note, "|", "\\|")
					fmt.Fprintf(&b, "| %s | %s | %s |\n", icon, it.Name, note)
				}
				b.WriteString("\n")
			}
			if len(skipped) > 0 {
				b.WriteString("## 跳过的条目\n\n")
				for _, i := range skipped {
					fmt.Fprintf(&b, "- ⏭ %s（%s）\n", items[i].Name, items[i].Note)
				}
				b.WriteString("\n")
			}
			if in.Extra != "" {
				fmt.Fprintf(&b, "## 补充\n\n%s\n", in.Extra)
			}

			if err := os.WriteFile(file, []byte(b.String()), 0o644); err != nil {
				return "", err
			}
			return fmt.Sprintf("报告已保存: %s（%d 条目，✅%d ❌%d）— 回复用户时给出结论摘要即可",
				file, len(items), npass, nfail), nil
		},
	}
}

// reportSlug 标题 → 文件名安全段（中文保留，去标点，空格转-）。
func reportSlug(s string) string {
	s = strings.TrimSpace(s)
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r >= 0x4e00 && r <= 0x9fff: // 中文
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 40 {
		out = out[:40]
	}
	if out == "" {
		out = "report"
	}
	return out
}
