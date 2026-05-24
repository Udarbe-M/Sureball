param(
  [string]$UniqueName = "sureballapi",
  [int]$Port = 8000
)

$target = "http://127.0.0.1:$Port"

Write-Host "Reserving zrok public share '$UniqueName' for $target..." -ForegroundColor Cyan
zrok reserve public $target --unique-name $UniqueName --json-output
