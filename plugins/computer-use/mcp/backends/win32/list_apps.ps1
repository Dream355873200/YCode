# list_apps.ps1 — 可见顶层窗口枚举（list_apps / list_windows）
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path "$PSScriptRoot\YCodeNative.cs" -ReferencedAssemblies System.Drawing.dll

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
  $fg = [YCodeNative]::GetForegroundWindow()

  $rows = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
    @{
      hwnd       = [int64]$_.MainWindowHandle
      pid        = $_.Id
      name       = $_.ProcessName
      title      = $_.MainWindowTitle
      foreground = ($_.MainWindowHandle -eq $fg)
      minimized  = [YCodeNative]::IsIconic($_.MainWindowHandle)
    }
  })

  if ($in.mode -eq 'windows') {
    # list_windows：按 app 过滤（pid / 进程名 / 标题包含 / hwnd）
    $app = $in.app
    $out = @($rows | Where-Object {
      if ($app.hwnd) { return $_.hwnd -eq [int64]$app.hwnd }
      if ($app.pid) { return $_.pid -eq [int]$app.pid }
      if ($app.name) { return ($_.name -ieq $app.name) -or ($_.title -like "*$($app.name)*") }
      return $true
    })
    Out @{ windows = $out } | Write-Output
    exit 0
  }

  Out @{ apps = $rows } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
