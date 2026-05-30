param(
  [string]$ShareToken = "sureballapi",
  [int]$Port = 8000
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$targetScript = Join-Path $PSScriptRoot "start-sureball-backend-zrok.ps1"

if (-not (Test-Path $targetScript)) {
  throw "Missing script: $targetScript"
}

powershell -NoProfile -ExecutionPolicy Bypass -File $targetScript -ShareToken $ShareToken -Port $Port
