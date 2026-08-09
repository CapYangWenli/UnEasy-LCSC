# nvm-windows puts %NVM_HOME% / %NVM_SYMLINK% on PATH, but shells started
# before nvm was installed (or some IDE terminals) never expand those vars.
# Call this from project scripts so `node` is visible to npm/cmd postinstalls.

$nvmHome = [Environment]::GetEnvironmentVariable("NVM_HOME", "User")
if (-not $nvmHome) { $nvmHome = [Environment]::GetEnvironmentVariable("NVM_HOME", "Machine") }
if (-not $nvmHome) { $nvmHome = Join-Path $env:LOCALAPPDATA "nvm" }

$nvmSymlink = [Environment]::GetEnvironmentVariable("NVM_SYMLINK", "User")
if (-not $nvmSymlink) { $nvmSymlink = [Environment]::GetEnvironmentVariable("NVM_SYMLINK", "Machine") }
if (-not $nvmSymlink) { $nvmSymlink = "C:\nvm4w\nodejs" }

$env:NVM_HOME = $nvmHome
$env:NVM_SYMLINK = $nvmSymlink
$env:Path = "$nvmSymlink;$nvmHome;$env:Path"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "node.exe not found at $nvmSymlink. Open a new terminal or run: nvm use <version>"
  exit 1
}
