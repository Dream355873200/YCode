// debug.go 诊断端点：卡死现场取证。
//
// GET /debug/goroutines 输出全部 goroutine 调用栈（debug=2 完整格式）。
// 不经过 app 锁，引擎其它端点挂住时仍可访问；引擎只监听 127.0.0.1。
package main

import (
	"net/http"
	"runtime/pprof"
)

func debugRoutes() map[string]func(http.ResponseWriter, *http.Request) {
	return map[string]func(http.ResponseWriter, *http.Request){
		"GET /debug/goroutines": func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			_ = pprof.Lookup("goroutine").WriteTo(w, 2)
		},
	}
}
