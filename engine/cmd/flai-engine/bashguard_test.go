package main

import "testing"

// Bash 禁令正则：各形态的 flutter run/attach/daemon 都要拦，
// 合法命令（analyze/build/pub/test/create）不误伤。
func TestBannedCmd(t *testing.T) {
	banned := []string{
		"flutter run",
		"flutter run --machine -d attached",
		"flutter attach",
		"flutter daemon",
		"flutter.exe run",
		"flutter.bat run",
		"cd app && flutter run",
		"flutter build apk && flutter run",
		"echo hi; flutter run -d xxx",
	}
	for _, c := range banned {
		if !bannedCmd.MatchString(c) {
			t.Errorf("应拦截: %q", c)
		}
	}
	allowed := []string{
		"flutter analyze",
		"flutter test",
		"flutter pub get",
		"flutter build apk --debug",
		"flutter create my_app",
		"flutter devices",
		"echo flutter run", // 文本里出现也算拦——宁可误拦（模型不会这么写）
	}
	for _, c := range allowed[:6] {
		if bannedCmd.MatchString(c) {
			t.Errorf("不应拦截: %q", c)
		}
	}
}
