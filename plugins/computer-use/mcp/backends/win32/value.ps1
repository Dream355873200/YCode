# value.ps1 — UIA ValuePattern 直接设值（set_value）
# server 传 hwnd + runtime_id（观察时冻结的身份），重枚举找到同一元素再 SetValue。
#
# 定位策略（两遍，兼顾安全与可用）：
#   1) 按序号 expect_i 取元素，身份（runtimeId / 类型+名称）一致 → 直接用；
#   2) 序号已错位（浏览器地址栏这类元素树毫秒级重排）→ 全树按 (类型,名称) 找，
#      唯一匹配才用（唯一性保证不会设错元素），多个匹配仍判 STALE。
# 只有两遍都失败才抛 STALE_STATE——避免"元素明明还在却一直设不上值"。
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

function Get-TypeName($el) {
  $t = ''
  try { $t = $el.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '' } catch {}
  $n = ''
  try { $n = $el.Current.Name } catch {}
  if ($n) { $n = $n.Trim() }
  return @($t, $n)
}

# DFS 枚举顺序必须与 state.ps1 / input.ps1 完全一致（逆序压栈 + 深度上限 20 +
# 子节点上限 80 + 全量计数），否则 @eN 序号跨脚本错位。
function Enumerate-Tree($root) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $depths = New-Object System.Collections.Stack
  $stack.Push($root); $depths.Push(0)
  $out = New-Object System.Collections.ArrayList
  while ($stack.Count -gt 0) {
    $cur = $stack.Pop(); $depth = $depths.Pop()
    if ($depth -gt 20) { continue }
    # 与 state.ps1 一致：.Current 取不到的节点跳过且不占序号，否则两侧 @eN 会错位
    try { $null = $cur.Current } catch { continue }
    [void]$out.Add($cur)
    $child = $walker.GetFirstChild($cur); $kids = @(); $n = 0
    while ($child -ne $null -and $n -lt 80) { $kids += $child; $child = $walker.GetNextSibling($child); $n++ }
    for ($k = $kids.Count - 1; $k -ge 0; $k--) { $stack.Push($kids[$k]); $depths.Push($depth + 1) }
  }
  return $out
}

function Get-RuntimeId($el) {
  $rt = ''
  try { $rt = ($el.GetRuntimeId() | ForEach-Object { $_ }) -join ',' } catch {}
  return $rt
}

try {
  $in = (Read-Payload) | ConvertFrom-Json
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$in.hwnd)
  $all = Enumerate-Tree $root
  $wantT = ''
  if ($in.expect) { $wantT = [string]$in.expect.t }
  $wantN = ''
  if ($in.expect) { $wantN = [string]$in.expect.n }

  $el = $null
  # ---- 第一遍：序号 + 身份 ----
  $i = [int]$in.expect_i
  if ($i -ge 0 -and $i -lt $all.Count) {
    $cand = $all[$i]
    if ((Get-RuntimeId $cand) -eq $in.runtime_id) { $el = $cand }
    else {
      # 易变 UI（浏览器地址栏等）：runtimeId 变了，但同序同类型同名视为同一元素
      $tn = Get-TypeName $cand
      if ($tn[0] -eq $wantT -and $tn[1] -eq $wantN) { $el = $cand }
    }
  }

  # ---- 第二遍：序号错位 → 按 (类型,名称) 全树唯一匹配 ----
  # 名称为空时不启用（只按类型匹配太松，可能设错元素），保持 fail-closed
  if (-not $el -and $wantT -and $wantN) {
    $hits = @()
    foreach ($c in $all) {
      $tn = Get-TypeName $c
      if ($tn[0] -eq $wantT -and $tn[1] -eq $wantN) { $hits += ,$c }
    }
    if ($hits.Count -eq 1) { $el = $hits[0] }
    elseif ($hits.Count -gt 1) {
      throw "STALE_STATE: 元素 [$i] 序号已错位且 (类型,名称) 有 $($hits.Count) 个匹配，无法安全定位——重新 get_app_state 获取新索引"
    }
  }
  if (-not $el) { throw "STALE_STATE: 元素 [$i] 已不存在——重新 get_app_state" }

  # 能力判定必须与 state.ps1 完全一致：state 用 GetCurrentPattern 探测并标注 'settable'，
  # 这里若用 IsValuePatternAvailable 会出现"state 说可设值、set_value 说 NOT_SETTABLE"
  # 的自相矛盾（Chromium 等 provider 上该属性不可靠，实测返回空）。
  $vp = $null
  try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) } catch {}
  if (-not $vp) { throw "NOT_SETTABLE: 该元素不支持 ValuePattern（用 left_click + type 代替）" }
  # 只读元素（浏览器 Document、地址栏等）提前给出可操作的错误，别把 provider 的
  # "Value is read-only" 原始异常抛给模型
  $ro = $false
  try { $ro = [bool]$vp.Current.IsReadOnly } catch {}
  if ($ro) { throw "NOT_SETTABLE: 该元素的值是只读的（Document / 浏览器地址栏等）——用 left_click 获得焦点后 type 输入" }
  $vp.SetValue([string]$in.value)
  Out @{ ok = $true } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
