# value.ps1 — UIA ValuePattern 直接设值（set_value）
# server 传 hwnd + runtime_id（观察时冻结的身份），重枚举找到同一元素再 SetValue。
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

# stdin 是 Node 写入的 UTF-8 字节流；[Console]::In 在中文 Windows 上按 GBK 解码，
# 会把中文解成乱码并搞挂 ConvertFrom-Json。必须显式按 UTF-8 读。
function Read-Payload() {
  if ($Payload) { return $Payload }
  $sr = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
  return $sr.ReadToEnd()
}

try {
  $in = (Read-Payload) | ConvertFrom-Json
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$in.hwnd)
  $el = $null; $idx = 0
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $depths = New-Object System.Collections.Stack
  $stack.Push($root); $depths.Push(0)
  while ($stack.Count -gt 0 -and -not $el) {
    $cur = $stack.Pop(); $depth = $depths.Pop()
    if ($depth -gt 20) { continue }
    if ($idx -eq [int]$in.expect_i) {
      $rt = ($cur.GetRuntimeId() | ForEach-Object { $_ }) -join ','
      if ($rt -ne $in.runtime_id) {
        # 易变 UI（浏览器地址栏等）：runtimeId 变了，但同序同类型同名视为同一元素
        $ctype = ''
        try { $ctype = $cur.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch {}
        if ($ctype -ne $in.expect.t -or ($cur.Current.Name -or '') -ne $in.expect.n) {
          throw "STALE_STATE: 元素已变化——重新 get_app_state"
        }
      }
      $el = $cur; break
    }
    $idx++
    $child = $walker.GetFirstChild($cur); $kids = @(); $n = 0
    while ($child -ne $null -and $n -lt 80) { $kids += $child; $child = $walker.GetNextSibling($child); $n++ }
    for ($k = $kids.Count - 1; $k -ge 0; $k--) { $stack.Push($kids[$k]); $depths.Push($depth + 1) }
  }
  if (-not $el) { throw "STALE_STATE: 元素已不存在——重新 get_app_state" }

  if (-not $el.Current.IsValuePatternAvailable) { throw "NOT_SETTABLE: 该元素不支持 ValuePattern（用 left_click + type 代替）" }
  $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $vp.SetValue([string]$in.value)
  Out @{ ok = $true } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
