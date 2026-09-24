# state.ps1 — UI Automation 语义元素树（get_app_state）
# 从目标窗口根做 ControlView DFS，输出带序号/类型/名称/值/坐标/runtimeId 的元素表。
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path "$PSScriptRoot\YCodeNative.cs" -ReferencedAssemblies System.Drawing.dll
[void][YCodeNative]::SetProcessDPIAware()
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

try {
  if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
  $in = $Payload | ConvertFrom-Json
  $app = $in.app

  # ---- 定位窗口 ----
  $hwnd = [IntPtr]::Zero
  if ($app -and $app.hwnd) { $hwnd = [IntPtr]$app.hwnd }
  else {
    $cands = @()
    if ($app -and $app.pid) {
      $cands = Get-Process | Where-Object { $_.Id -eq [int]$app.pid -and $_.MainWindowHandle -ne 0 }
    } elseif ($app -and $app.name) {
      $byname = Get-Process | Where-Object { $_.ProcessName -ieq $app.name -and $_.MainWindowHandle -ne 0 }
      if (-not $byname) { $byname = Get-Process | Where-Object { $_.MainWindowTitle -like "*$($app.name)*" -and $_.MainWindowHandle -ne 0 } }
      $cands = $byname
    } else {
      $fgh = [YCodeNative]::GetForegroundWindow()
      $cands = Get-Process | Where-Object { $_.MainWindowHandle -eq $fgh }
      if (-not $cands) { $cands = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
    }
    if ($cands) { $hwnd = $cands[0].MainWindowHandle }
  }
  if ($hwnd -eq [IntPtr]::Zero) { Out @{ __error = 'APP_NOT_FOUND: 找不到目标窗口——先 list_apps / open_app' } | Write-Output; exit 0 }

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $procId = $root.Current.ProcessId
  $title = $root.Current.Name
  if (-not $title) { $title = (Get-Process -Id $procId).ProcessName }

  # ---- DFS ----
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $max = [int]$in.max; if ($max -le 0) { $max = 250 }
  $skip = @('ControlType.MenuItem','ControlType.Thumb','ControlType.TitleBar','ControlType.ScrollBar')
  $elements = New-Object System.Collections.ArrayList
  $truncated = $false
  $stack = New-Object System.Collections.Stack      # 元素栈
  $depths = New-Object System.Collections.Stack     # 深度栈（PowerShell 数组会拍平，不能用元素+深度打包）
  $stack.Push($root); $depths.Push(0)
  while ($stack.Count -gt 0) {
    $el = $stack.Pop(); $depth = $depths.Pop()
    if ($depth -gt 16) { continue }
    $c = $null
    try { $c = $el.Current } catch { continue }
    $tname = ''
    try { $tname = $c.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch {}
    if ($elements.Count -gt 0) {
      if ($skip -contains $tname) { continue }
      if ($c.IsOffscreen -and $depth -gt 1) { continue }
    }
    $idx = $elements.Count
    $name = $c.Name; if ($name) { $name = $name.Trim() }
    $val = $null
    try { if ($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)) { $val = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } } catch {}
    # 能力标注（ZCode 式 actions）：模型据此选择 left_click / set_value / 展开 / 勾选
    $acts = @()
    try { if ($el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)) { $acts += 'press' } } catch {}
    try { if ($el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)) { $acts += 'expand' } } catch {}
    try { if ($el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)) { $acts += 'toggle' } } catch {}
    try { if ($el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)) { $acts += 'select' } } catch {}
    try { if ($el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)) { $acts += 'settable' } } catch {}
    try { if ($c.HasKeyboardFocus) { $acts += 'focused' } } catch {}
    $b = $c.BoundingRectangle
    $cx = 0; $cy = 0
    if ($b.Width -gt 0 -and $b.Height -gt 0) {
      $cx = [int]($b.X + $b.Width / 2); $cy = [int]($b.Y + $b.Height / 2)
      try {
        $pt = $el.GetClickablePoint()
        $cx = [int]$pt.X; $cy = [int]$pt.Y
      } catch {}
    }
    $rt = ''
    try { $rt = ($el.GetRuntimeId() | ForEach-Object { $_ }) -join ',' } catch {}
    $bstr = ''
    if ($b.Width -gt 0) { $bstr = '{0},{1},{2},{3}' -f [int]$b.X, [int]$b.Y, [int]$b.Width, [int]$b.Height }
    [void]$elements.Add(@{
      i = $idx; t = $tname; n = $name; v = $val; rt = $rt
      b = $bstr
      cx = $cx; cy = $cy; off = [bool]$c.IsOffscreen
      a = $acts
    })
    if ($elements.Count -ge $max) { $truncated = $true; break }

    # 子元素压栈（逆序保证 DFS 顺序）
    $child = $walker.GetFirstChild($el)
    $kids = @()
    while ($child -ne $null -and $kids.Count -lt 60) { $kids += $child; $child = $walker.GetNextSibling($child) }
    for ($k = $kids.Count - 1; $k -ge 0; $k--) { $stack.Push($kids[$k]); $depths.Push($depth + 1) }
  }

  Out @{
    hwnd = [int64]$hwnd; pid = $procId; title = $title
    truncated = $truncated; elements = $elements
  } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
