// confirm.go 对话内确认框工具（agent → 用户的结构化确认）。
//
// 与 AskUser 的纯文本问答不同，confirm 支持三种模式让用户点选：
//
//	single 单选（默认）/ multi 多选 / confirm 纯确认（OK/取消）
//
// 用户可在选项之外补充意见一起提交——回答以「选项 + 意见」的文本形式
// 返回给 agent。
//
// 批量形态（questions 数组）：一次调用发多个确认（SPEC 敲定时一口气问完），
// 前端聚合成队列按 1/N、2/N 逐张作答，全部答完一次性返回给 agent。
// 多个问题必须一次发（「一次性问完，不要挤牙膏」），单个问题用 question。
//
// 链路：confirm 工具 → builtin.SetAskUserCallback 桥接的 AskUserHandler
// → ask_user SSE 事件（结构化载荷在 payload 字段，见 confirmProto.go）→
// 前端解析渲染确认卡 → POST /askuser 回传。
//
// 放本项目而非 goagent：单选/多选确认卡是产品交互语义，不是通用 agent 能力。
package tools

import (
	"encoding/json"
	"fmt"
	"strings"

	goagent "github.com/Dream355873200/GoAgent"
)

// ConfirmQuestion 批量确认里的单个问题。
type ConfirmQuestion struct {
	Question string   `json:"question" desc:"向用户展示的问题（一句话说清要确认什么、影响什么）" required:"true"`
	Mode     string   `json:"mode,omitempty" desc:"single=单选（默认）；multi=多选；confirm=纯确认"`
	Choices  []string `json:"choices,omitempty" desc:"选项列表（single/multi 模式必填，2-6 个为宜）"`
	Detail   string   `json:"detail,omitempty" desc:"补充说明（问题下方灰字），可省略"`
}

// ConfirmInput confirm 工具入参：question 单个 / questions 批量（二选一）。
type ConfirmInput struct {
	Question  string            `json:"question,omitempty" desc:"单个问题（一次只问一个时用）"`
	Questions []ConfirmQuestion `json:"questions,omitempty" desc:"批量问题列表（一次问完所有要点，2-6 个为宜；与 question 二选一）"`
	Mode      string            `json:"mode,omitempty" desc:"single=单选（默认，选项里选一个）；multi=多选；confirm=纯确认（只有 确认/取消 两个按钮）"`
	Choices   []string          `json:"choices,omitempty" desc:"选项列表（single/multi 模式必填，每项一句话，2-6 个为宜）"`
	// Detail 可选的补充说明（确认卡里问题下方的灰字，如方案对比/风险提示）。
	Detail string `json:"detail,omitempty" desc:"补充说明（展示在问题下方，如方案对比、风险提示），可省略"`
}

// NewConfirmTool 返回 confirm 工具定义。ask 回调由引擎 main 接线
// （AskUserHandler.AskSession，按 ctx.SessionID 路由到发起 run 的活跃
// SSE 连接），载荷经协议 ask_user 帧的 payload 字段结构化下发（不再用
// 文本前缀内嵌 JSON；前端对历史回放仍兼容解析旧前缀）。
func NewConfirmTool(ask func(ctx goagent.Context, question string, payload map[string]any) (string, error)) (string, goagent.ToolDef) {
	return "confirm", goagent.ToolDef{
		Description: "向用户弹出确认框并等待选择（支持批量）。三种模式：" +
			"single（默认，选项里选一个）、multi（多选）、confirm（纯确认，只有 确认/取消）。" +
			"用户可在选项之外补充文字意见一起提交。\n" +
			"【批量】有多个要确认的要点时用 questions 数组一次发完（前端以 1/N、2/N 队列逐张" +
			"呈现，用户全部答完你才收到结果）——不要一个个挤牙膏。\n" +
			"适用：SPEC 要点让用户拍板（「账单支持导出吗：支持CSV/支持Excel/不需要」）、" +
			"方案分叉让用户选、执行风险操作前的最后确认、验收测试结果用户是否接受。\n" +
			"不适用：开放性提问（用 AskUser）；授权操作审批（走 permission 流程）。",
		Input:      ConfirmInput{},
		Permission: goagent.ReadOnly,
		Concurrent: false,
		Execute: func(ctx goagent.Context, in ConfirmInput) (string, error) {
			// 归一化：question 单个 → questions 一个元素
			qs := in.Questions
			if in.Question != "" {
				qs = append(qs, ConfirmQuestion{
					Question: in.Question, Mode: in.Mode,
					Choices: in.Choices, Detail: in.Detail,
				})
			}
			if len(qs) == 0 {
				return "", fmt.Errorf("question 或 questions 至少要有一个")
			}
			if len(qs) > 6 {
				return "", fmt.Errorf("问题过多（%d 个，上限 6）——合并相近问题或分批", len(qs))
			}

			// 校验每个问题
			for i, q := range qs {
				if err := validateQuestion(q); err != nil {
					return "", fmt.Errorf("第 %d 个问题: %w", i+1, err)
				}
			}

			// 逐个发问：批量时每个 ask 的 payload 带 total/index，
			// 前端据此聚合成队列（1/N、2/N）。全部答完拼结果返回。
			var answers []string
			for i, q := range qs {
				// 载荷经协议 payload 字段结构化下发（ask_user 帧）。
				payload := ConfirmPayload{
					Question: q.Question,
					Mode:     modeOrDefault(q.Mode),
					Choices:  q.Choices,
					Detail:   q.Detail,
					Index:    i + 1,
					Total:    len(qs),
				}
				b, _ := json.Marshal(payload)
				var raw map[string]any
				_ = json.Unmarshal(b, &raw)
				raw["kind"] = "confirm"
				answer, err := ask(ctx, q.Question, raw)
				if err != nil {
					return "", fmt.Errorf("确认框失败: %w", err)
				}
				if strings.TrimSpace(answer) == "" {
					answer = "(用户未回答)"
				}
				if len(qs) > 1 {
					answers = append(answers, fmt.Sprintf("%d. %s\n   回答：%s", i+1, q.Question, answer))
				} else {
					answers = append(answers, answer)
				}
			}
			return strings.Join(answers, "\n"), nil
		},
	}
}

// validateQuestion 校验单个问题的模式与选项合法性。
func validateQuestion(q ConfirmQuestion) error {
	if strings.TrimSpace(q.Question) == "" {
		return fmt.Errorf("question 不能为空")
	}
	switch modeOrDefault(q.Mode) {
	case "single", "multi":
		if len(q.Choices) < 2 {
			return fmt.Errorf("%s 模式需要至少 2 个选项（choices）", q.Mode)
		}
		if len(q.Choices) > 8 {
			return fmt.Errorf("选项过多（%d 个，上限 8）——合并相近选项或改用开放式提问", len(q.Choices))
		}
	case "confirm":
		if len(q.Choices) > 0 {
			return fmt.Errorf("confirm 模式没有选项（用户只回答 确认/取消），choices 留空")
		}
	default:
		return fmt.Errorf("mode 只能是 single/multi/confirm，收到 %q", q.Mode)
	}
	return nil
}

func modeOrDefault(m string) string {
	if m == "" {
		return "single"
	}
	return m
}
