# value.ps1 — UIA ValuePattern 直接设值（set_value）
# server 传 hwnd + runtime_id（观察时冻结的身份），重枚举找到同一元素再 SetValue。
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

try {
  if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
  $in = $Payload | ConvertFrom-Json
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$in.hwnd)
  $el = $null; $idx = 0
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $stack.Push($root)
  while ($stack.Count -gt 0 -and -not $el) {
    $cur = $stack.Pop()
    if ($idx -eq [int]$in.expect_i) {
      $rt = ($cur.GetRuntimeId() | ForEach-Object { $_ }) -join ','
      if ($rt -ne $in.runtime_id) { throw "STALE_STATE: 元素已变化——重新 get_app_state" }
      $el = $cur; break
    }
    $idx++
    try { if ($cur.Current.IsOffscreen) { continue } } catch { continue }
    $child = $walker.GetFirstChild($cur); $n = 0
    while ($child -ne $null -and $n -lt 60) { $stack.Push($child); $child = $walker.GetNextSibling($child); $n++ }
  }
  if (-not $el) { throw "STALE_STATE: 元素已不存在——重新 get_app_state" }

  if (-not $el.Current.IsValuePatternAvailable) { throw "NOT_SETTABLE: 该元素不支持 ValuePattern（用 left_click + type 代替）" }
  $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $vp.SetValue([string]$in.value)
  Out @{ ok = $true } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
