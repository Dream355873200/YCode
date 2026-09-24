# open_app.ps1 — 打开应用（exe/路径/Start 菜单名），返回新窗口信息
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

try {
  if (-not $Payload) { $Payload = [Console]::In.ReadToEnd() }
  $in = $Payload | ConvertFrom-Json
  $name = [string]$in.name
  $before = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty Id)

  $target = $name
  if ($name -match '^[A-Za-z]:\\' -or ($name -match '\.(exe|lnk|bat|cmd)$' -and (Test-Path $name))) {
    # 完整路径直接 Start-Process（.lnk 走 ShellExecute）
    Start-Process -FilePath $name
  } else {
    # 应用名：先试 PATH / App Paths；再搜 Start 菜单 .lnk
    try { Start-Process -FilePath $name; $target = $name }
    catch {
      $roots = @(
        "$env:ProgramData\Microsoft\Windows\Start Menu",
        "$env:AppData\Microsoft\Windows\Start Menu"
      )
      $lnk = Get-ChildItem $roots -Recurse -Filter *.lnk -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -ieq $name } | Select-Object -First 1
      if (-not $lnk) { $lnk = Get-ChildItem $roots -Recurse -Filter *.lnk -ErrorAction SilentlyContinue |
        Where-Object { $_.BaseName -like "*$name*" } | Select-Object -First 1 }
      if (-not $lnk) { throw "APP_NOT_FOUND: 找不到应用 '$name'——用 list_apps 看已开应用，或给完整 exe 路径" }
      Start-Process -FilePath $lnk.FullName
      $target = $lnk.BaseName
    }
  }

  # 等窗口出现（最多 12s）
  $hwnd = 0; $pid2 = 0; $title = ''
  $deadline = (Get-Date).AddSeconds(12)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    $newps = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })
    $fresh = $newps | Where-Object { $before -notcontains $_.Id -or $_.ProcessName -ieq ([IO.Path]::GetFileNameWithoutExtension($target)) }
    foreach ($p in $fresh) {
      if ($p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle; $pid2 = $p.Id; $title = $p.MainWindowTitle; break }
    }
    if ($hwnd) { break }
  }
  Out @{ ok = $true; name = $target; pid = $pid2; hwnd = $hwnd; title = $title } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
