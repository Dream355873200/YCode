// promptbench：tone-style prompt 的 A/B 评测 harness。
//
// 实验形态（控制变量法——测 prompt 的净贡献，不是测模型）：
//   - 固定：模型（本地 Ollama）、工具面（只读文件工具）、任务输入
//   - 变化：只有 system-tone-style.prompt.md（v1 现行版 vs v2 显式化版）
//   - case 设计收窄到 tone-style 真正控制的切面：怎么汇报。
//     不测「会不会修 bug」（那是模型能力，是噪声源）——case 给出
//     现成的任务情境，评它的回复方式。
//
// 判分通道：确定性断言为主（句数/代码标识符/表情符号全机械可判，
// 零裁判噪声），LLMJudge 留空——本地无独立裁判模型（mistral-rp 中文
// 乱码、qwen-rp 被 RP 对齐拦截，qwen3:4b 不被 Ollama 0.4.6 支持）。
//
// 用法：
//
//	cd engine && go run ./cmd/promptbench -repeat 4 -report bench.jsonl
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
	"unicode"

	goagent "github.com/Dream355873200/GoAgent"
	"github.com/Dream355873200/GoAgent/benchmark"
)

func main() {
	repeat := flag.Int("repeat", 2, "每 case 重复次数")
	conc := flag.Int("concurrency", 2, "并发 trial 数（本地模型并发扛不住）")
	baseURL := flag.String("base-url", envOr("FLAI_BASE_URL", "http://localhost:11434/v1"), "Ollama OpenAI 兼容地址")
	model := flag.String("model", envOr("FLAI_MODEL", "qwen3:4b"), "被测模型")
	reportPath := flag.String("report", "", "报告 JSONL 落盘路径（空 = 不落盘）")
	flag.Parse()

	ctx := context.Background()
	here, _ := os.Getwd()
	fixtures := func(p ...string) string { return filepathJoin(here, "fixtures", filepathJoin(p...)) }

	// ---------- 自定义断言：tone-style 五条规则的机械判分 ----------
	mustRegisterToneAsserts()

	// ---------- 被测 target：同一装配，只换 prompt 目录 ----------
	newTarget := func(name, promptDir string) goagent.Target {
		return goagent.NewAgentTarget(name,
			goagent.ProviderConfig{
				Type:     "openai",
				Model:    *model,
				BaseURL:  *baseURL,
				ContextWindow: 32768,
				MaxOutputTokens: 2048,
			},
			goagent.WithPromptDir(promptDir),
			goagent.WithMaxTurns(1), // 汇报类任务一轮即答；不给工具=纯回复切面
		)
	}
	v1 := newTarget("tone-v1", fixtures("prompts-v1"))
	v2 := newTarget("tone-v2", fixtures("prompts-v2"))

	// ---------- case 套件：汇报场景（tone-style 控制的切面）----------
	cases := []goagent.Case{
		{
			ID: "report-done", Family: "report",
			Input: "我让你给创建按钮加的『已创建』提示，加好了吗？",
			Asserts: []goagent.Assert{
				{Type: "tone-concise", Value: 3},            // ≤3 句
				{Type: "tone-no-jargon", Value: nil},        // 无代码标识符
				{Type: "tone-user-visible", Value: nil},     // 描述用户可见变化
			},
		},
		{
			ID: "report-vague-feedback", Family: "report",
			Input: "我这边点保存没反应，是什么问题？",
			Asserts: []goagent.Assert{
				{Type: "tone-concise", Value: 4},
				{Type: "tone-no-jargon", Value: nil},
			},
		},
		{
			ID: "tech-question", Family: "tech",
			// 技术问句 → 允许（且期望）技术细节：jargon 断言取反。
			Input: "保存功能是怎么实现的？用的什么存储方案？",
			Asserts: []goagent.Assert{
				{Type: "tone-no-jargon", Value: nil, Negate: true}, // 应含技术细节
			},
		},
		{
			ID: "plain-ask", Family: "report",
			Input: "能不能把列表往下拉的时候加个转圈？",
			Asserts: []goagent.Assert{
				{Type: "tone-concise", Value: 4},
				{Type: "tone-no-emoji", Value: nil},
			},
		},
	}

	runner := &goagent.Runner{
		Targets:     []goagent.Target{v1, v2},
		Cases:       cases,
		Repeat:      *repeat,
		Concurrency: *conc,
		Timeout:     180_000_000_000, // 3 min/trial：4B 模型本地推理慢
	}
	fmt.Printf("promptbench: model=%s targets=2 cases=%d repeat=%d\n", *model, len(cases), *repeat)
	rep, err := runner.Run(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "run 失败:", err)
		os.Exit(1)
	}

	// ---------- 输出 ----------
	fmt.Println("\n===== per-case 汇总 =====")
	for _, s := range rep.Summaries() {
		fmt.Printf("%-12s %-22s pass %d/%d  score=%.2f±%.2f  turns=%d tokens=%d\n",
			s.Target, s.CaseID, s.Passed, s.Valid, s.MeanScore, s.ScoreStdDev, s.Trials, tokensOf(rep, s))
	}
	fmt.Println("\n===== 失败明细（每 case 首条）=====")
	for _, row := range rep.Rows {
		if row.Status == goagent.StatusFail {
			fmt.Printf("[%s/%s trial%d]\n", row.Target, row.CaseID, row.Trial)
			for _, av := range row.Asserts {
				if !av.Pass {
					fmt.Printf("  ✗ %s: %s\n", av.Type, av.Reason)
				}
			}
			fmt.Printf("  输出: %.200s\n\n", strings.ReplaceAll(row.Output, "\n", " "))
		}
	}

	if *reportPath != "" {
		if err := rep.SaveReport(*reportPath); err != nil {
			fmt.Fprintln(os.Stderr, "报告落盘失败:", err)
		} else {
			fmt.Println("报告已落盘:", *reportPath)
		}
	}
}

func tokensOf(rep *goagent.Report, s goagent.CaseSummary) int64 {
	for _, row := range rep.Rows {
		if row.Target == s.Target && row.CaseID == s.CaseID {
			return row.Tokens
		}
	}
	return 0
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func filepathJoin(parts ...string) string {
	return strings.Join(parts, string(os.PathSeparator))
}

// ---------- tone-* 断言实现 ----------
//
// 三条机械判分（判分越机械噪声越小——这是没有独立裁判模型时的
// 正确姿势；模糊维度留到有裁判模型后再补 judge 通道）：
//   - tone-concise：Value = 最大句数（中英文句号/问号/叹号计句）
//   - tone-no-jargon：输出不含代码标识符（驼峰名/文件名/方法调用
//     三种正则模式）
//   - tone-no-emoji：不含 emoji（Negate 语义由框架统一处理）
//   - tone-user-visible：含「会看到/会出现/会弹/点击后/打开后」类
//     用户视角动词（弱断言，部分分）

var (
	reCamel    = regexp.MustCompile(`\b[A-Z][a-z]+[A-Z][A-Za-z]*\b`)           // FloatingActionButton
	reDartFile = regexp.MustCompile(`\b[\w-]+\.(dart|yaml|json)\b`)           // todo_page.dart
	reCall     = regexp.MustCompile(`\b[A-Za-z_][\w.]*\.[A-Za-z_]\w*\(`)      // ScaffoldMessenger.showSnackBar(
	reEmoji    = regexp.MustCompile(`[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]`)
	reVisible  = regexp.MustCompile(`会看到|会出现|会弹|会显示|点击后|按下后|打开后|屏幕|页面上`)
)

func mustRegisterToneAsserts() {
	benchmark.RegisterAssert("tone-concise", func(_ context.Context, _ benchmark.Case, out benchmark.TargetOutput, a benchmark.Assert) (benchmark.Verdict, error) {
		max, err := numValueOf(a)
		if err != nil {
			return benchmark.Verdict{}, err
		}
		n := countSentences(out.Output)
		if float64(n) <= max {
			return benchmark.Verdict{Pass: true, Score: 1, Reason: fmt.Sprintf("%d 句 ≤ %d", n, int(max))}, nil
		}
		return benchmark.Verdict{Pass: false, Score: 0, Reason: fmt.Sprintf("%d 句 > %d 句上限", n, int(max))}, nil
	})

	benchmark.RegisterAssert("tone-no-jargon", func(_ context.Context, _ benchmark.Case, out benchmark.TargetOutput, _ benchmark.Assert) (benchmark.Verdict, error) {
		leaks := []string{}
		for _, re := range []*regexp.Regexp{reCamel, reDartFile, reCall} {
			if m := re.FindString(out.Output); m != "" {
				leaks = append(leaks, m)
			}
		}
		if len(leaks) == 0 {
			return benchmark.Verdict{Pass: true, Score: 1, Reason: "无代码标识符"}, nil
		}
		return benchmark.Verdict{Pass: false, Score: 0, Reason: fmt.Sprintf("含代码标识符 %v", leaks)}, nil
	})

	benchmark.RegisterAssert("tone-no-emoji", func(_ context.Context, _ benchmark.Case, out benchmark.TargetOutput, _ benchmark.Assert) (benchmark.Verdict, error) {
		if reEmoji.MatchString(out.Output) {
			return benchmark.Verdict{Pass: false, Score: 0, Reason: "含表情符号"}, nil
		}
		return benchmark.Verdict{Pass: true, Score: 1, Reason: "无表情符号"}, nil
	})

	benchmark.RegisterAssert("tone-user-visible", func(_ context.Context, _ benchmark.Case, out benchmark.TargetOutput, _ benchmark.Assert) (benchmark.Verdict, error) {
		if reVisible.MatchString(out.Output) {
			return benchmark.Verdict{Pass: true, Score: 1, Reason: "含用户可见变化描述"}, nil
		}
		return benchmark.Verdict{Pass: false, Score: 0, Reason: "未描述用户可见变化"}, nil
	})
}

// numValueOf 断言 Value 的数字规整（benchmark 包内同款逻辑的本地版）。
func numValueOf(a benchmark.Assert) (float64, error) {
	switch v := a.Value.(type) {
	case float64:
		return v, nil
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case nil:
		return 0, fmt.Errorf("Value 不能为空")
	default:
		return 0, fmt.Errorf("Value 类型 %T 不是数字", a.Value)
	}
}

// countSentences 统计句数：中英文句末标点计数；换行也算分隔。
func countSentences(s string) int {
	n := 0
	for _, r := range s {
		switch r {
		case '。', '！', '？', '.', '!', '?':
			n++
		}
	}
	// 空回复不算句；无标点的短回复算 1 句。
	trimmed := strings.TrimSpace(s)
	if n == 0 && trimmed != "" {
		return 1
	}
	return n
}

var _ = unicode.IsLetter // 保留 unicode 引用（emoji 判定依赖 rune 范围）
var _ = json.Marshal
