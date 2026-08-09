$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
. "$PSScriptRoot\ensure-nvm-path.ps1"

if (-not (Test-Path "node_modules\web-ext")) {
  Write-Host "Installing dependencies..."
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npm run firefox:sign
exit $LASTEXITCODE
