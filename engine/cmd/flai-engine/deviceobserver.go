// deviceobserver.go 设备锁生命周期观察者。
//
// 锁的释放主路径不再是闲置超时：会话本轮 run 结束（正常完成/出错/
// 被终止——loop 的 defer 都会走到 OnSessionEnd）→ 立即释放设备锁并
// 轮转给排队会话。思考间隙、跑 analyze、写代码期间锁都不会掉。
// 超时（DeviceAutoTimeout）只兜 run 挂死不回调的极端故障态。
package main

import (
	"context"

	"github.com/Dream355873200/GoAgent/observer"

	"github.com/amobileCreater/engine/internal/tools"
)

// deviceLockObserver 会话 run 结束时释放该会话持有的设备锁。
type deviceLockObserver struct {
	observer.NopObserver
}

func (deviceLockObserver) OnSessionStart(_ context.Context, sessionID string) {
	// run 开始即保活一次：清理上轮可能残留的计时器语义，
	// 若上一轮结束回调丢失（进程内异常路径），这里把闲置计时刷新，
	// 交给超时兜底回收，避免双重持锁的窗口。
	tools.TouchDeviceKeepAlive(sessionID)
}

func (deviceLockObserver) OnSessionEnd(_ context.Context, sessionID string, _ int) {
	// run 结束：本轮测试流程（无论走完没走完）到此为止，释放锁。
	// 轮转给队首时 DeviceFreeFn 回调会注入通知唤醒下一个会话。
	tools.ReleaseDevice(sessionID)
}
