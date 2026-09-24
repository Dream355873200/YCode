// layout.go 应用资产根目录定位。
//
// 产品资产（modes/plugins/skills）随应用走：开发期为源码树仓库根
// （与 engine/ 同级），打包发行后为 exe 同级目录；FLAI_ROOT 可显式指定。
// 不落用户家目录——资产是应用的一部分，跟着安装目录分发。
package main

import (
	"os"
	"path/filepath"
	"runtime"
)

// assetMarkers 资产目录标记：目录里有任一标记即认定为应用根。
var assetMarkers = []string{"modes", "plugins", "skills"}

// appRoot 应用资产根目录。解析顺序：
//
//  1. FLAI_ROOT 环境变量（显式指定，发行脚本用）
//  2. exe 同级目录带资产标记（打包发行：modes/ plugins/ skills/ 随 exe 分发）
//  3. 源码树仓库根（开发期：layout.go 上溯三级 cmd/flai-engine → engine → 仓库根）
//  4. cwd（兜底）
func appRoot() string {
	if v := os.Getenv("FLAI_ROOT"); v != "" {
		return v
	}
	if exe, err := os.Executable(); err == nil {
		d := filepath.Dir(exe)
		if hasAssetMarker(d) {
			return d
		}
	}
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(file))))
	if hasAssetMarker(root) {
		return root
	}
	return wdOrEmpty()
}

// hasAssetMarker 目录下是否存在任一资产标记子目录。
func hasAssetMarker(dir string) bool {
	for _, m := range assetMarkers {
		if st, err := os.Stat(filepath.Join(dir, m)); err == nil && st.IsDir() {
			return true
		}
	}
	return false
}
