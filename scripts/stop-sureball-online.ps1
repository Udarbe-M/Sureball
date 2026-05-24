param(
  [string]$ShareToken = "sureballapi",
  [int]$Port = 8000
)

$stoppedAnything = $false

$zrokProcesses = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^zrok(\.exe)?$' -and $_.CommandLine -match [regex]::Escape("share reserved $ShareToken")
}

foreach ($process in $zrokProcesses) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped zrok process $($process.ProcessId)." -ForegroundColor Yellow
  $stoppedAnything = $true
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  Write-Host "Stopped backend process on port $Port (PID $($listener.OwningProcess))." -ForegroundColor Yellow
  $stoppedAnything = $true
}

if (-not $stoppedAnything) {
  Write-Host "No running Sureball backend or zrok share was found." -ForegroundColor Cyan
}
