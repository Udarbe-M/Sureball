param()

$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$launcherPath = Join-Path $startupDir "Sureball Backend Zrok.cmd"

if (Test-Path $launcherPath) {
  Remove-Item $launcherPath -Force
  Write-Host "Disabled autostart launcher:" -ForegroundColor Yellow
  Write-Host $launcherPath -ForegroundColor Yellow
} else {
  Write-Host "Autostart launcher was not found." -ForegroundColor Yellow
}
