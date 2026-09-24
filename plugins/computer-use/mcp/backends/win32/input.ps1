# input.ps1 — 鼠标键盘动作（click / drag / scroll / type / key / paste）
# 统一入口：{ action, ... }。元素目标由 server 先经 state 侧重枚举换算成坐标。
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path "$PSScriptRoot\YCodeNative.cs" -ReferencedAssemblies System.Drawing.dll
[void][YCodeNative]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

# stdin 是 Node 写入的 UTF-8 字节流；[Console]::In 在中文 Windows 上按 GBK 解码，
# 会把中文解成乱码（"计算器" → "璁＄畻鍣?"）并直接搞挂 ConvertFrom-Json。显式按 UTF-8 读。
function Read-Payload() {
  if ($Payload) { return $Payload }
  $sr = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
  return $sr.ReadToEnd()
}

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

# VK 取值统一转 uint16：hashtable 取出来的是 Int32，直接喂给 Key(ushort,bool,bool)
# 会被 .NET 判为 "Argument types do not match"——组合键与修饰键必挂的根因。
function Vk([string]$name) {
  $v = $VK[$name]
  if ($null -eq $v) { throw "UNKNOWN_KEY: $name" }
  return [uint16]$v
}

function Send-Chord([string]$combo) {
  $parts = $combo.ToLower() -split '\+' | Where-Object { $_ }
  $mods = @(); $keys = @()
  foreach ($p in $parts) {
    if (@('ctrl','control','alt','shift','win','super') -contains $p) { $mods += $p } else { $keys += $p }
  }
  if ($keys.Count -eq 0) {
    # 只给了修饰键（如 "ctrl"）：按一下它本身，别把它留在按下状态
    $keys = @($mods[-1])
    if ($mods.Count -gt 1) { $mods = $mods[0..($mods.Count - 2)] } else { $mods = @() }
  }
  foreach ($m in $mods) { [void][YCodeNative]::Key((Vk $m), $false, $false) }
  foreach ($k in $keys) {
    # 注意：变量名不能叫 $vk —— PowerShell 变量名大小写不敏感，$vk 与 $VK 是同一个
    # 变量，赋值会把整个 VK 表覆盖成数字，后续 $VK[$m] 取到 $null（历史 bug）。
    $code = Vk $k
    $ext = @('up','down','left','right','insert','delete','del','home','end','pageup','pagedown','menu') -contains $k
    [void][YCodeNative]::Key([uint16]$code, $false, $ext)
    Start-Sleep -Milliseconds 15
    [void][YCodeNative]::Key([uint16]$code, $true, $ext)
  }
  foreach ($m in $mods) { [void][YCodeNative]::Key((Vk $m), $true, $false) }
}

function Get-TypeName($el) {
  $t = ''
  try { $t = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch {}
  $n = ''
  try { $n = $el.Current.Name } catch {}
  if ($n) { $n = $n.Trim() }
  return @($t, $n)
}

function Get-RuntimeId($el) {
  $rt = ''
  try { $rt = ($el.GetRuntimeId() | ForEach-Object { $_ }) -join ',' } catch {}
  return $rt
}

# 遍历算法必须与 state.ps1 完全一致：逆序压栈的 DFS + 深度上限 20 + 子节点上限 80 +
# 全量计数，否则 @eN 序号在两侧错位，会误判 STALE 或点错元素。
function Enumerate-Tree($root) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $depths = New-Object System.Collections.Stack
  $stack.Push($root); $depths.Push(0)
  $out = New-Object System.Collections.ArrayList
  while ($stack.Count -gt 0) {
    $cur = $stack.Pop(); $depth = $depths.Pop()
    if ($depth -gt 20) { continue }
    [void]$out.Add($cur)
    $child = $walker.GetFirstChild($cur); $kids = @(); $n = 0
    while ($child -ne $null -and $n -lt 80) { $kids += $child; $child = $walker.GetNextSibling($child); $n++ }
    for ($k = $kids.Count - 1; $k -ge 0; $k--) { $stack.Push($kids[$k]); $depths.Push($depth + 1) }
  }
  return $out
}

function Resolve-Point([object]$in) {
  # 带元素目标：在 hwnd 窗口重枚举复核身份。两遍定位：
  #   1) 序号 + 身份（runtimeId 或 类型+名称）一致 → 直接用；
  #   2) 序号已错位（浏览器地址栏这类元素树毫秒级重排）→ 全树按 (类型,名称) 找，
  #      名称非空且唯一匹配才用（唯一性 + 有名 双重约束，避免点到同名/无名元素）；
  #      多个匹配或名称为空仍判 STALE（保持 fail-closed）。
  if ($in.runtime_id) {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$in.hwnd)
    $all = Enumerate-Tree $root
    $wantT = [string]$in.expect.t
    $wantN = ''
    if ($in.expect.n) { $wantN = ([string]$in.expect.n).Trim() }
    $i = [int]$in.expect.i

    $el = $null
    if ($i -ge 0 -and $i -lt $all.Count) {
      $cand = $all[$i]
      if ((Get-RuntimeId $cand) -eq $in.runtime_id) { $el = $cand }
      else {
        $tn = Get-TypeName $cand
        if ($tn[0] -eq $wantT -and $tn[1] -eq $wantN) { $el = $cand }
      }
    }
    if (-not $el -and $wantN) {
      $hits = @()
      foreach ($c in $all) {
        $tn = Get-TypeName $c
        if ($tn[0] -eq $wantT -and $tn[1] -eq $wantN) { $hits += ,$c }
      }
      if ($hits.Count -eq 1) { $el = $hits[0] }
      elseif ($hits.Count -gt 1) { throw "STALE_STATE: 元素 [$i] 序号已错位且 (类型,名称) 有 $($hits.Count) 个匹配，无法安全定位——重新 get_app_state" }
    }
    if (-not $el) { throw "STALE_STATE: 元素 [$i] 已不存在——重新 get_app_state" }
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
  $in = (Read-Payload) | ConvertFrom-Json
  switch ($in.action) {
    'click' {
      $pt = Resolve-Point $in
      [void][YCodeNative]::SetCursorPos($pt[0], $pt[1])
      Start-Sleep -Milliseconds 40
      $flags = @{ 'left'=@([YCodeNative]::MOUSE_LEFTDOWN,[YCodeNative]::MOUSE_LEFTUP); 'right'=@([YCodeNative]::MOUSE_RIGHTDOWN,[YCodeNative]::MOUSE_RIGHTUP); 'middle'=@([YCodeNative]::MOUSE_MIDDLEDOWN,[YCodeNative]::MOUSE_MIDDLEUP) }[[string]$in.button]
      if (-not $flags) { $flags = @([YCodeNative]::MOUSE_LEFTDOWN,[YCodeNative]::MOUSE_LEFTUP) }
      if ($in.modifiers) { ($in.modifiers -split '\+') | ForEach-Object { [void][YCodeNative]::Key((Vk $_), $false, $false) } }
      1..([int]$in.click) | ForEach-Object {
        [void][YCodeNative]::Mouse($flags[0], 0); Start-Sleep -Milliseconds 30
        [void][YCodeNative]::Mouse($flags[1], 0); Start-Sleep -Milliseconds 60
      }
      if ($in.modifiers) { ($in.modifiers -split '\+') | ForEach-Object { [void][YCodeNative]::Key((Vk $_), $true, $false) } }
      Out @{ ok = $true; x = $pt[0]; y = $pt[1] } | Write-Output
    }
    'drag' {
      $from = Resolve-Point $in
      [void][YCodeNative]::SetCursorPos($from[0], $from[1])
      Start-Sleep -Milliseconds 60
      if ($in.modifiers) { ($in.modifiers -split '\+') | ForEach-Object { [void][YCodeNative]::Key((Vk $_), $false, $false) } }
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
      if ($in.modifiers) { ($in.modifiers -split '\+') | ForEach-Object { [void][YCodeNative]::Key((Vk $_), $true, $false) } }
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
  @{ __error = $_.Exception.Message; __stack = ($_.ScriptStackTrace -split "`n" | Select-Object -First 3) -join ' <- ' } | ConvertTo-Json -Compress | Write-Output
}
