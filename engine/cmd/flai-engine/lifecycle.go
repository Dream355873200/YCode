// lifecycle.go 插件资产生命周期注册表（disposer 化，吸收 DeepSeek harness /
// Cordis fiber 的「注册即登记，卸载即逆序撤销」思想）。
//
// 插件的每类资产（子代理工具、MCP 连接，未来还有新资产种类）在装配成功时
// 经 register 登记一个撤销器；资产下线（对账移除 / 插件停用 / 插件卸载）
// 时撤销器负责把它恢复到「从未装配」状态——隐藏工具、断开连接。清理逻辑
// 从此归属资产自己的装配点，新增资产种类不再需要改动各处对账函数。
//
// 与对账的关系：reload 的 want-set 对账负责「差异」（多退少补），本表负责
// 「归属」（每份资产知道自己的插件，整插件撤销一次到位）。
package main

import "sync"

// namedDispose 一个资产的撤销器。
type namedDispose struct {
	asset string
	fn    func()
}

// pluginLifecycleT 按插件索引的资产撤销器表。
type pluginLifecycleT struct {
	mu       sync.Mutex
	byPlugin map[string][]namedDispose
}

var pluginLifecycle = &pluginLifecycleT{byPlugin: map[string][]namedDispose{}}

// register 登记一条资产撤销器（同名覆盖：资产重装时替换旧撤销器）。
func (l *pluginLifecycleT) register(pluginID, asset string, fn func()) {
	l.mu.Lock()
	defer l.mu.Unlock()
	list := l.byPlugin[pluginID]
	for i := range list {
		if list[i].asset == asset {
			list[i].fn = fn
			return
		}
	}
	l.byPlugin[pluginID] = append(list, namedDispose{asset: asset, fn: fn})
}

// dispose 撤销单个资产并移除登记；资产不在表内（从未装配成功）返回 false。
func (l *pluginLifecycleT) dispose(pluginID, asset string) bool {
	l.mu.Lock()
	list := l.byPlugin[pluginID]
	for i := range list {
		if list[i].asset == asset {
			fn := list[i].fn
			l.byPlugin[pluginID] = append(list[:i], list[i+1:]...)
			l.mu.Unlock()
			fn()
			return true
		}
	}
	l.mu.Unlock()
	return false
}

// disposePlugin 撤销整插件的全部资产（逆序），返回撤销的资产名。
// 插件停用/卸载的统一入口。
func (l *pluginLifecycleT) disposePlugin(pluginID string) []string {
	l.mu.Lock()
	list := l.byPlugin[pluginID]
	delete(l.byPlugin, pluginID)
	l.mu.Unlock()
	var out []string
	for i := len(list) - 1; i >= 0; i-- {
		out = append(out, list[i].asset)
		list[i].fn()
	}
	return out
}
