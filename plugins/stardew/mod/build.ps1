# build.ps1 — 编译 YCodeStardew mod 并部署进游戏 Mods 目录。
# 前置：本机装了 SMAPI（ModBuildConfig 会自动定位游戏）与 .NET 6+ SDK。
# 用法：powershell -File build.ps1
$ErrorActionPreference = "Stop"
Write-Host "编译 YCodeStardew mod（dotnet build，ModBuildConfig 自动部署到游戏 Mods）..."
dotnet build "$PSScriptRoot\YCodeStardew.csproj" -c Release
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "编译失败排查："
    Write-Host "  1. 找不到游戏？ModBuildConfig 按注册表/常见 Steam 路径找游戏目录；"
    Write-Host "     特殊安装位置时在 csproj 加 <GamePath>游戏目录</GamePath>"
    Write-Host "  2. 没有 .NET 6 SDK？SMAPI 4 模组需要；winget install Microsoft.DotNet.SDK.6"
    exit 1
}
Write-Host ""
Write-Host "完成。启动游戏（经 SMAPI 启动器），日志里应看到：YCode bridge: http://127.0.0.1:9875"
