# screenshot.ps1 — 屏幕截取（捕获与 JPEG 编码在 YCodeNative.cs C# 侧）
# 输出 { b64, w, h, path }；b64 以 [IMAGE jpeg] 前缀内联给模型。
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path "$PSScriptRoot\YCodeNative.cs" -ReferencedAssemblies System.Drawing.dll
[void][YCodeNative]::SetProcessDPIAware()

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

try {
  if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
  $in = $Payload | ConvertFrom-Json
  $x = 0; $y = 0; $w = 0; $h = 0
  if ($in.hwnd) {
    $hwnd = [IntPtr]$in.hwnd
    # DWM 扩展边框（不含隐形边）；失败退回 GetWindowRect
    $r = New-Object YCodeNative+RECT
    if ([YCodeNative]::DwmGetWindowAttribute($hwnd, 9, [ref]$r, 16) -ne 0) { [void][YCodeNative]::GetWindowRect($hwnd, [ref]$r) }
    $x = $r.Left; $y = $r.Top; $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
    if ($w -le 0 -or $h -le 0) { Out @{ __error = '窗口尺寸为 0（可能最小化）' } | Write-Output; exit 0 }
  } else {
    Add-Type -AssemblyName System.Windows.Forms
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $x = $vs.X; $y = $vs.Y; $w = $vs.Width; $h = $vs.Height
  }

  $bytes = [YCodeNative]::CaptureScreen($x, $y, $w, $h, 1280, 60)
  $b64 = [Convert]::ToBase64String($bytes)

  $dir = Join-Path $env:TEMP 'ycode-cua'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $p = Join-Path $dir ("shot-{0}.jpg" -f [DateTimeOffset]::Now.ToUnixTimeMilliseconds())
  [IO.File]::WriteAllBytes($p, $bytes)

  # 输出宽高按缩放折算
  $long = [Math]::Max($w, $h)
  $scale = 1.0
  if ($long -gt 1280) { $scale = 1280.0 / $long }
  Out @{ b64 = $b64; w = [int]($w * $scale); h = [int]($h * $scale); path = $p } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
