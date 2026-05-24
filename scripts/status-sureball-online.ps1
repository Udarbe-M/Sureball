param(
  [string]$ShareToken = "sureballapi",
  [int]$Port = 8000
)

$taskName = "Sureball Backend Zrok"
$healthUrl = "http://127.0.0.1:$Port/health"
$publicHealthUrl = "https://$ShareToken.share.zrok.io/health"
$startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$launcherPath = Join-Path $startupDir "Sureball Backend Zrok.cmd"

if (Test-Path $launcherPath) {
  Write-Host "Autostart launcher: enabled" -ForegroundColor Green
} else {
  Write-Host "Autostart launcher: disabled" -ForegroundColor Yellow
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Host "Backend port ${Port}: listening (PID $($listener.OwningProcess))" -ForegroundColor Green
} else {
  Write-Host "Backend port ${Port}: not listening" -ForegroundColor Yellow
}

$zrokProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^zrok(\.exe)?$' -and $_.CommandLine -match [regex]::Escape("share reserved $ShareToken")
}
if ($zrokProcesses) {
  $ids = ($zrokProcesses | Select-Object -ExpandProperty ProcessId) -join ", "
  Write-Host "zrok reserved share '$ShareToken': running (PID $ids)" -ForegroundColor Green
} else {
  Write-Host "zrok reserved share '$ShareToken': not running" -ForegroundColor Yellow
}

try {
  $localHealth = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
  Write-Host "Local health: $($localHealth.status)" -ForegroundColor Green
} catch {
  Write-Host "Local health: unavailable" -ForegroundColor Yellow
}

try {
  $publicHealth = Invoke-RestMethod -Uri $publicHealthUrl -TimeoutSec 10
  Write-Host "Public health: $($publicHealth.status)" -ForegroundColor Green
} catch {
  Write-Host "Public health: unavailable" -ForegroundColor Yellow
}
