// vision.go L5 多模态视觉裁决（能力开关）：
// 仅当 FLAI_VISION=1 时由 main.go 注册——模型必须支持图片输入（GLM-4V /
// qwen-vl / gpt-4o 等）。未开启时工具不存在，模型不会看到也不会尝试调用，
// 避免「调了报错→重试→浪费轮次」的失败循环。
//
// 实现依赖 goagent provider 的 image 内容块支持（anthropic 原生支持；
// OpenAI 兼容流需要 provider 侧把 image 块转成 image_url 格式）。
package tools

import (
	"encoding/base64"
	"fmt"
	"os"

	goagent "github.com/Dream355873200/GoAgent"
)

type VisionAskInput struct {
	ImagePath string `json:"image_path" desc:"截图文件路径（screenshot 工具的返回值）" required:"true"`
	Question  string `json:"question" desc:"针对截图的问题，如：登录按钮在哪里？页面布局是否正常？有没有明显的 UI 错位？" required:"true"`
}

// NewVisionAskTool 截图 + 提问 → 视觉模型裁决。
// 定位：L3 语义树无法回答的问题（布局美感/对齐/颜色/图标含义）的最后手段；
// 优先用 ui_tree / screen_diff，回答不了再用本工具。
func NewVisionAskTool() (string, goagent.ToolDef) {
	return "vision_ask", goagent.ToolDef{
		Description: "看一张截图并回答问题（多模态视觉判断）。仅用于语义树和像素 diff 无法回答的问题：" +
			"「按钮看起来正常吗」「列表对齐了吗」「这个页面像是登录页吗」。坐标类问题优先 ui_tree，" +
			"变化类问题优先 screen_diff——本工具是最后手段，消耗模型视觉 token。",
		Input:      VisionAskInput{},
		Permission: goagent.ReadOnly,
		Concurrent: true,
		Execute: func(ctx goagent.Context, in VisionAskInput) (string, error) {
			data, err := os.ReadFile(in.ImagePath)
			if err != nil {
				return "", fmt.Errorf("读截图失败: %w", err)
			}
			// 图片以 base64 内联在工具结果中标记，由 provider 层转成多模态消息。
			// 约定格式：结果以 [IMAGE] 前缀 + base64 开头，loop/provider 识别后
			// 构造 image 内容块（当前由 openai provider 的 tool_result 图片通道承接）。
			b64 := base64.StdEncoding.EncodeToString(data)
			return fmt.Sprintf("[IMAGE png %s]\n问题: %s\n（请看上方图片并回答）",
				b64, in.Question), nil
		},
	}
}

// VisionEnabled 环境开关：FLAI_VISION=1 时注册 vision_ask。
func VisionEnabled() bool {
	return os.Getenv("FLAI_VISION") == "1"
}
