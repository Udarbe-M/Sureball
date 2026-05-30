param(
  [Parameter(Mandatory = $true)]
  [string]$ShareToken,
  [int]$Port = 8000
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot "backend"
$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"
$backendLog = Join-Path $backendDir "backend-dev.log"
$backendErr = Join-Path $backendDir "backend-dev.err"
$healthUrl = "http://127.0.0.1:$Port/health"

if (-not (Test-Path $pythonExe)) {
  throw "Backend virtual environment is missing at $pythonExe"
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  Write-Host "Starting Sureball backend on port $Port..." -ForegroundColor Cyan
  Start-Process `
    -FilePath $pythonExe `
    -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "$Port" `
    -WorkingDirectory $backendDir `
    -RedirectStandardOutput $backendLog `
    -RedirectStandardError $backendErr `
    -WindowStyle Hidden
} else {
  Write-Host "Backend already listening on port $Port." -ForegroundColor Yellow
}

for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
    if ($health.status -eq "ok") {
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}

try {
  $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
} catch {
  throw "Backend did not become healthy at $healthUrl. Check $backendLog and $backendErr"
}

Write-Host "Backend healthy at $healthUrl" -ForegroundColor Green
Write-Host "Model: $($health.ball_detector_model)" -ForegroundColor Green
Write-Host "Shot training ready: $($health.shot_training_ready)" -ForegroundColor Green
Write-Host ""
Write-Host "Starting reserved zrok share '$ShareToken'..." -ForegroundColor Cyan
Write-Host "Keep this window open while using the app." -ForegroundColor Yellow

zrok share reserved $ShareToken --override-endpoint "http://127.0.0.1:$Port" --headless
