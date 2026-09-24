# list_apps.ps1 — 可见顶层窗口枚举（list_apps / list_windows）
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path "$PSScriptRoot\YCodeNative.cs" -ReferencedAssemblies System.Drawing.dll

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

try {
  if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
  $in = $Payload | ConvertFrom-Json
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
