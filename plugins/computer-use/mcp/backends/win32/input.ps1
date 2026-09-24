# input.ps1 — 鼠标键盘动作（click / drag / scroll / type / key / paste）
# 统一入口：{ action, ... }。元素目标由 server 先经 state 侧重枚举换算成坐标。
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path "$PSScriptRoot\YCodeNative.cs" -ReferencedAssemblies System.Drawing.dll
[void][YCodeNative]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

# 组合键名 → VK
$VK = @{
  'return'=0x0D; 'enter'=0x0D; 'tab'=0x09; 'esc'=0x1B; 'escape'=0x1B; 'space'=0x20; 'backspace'=0x08;
  'delete'=0x2E; 'del'=0x2E; 'insert'=0x2D; 'home'=0x24; 'end'=0x23; 'pageup'=0x21; 'pagedown'=0x22;
  'up'=0x26; 'down'=0x28; 'left'=0x25; 'right'=0x27; 'win'=0x5B; 'super'=0x5B;
  'ctrl'=0x11; 'control'=0x11; 'alt'=0x12; 'shift'=0x10; 'capslock'=0x14; 'menu'=0x5D
}
0..25 | ForEach-Object { $VK[([char](97 + $_)).ToString()] = 0x41 + $_ }   # a-z
0..9  | ForEach-Object { $VK["$_"] = 0x30 + $_ }                        # 0-9
1..24 | ForEach-Object { $VK["f$_"] = 0x6F + $_ }                       # F1-F24

function Send-Chord([string]$combo) {
  $parts = $combo.ToLower() -split '\+' | Where-Object { $_ }
  $mods = @(); $keys = @()
  foreach ($p in $parts) {
    if (@('ctrl','control','alt','shift','win','super') -contains $p) { $mods += $p } else { $keys += $p }
  }
  if ($keys.Count -eq 0) { $keys = @($mods[-1]); $mods = $mods[0..($mods.Count - 2)] }
  foreach ($m in $mods) { [void][YCodeNative]::Key($VK[$m], $false, $false) }
  foreach ($k in $keys) {
    $vk = $VK[$k]
    if (-not $vk) { throw "UNKNOWN_KEY: $k" }
    $ext = @('up','down','left','right','insert','delete','del','home','end','pageup','pagedown','menu') -contains $k
    [void][YCodeNative]::Key([uint16]$vk, $false, $ext)
    Start-Sleep -Milliseconds 15
    [void][YCodeNative]::Key([uint16]$vk, $true, $ext)
  }
  foreach ($m in $mods) { [void][YCodeNative]::Key($VK[$m], $true, $false) }
}

function Resolve-Point([object]$in) {
  # 带元素目标：按 runtimeId 在 hwnd 窗口重枚举复核身份（fail-closed）
  if ($in.runtime_id) {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$in.hwnd)
    $el = $null; $idx = 0
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $stack = New-Object System.Collections.Stack
    $stack.Push($root)
    while ($stack.Count -gt 0 -and -not $el) {
      $cur = $stack.Pop()
      if ($idx -eq [int]$in.expect.i) {
        $rt = ($cur.GetRuntimeId() | ForEach-Object { $_ }) -join ','
        if ($rt -ne $in.runtime_id -or (($cur.Current.ControlType.ProgrammaticName -replace '^ControlType\.','') -ne $in.expect.t)) {
          throw "STALE_STATE: 元素 [$($in.expect.i)] 已变化或消失——重新 get_app_state 获取新索引，不要按旧索引盲点"
        }
        $el = $cur; break
      }
      $idx++
      try { if ($cur.Current.IsOffscreen) { continue } } catch { continue }
      $child = $walker.GetFirstChild($cur); $n = 0
      while ($child -ne $null -and $n -lt 60) { $stack.Push($child); $child = $walker.GetNextSibling($child); $n++ }
    }
    if (-not $el) { throw "STALE_STATE: 元素 [$($in.expect.i)] 已不存在——重新 get_app_state" }
    $pt = $null
    try { $pt = $el.GetClickablePoint() } catch {}
    if (-not $pt -or $pt.X -eq 0) {
      $b = $el.Current.BoundingRectangle
      $pt = [System.Windows.Point]::new($b.X + $b.Width / 2, $b.Y + $b.Height / 2)
    }
    return @([int]$pt.X, [int]$pt.Y)
  }
  return @([int]$in.x, [int]$in.y)
}

try {
  if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
  $in = $Payload | ConvertFrom-Json
  switch ($in.action) {
    'click' {
      $pt = Resolve-Point $in
      [void][YCodeNative]::SetCursorPos($pt[0], $pt[1])
      Start-Sleep -Milliseconds 40
      $flags = @{ 'left'=@([YCodeNative]::MOUSE_LEFTDOWN,[YCodeNative]::MOUSE_LEFTUP); 'right'=@([YCodeNative]::MOUSE_RIGHTDOWN,[YCodeNative]::MOUSE_RIGHTUP); 'middle'=@([YCodeNative]::MOUSE_MIDDLEDOWN,[YCodeNative]::MOUSE_MIDDLEUP) }[[string]$in.button]
      if (-not $flags) { $flags = @([YCodeNative]::MOUSE_LEFTDOWN,[YCodeNative]::MOUSE_LEFTUP) }
      if ($in.modifiers) { ($in.modifiers -split '\+') | ForEach-Object { [void][YCodeNative]::Key($VK[$_], $false, $false) } }
      1..([int]$in.click) | ForEach-Object {
        [void][YCodeNative]::Mouse($flags[0], 0); Start-Sleep -Milliseconds 30
        [void][YCodeNative]::Mouse($flags[1], 0); Start-Sleep -Milliseconds 60
      }
      if ($in.modifiers) { ($in.modifiers -split '\+') | ForEach-Object { [void][YCodeNative]::Key($VK[$_], $true, $false) } }
      Out @{ ok = $true; x = $pt[0]; y = $pt[1] } | Write-Output
    }
    'drag' {
      $from = Resolve-Point $in
      [void][YCodeNative]::SetCursorPos($from[0], $from[1])
      Start-Sleep -Milliseconds 60
      if ($in.modifiers) { ($in.modifiers -split '\+') | ForEach-Object { [void][YCodeNative]::Key($VK[$_], $false, $false) } }
      [void][YCodeNative]::Mouse([YCodeNative]::MOUSE_LEFTDOWN, 0)
      Start-Sleep -Milliseconds 100
      $steps = 12
      1..$steps | ForEach-Object {
        $t = $_ / $steps
        [void][YCodeNative]::SetCursorPos([int]($from[0] + ($in.to_x - $from[0]) * $t), [int]($from[1] + ($in.to_y - $from[1]) * $t))
        Start-Sleep -Milliseconds 20
      }
      Start-Sleep -Milliseconds 60
      [void][YCodeNative]::Mouse([YCodeNative]::MOUSE_LEFTUP, 0)
      if ($in.modifiers) { ($in.modifiers -split '\+') | ForEach-Object { [void][YCodeNative]::Key($VK[$_], $true, $false) } }
      Out @{ ok = $true } | Write-Output
    }
    'scroll' {
      $pt = Resolve-Point $in
      [void][YCodeNative]::SetCursorPos($pt[0], $pt[1])
      Start-Sleep -Milliseconds 40
      $dir = [string]$in.direction; $pages = [int]($in.amount); if ($pages -le 0) { $pages = 1 }
      $notches = $pages * 3
      $flag = [YCodeNative]::MOUSE_WHEEL
      $sign = -1
      if ($dir -eq 'left' -or $dir -eq 'right') { $flag = [YCodeNative]::MOUSE_HWHEEL }
      if ($dir -eq 'up' -or $dir -eq 'left') { $sign = 1 }
      1..$notches | ForEach-Object { [void][YCodeNative]::Mouse($flag, $sign * 120); Start-Sleep -Milliseconds 15 }
      Out @{ ok = $true } | Write-Output
    }
    'type' {
      # 归一换行；逐字符 Unicode SendInput（支持中文）
      $text = [string]$in.text -replace "`r`n", "`n"
      foreach ($ch in $text.ToCharArray()) {
        if ($ch -eq "`n") { [void][YCodeNative]::Key(0x0D, $false, $false); Start-Sleep -Milliseconds 5; [void][YCodeNative]::Key(0x0D, $true, $false); Start-Sleep -Milliseconds 5 }
        else { [void][YCodeNative]::KeyChar($ch); Start-Sleep -Milliseconds 2 }
      }
      Out @{ ok = $true; chars = $text.Length } | Write-Output
    }
    'key' {
      1..([int]($in.repeat)) | ForEach-Object { Send-Chord ([string]$in.text); Start-Sleep -Milliseconds 30 }
      Out @{ ok = $true } | Write-Output
    }
    'paste' {
      # 剪贴板（-STA 已保证）+ ctrl+v
      [System.Windows.Forms.Clipboard]::SetText([string]$in.text)
      Start-Sleep -Milliseconds 80
      [void][YCodeNative]::Key(0x11, $false, $false); Start-Sleep -Milliseconds 30
      [void][YCodeNative]::Key(0x56, $false, $false); Start-Sleep -Milliseconds 30
      [void][YCodeNative]::Key(0x56, $true, $false)
      [void][YCodeNative]::Key(0x11, $true, $false)
      Out @{ ok = $true } | Write-Output
    }
    default { throw "UNKNOWN_ACTION: $($in.action)" }
  }
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
