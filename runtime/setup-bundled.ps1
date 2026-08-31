param([string[]]$ExtensionIds = @('padicgoaheglbafnjjbjaooakfdcjfmi'))
$ErrorActionPreference = 'Stop'
$bundleRoot = Split-Path -Parent $PSScriptRoot
$llamaSource = Join-Path $bundleRoot 'llama.cpp'
$llamaTarget = Join-Path $env:LOCALAPPDATA 'AnanChrome\LlamaCpp\b10630'
$modelsTarget = Join-Path $env:LOCALAPPDATA 'AnanChrome\Models'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'AnanChrome requires 64-bit Windows.' }
if (-not (Test-Path -LiteralPath (Join-Path $llamaSource 'llama-server.exe'))) { throw 'Extract the entire ZIP before running this installer.' }
Write-Host 'Installing the bundled local engine (no model download yet)...'
New-Item -ItemType Directory -Path $llamaTarget,$modelsTarget -Force | Out-Null
Get-ChildItem -LiteralPath $llamaSource -File | ForEach-Object {
  $destination = Join-Path $llamaTarget $_.Name
  if (-not (Test-Path -LiteralPath $destination) -or
      (Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
  }
}
& (Join-Path $PSScriptRoot 'install-runtime.ps1') -ExtensionIds $ExtensionIds `
  -LlamaServerPath (Join-Path $llamaTarget 'llama-server.exe') -ModelDirectory $modelsTarget
Write-Host ''
Write-Host 'Runtime installed. No administrator privileges are required.' -ForegroundColor Green
Write-Host '1. Open chrome://extensions (or edge://extensions), enable Developer mode.'
Write-Host '2. Choose Load unpacked, then select this folder:'
Write-Host (Join-Path $bundleRoot 'extension') -ForegroundColor Cyan
Write-Host '3. In AnanChrome Settings, click Download Model. Future launches start automatically.'
