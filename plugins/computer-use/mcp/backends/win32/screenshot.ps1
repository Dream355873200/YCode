# screenshot.ps1 — 屏幕截取（捕获与 JPEG 编码在 YCodeNative.cs C# 侧）
# 输出 { b64, w, h, path }；b64 以 [IMAGE jpeg] 前缀内联给模型。
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path "$PSScriptRoot\YCodeNative.cs" -ReferencedAssemblies System.Drawing.dll
[void][YCodeNative]::SetProcessDPIAware()

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
  $x = 0; $y = 0; $w = 0; $h = 0
  $restored = $false
  # 只给了 name/pid 时先解析成 hwnd——否则会静默退化成"截整屏"，模型以为拿到了窗口画面
  if (-not $in.hwnd -and ($in.name -or $in.pid)) {
    $cands = @()
    if ($in.pid) { $cands = Get-Process | Where-Object { $_.Id -eq [int]$in.pid -and $_.MainWindowHandle -ne 0 } }
    if (-not $cands -and $in.name) {
      $cands = Get-Process | Where-Object { $_.ProcessName -ieq $in.name -and $_.MainWindowHandle -ne 0 }
      if (-not $cands) { $cands = Get-Process | Where-Object { $_.MainWindowTitle -like "*$($in.name)*" -and $_.MainWindowHandle -ne 0 } }
    }
    if ($cands) { $in | Add-Member -NotePropertyName hwnd -NotePropertyValue ([int64]$cands[0].MainWindowHandle) -Force }
  }
  if ($in.hwnd) {
    $hwnd = [IntPtr]$in.hwnd
    # 最小化窗口的矩形是 (-32000,-32000,219,30)，截出来只有灰底——先恢复再取矩形
    try {
      if ([YCodeNative]::IsIconic($hwnd)) {
        [void][YCodeNative]::ShowWindow($hwnd, [YCodeNative]::SW_RESTORE)
        Start-Sleep -Milliseconds 350
        $restored = $true
      }
    } catch {}
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

  # 窗口截图走 PrintWindow（遮挡/硬件加速窗口也能拿到画面）；全屏走 GDI 拷屏
  if ($in.hwnd) { $shot = [YCodeNative]::CaptureWindow($hwnd, $x, $y, $w, $h, 1280, 60) }
  else { $shot = [YCodeNative]::CaptureScreen($x, $y, $w, $h, 1280, 60) }
  $bytes = $shot.Jpeg
  if (-not $bytes -or $bytes.Length -lt 100) { Out @{ __error = '截图失败：画面数据为空' } | Write-Output; exit 0 }
  $b64 = [Convert]::ToBase64String($bytes)

  $dir = Join-Path $env:TEMP 'ycode-cua'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $p = Join-Path $dir ("shot-{0}.jpg" -f [DateTimeOffset]::Now.ToUnixTimeMilliseconds())
  [IO.File]::WriteAllBytes($p, $bytes)

  # 输出宽高按缩放折算
  $long = [Math]::Max($w, $h)
  $scale = 1.0
  if ($long -gt 1280) { $scale = 1280.0 / $long }
  Out @{ b64 = $b64; w = [int]($w * $scale); h = [int]($h * $scale); path = $p; blank = [bool]$shot.Blank; restored = $restored } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
