param(
  [Parameter(Mandatory = $true)]
  [string]$BackendUrl,
  [string]$Profile = "preview"
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot "frontend"

Write-Host "Building Android app with backend $BackendUrl" -ForegroundColor Cyan

$env:EXPO_PUBLIC_BACKEND_URL = $BackendUrl
npx eas-cli@latest build -p android --profile $Profile
