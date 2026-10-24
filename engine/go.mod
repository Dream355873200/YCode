module github.com/amobileCreater/engine

go 1.25.5

require github.com/Dream355873200/GoAgent v0.0.0-20260924063101-d604571845eb

// 开发期替换：引擎用到 SessionSystemPrompt 等尚未提交/发布的库能力。
// 库的改动提交发布后，删除本行并 go get github.com/Dream355873200/GoAgent@latest。
replace github.com/Dream355873200/GoAgent => ../../claude-code-rev-study-main/claude-code-rev-study-main/goagent

require (
	github.com/anthropics/anthropic-sdk-go v1.4.0 // indirect
	github.com/dlclark/regexp2/v2 v2.5.2 // indirect
	github.com/dop251/goja v0.0.0-20260906210903-70ad66ec7ce4 // indirect
	github.com/go-sourcemap/sourcemap v2.1.3+incompatible // indirect
	github.com/google/jsonschema-go v0.4.3 // indirect
	github.com/google/pprof v0.0.0-20230207041349-798e818bf904 // indirect
	github.com/modelcontextprotocol/go-sdk v1.8.0 // indirect
	github.com/segmentio/asm v1.1.3 // indirect
	github.com/segmentio/encoding v0.5.4 // indirect
	github.com/tidwall/gjson v1.14.4 // indirect
	github.com/tidwall/match v1.1.1 // indirect
	github.com/tidwall/pretty v1.2.1 // indirect
	github.com/tidwall/sjson v1.2.5 // indirect
	github.com/yosida95/uritemplate/v3 v3.0.2 // indirect
	golang.org/x/oauth2 v0.35.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/text v0.16.0 // indirect
	golang.org/x/time v0.15.0 // indirect
)
