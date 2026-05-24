param(
  [string]$ShareToken = "sureballapi",
  [int]$Port = 8000
)

$startScript = Join-Path $PSScriptRoot "start-sureball-backend-zrok.ps1"
$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$launcherPath = Join-Path $startupDir "Sureball Backend Zrok.cmd"
$command = "@echo off`r`npowershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`" -ShareToken $ShareToken -Port $Port`r`n"

New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
Set-Content -Path $launcherPath -Value $command -Encoding ASCII

Write-Host "Enabled autostart with startup launcher:" -ForegroundColor Green
Write-Host $launcherPath -ForegroundColor Green
Write-Host "It will start after you log in to Windows." -ForegroundColor Green
