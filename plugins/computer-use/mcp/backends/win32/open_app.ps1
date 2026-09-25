# open_app.ps1 — 打开应用（exe/路径/Start 菜单名）或 URL，返回窗口信息
#
# URL 也走这里：交给系统 ShellExecute，用默认浏览器打开。注意 URL 通常不产生新进程
# （只是在既有浏览器里开一个新标签页），所以"新进程/新窗口"探测会失败——这时回退到
# 观察前台窗口是否切换（浏览器被唤起），至少给调用方一个可观察的目标。
param([string]$Payload)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Path "$PSScriptRoot\YCodeNative.cs" -ReferencedAssemblies System.Drawing.dll

function Out([object]$o) { $o | ConvertTo-Json -Depth 4 -Compress }

# stdin 是 Node 写入的 UTF-8 字节流；[Console]::In 在中文 Windows 上按 GBK 解码，
# 会把中文解成乱码并搞挂 ConvertFrom-Json（"计算器" → "璁＄畻鍣?"）。必须显式按 UTF-8 读。
function Read-Payload() {
  if ($Payload) { return $Payload }
  $sr = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)
  return $sr.ReadToEnd()
}

# 默认浏览器的 exe 路径：从 UserChoice(ProgId) → shell\open\command 取。
# URL 场景靠它按进程名找窗口——比"前台窗口是否切换"确定得多（新窗口不一定抢前台）。
function Get-DefaultBrowserExe() {
  try {
    $progId = (Get-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction Stop).ProgId
    if ($progId) {
      $cmd = $null
      foreach ($root in @('HKCU:\SOFTWARE\Classes', 'HKLM:\SOFTWARE\Classes')) {
        $k = "$root\$progId\shell\open\command"
        if (Test-Path $k) { $cmd = (Get-ItemProperty $k).'(default)'; break }
      }
      if ($cmd -match '"([^"]+\.exe)"') { return $Matches[1] }
      if ($cmd -match '^\s*([^\s]+\.exe)') { return $Matches[1] }
    }
  } catch {}
  return $null
}

try {
  $in = (Read-Payload) | ConvertFrom-Json
  $name = [string]$in.name
  if (-not $name) { throw "BAD_ARGS: 需要 name（应用名 / exe 路径 / URL）" }

  $isUrl = ($name -match '^[a-zA-Z][a-zA-Z0-9+.\-]*://') -or ($name -match '^www\.')
  $before = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -ExpandProperty Id)
  $fgBefore = [YCodeNative]::GetForegroundWindow()

  $target = $name
  $browserExe = $null
  if ($isUrl) {
    $browserExe = Get-DefaultBrowserExe
    # ShellExecute：默认浏览器打开（可能只是开个新标签页，不产生新进程）
    Start-Process $name
  } elseif ($name -match '^[A-Za-z]:\\' -or ($name -match '\.(exe|lnk|bat|cmd)$' -and (Test-Path $name))) {
    # 完整路径直接 Start-Process（.lnk 走 ShellExecute）
    Start-Process -FilePath $name
  } else {
    # 应用名：先试 PATH / App Paths；再搜 Start 菜单 .lnk；最后走 shell:AppsFolder（UWP）
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
      if ($lnk) {
        Start-Process -FilePath $lnk.FullName
        $target = $lnk.BaseName
      } else {
        # UWP / Store 应用（计算器、设置、照片…）没有传统 .lnk 可执行入口，
        # 只在 shell:AppsFolder 命名空间里。按显示名匹配后 InvokeVerb 启动。
        $launched = $false
        try {
          $shellApp = New-Object -ComObject Shell.Application
          $items = @($shellApp.NameSpace('shell:AppsFolder').Items())
          $hit = $items | Where-Object { $_.Name -ieq $name } | Select-Object -First 1
          if (-not $hit) { $hit = $items | Where-Object { $_.Name -like "*$name*" } | Select-Object -First 1 }
          if ($hit) {
            $hit.InvokeVerb()
            $target = $hit.Name
            $launched = $true
          }
        } catch {}
        if (-not $launched) {
          throw "APP_NOT_FOUND: 找不到应用 '$name'——用 list_apps 看已开应用，或给完整 exe 路径（UWP 应用请用其显示名，如 计算器 / 设置）"
        }
      }
    }
  }

  # 等窗口出现（URL 场景 6s，其余 12s）
  $hwnd = 0; $pid2 = 0; $title = ''
  $waitSec = 12
  if ($isUrl) { $waitSec = 6 }
  $deadline = (Get-Date).AddSeconds($waitSec)
  $viaForeground = $false
  $viaBrowser = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
    $newps = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })
    $fresh = $newps | Where-Object { $before -notcontains $_.Id -or $_.ProcessName -ieq ([IO.Path]::GetFileNameWithoutExtension($target)) }
    foreach ($p in $fresh) {
      if ($p.MainWindowHandle -ne 0) { $hwnd = $p.MainWindowHandle; $pid2 = $p.Id; $title = $p.MainWindowTitle; break }
    }
    if ($hwnd) { break }
    # URL 场景：直接按默认浏览器的进程名找窗口（最确定，不依赖前台是否切换）
    if ($isUrl -and $browserExe) {
      $bn = [IO.Path]::GetFileNameWithoutExtension($browserExe)
      $bp = Get-Process -Name $bn -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if ($bp) { $hwnd = $bp.MainWindowHandle; $pid2 = $bp.Id; $title = $bp.MainWindowTitle; $viaBrowser = $true; break }
    }
    # 没有新进程（URL 开新标签 / 复用既有实例）：看前台窗口是否切到了别处
    $fg = [YCodeNative]::GetForegroundWindow()
    if ($fg -ne $fgBefore -and $fg -ne [IntPtr]::Zero) {
      $p2 = Get-Process | Where-Object { $_.MainWindowHandle -eq $fg } | Select-Object -First 1
      if ($p2) { $hwnd = $p2.MainWindowHandle; $pid2 = $p2.Id; $title = $p2.MainWindowTitle; $viaForeground = $true; break }
    }
  }
  Out @{
    ok = $true; name = $target; pid = $pid2; hwnd = $hwnd; title = $title
    url = $isUrl; via_foreground = $viaForeground; via_browser = $viaBrowser; browser = $browserExe
  } | Write-Output
} catch {
  @{ __error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
}
