param(
  [string[]]$ExtensionIds = @('padicgoaheglbafnjjbjaooakfdcjfmi')
)

$ErrorActionPreference = 'Stop'
$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$cacheDir = Join-Path $env:LOCALAPPDATA 'AnanChrome\Downloads'
$llamaInstallDir = Join-Path $env:LOCALAPPDATA 'AnanChrome\LlamaCpp'
$modelInstallDir = Join-Path $env:LOCALAPPDATA 'AnanChrome\Models'
$setupTemp = Join-Path $env:TEMP ("AnanChromeSetup-" + [Guid]::NewGuid().ToString('N'))

$llamaUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/b10630/llama-b10630-bin-win-cuda-12.4-x64.zip'
$llamaSha256 = '12baa0aa3c7246c9520682b759fe547c368215e733ccae8837c17baeddf48174'
$cudaUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/b10630/cudart-llama-bin-win-cuda-12.4-x64.zip'
$cudaSha256 = '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6'
$modelUrl = 'https://huggingface.co/ccharnkij/Qwen3.5-9B-Uncensored-GGUF/resolve/main/Qwen3.5-9B-Uncensored-Q4_K_M.gguf?download=true'
$modelSha256 = '07bc471491a5ef2f87257b8d46964a892cdaf9af6d05de4a7b03715bfe4590ae'
$modelName = 'Qwen3.5-9B-Uncensored-Q4_K_M.gguf'

function Test-Hash([string]$Path, [string]$ExpectedHash) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.Equals(
    $ExpectedHash,
    [StringComparison]::OrdinalIgnoreCase
  )
}

function Download-Verified(
  [string]$Url,
  [string]$Destination,
  [string]$ExpectedHash,
  [string]$DisplayName
) {
  if (Test-Hash $Destination $ExpectedHash) {
    Write-Host "$DisplayName is already downloaded and verified."
    return
  }

  if (Test-Path -LiteralPath $Destination) {
    Remove-Item -LiteralPath $Destination -Force
  }

  Write-Host "Downloading $DisplayName ..." -ForegroundColor Cyan
  Import-Module BitsTransfer -ErrorAction Stop
  Start-BitsTransfer -Source $Url -Destination $Destination -DisplayName "AnanChrome - $DisplayName"

  Write-Host "Verifying $DisplayName ..."
  if (-not (Test-Hash $Destination $ExpectedHash)) {
    Remove-Item -LiteralPath $Destination -Force
    throw "$DisplayName failed SHA-256 verification."
  }
}

New-Item -ItemType Directory -Path $cacheDir,$llamaInstallDir,$modelInstallDir,$setupTemp -Force | Out-Null

$llamaZip = Join-Path $cacheDir 'llama-b10630-bin-win-cuda-12.4-x64.zip'
$cudaZip = Join-Path $cacheDir 'cudart-llama-bin-win-cuda-12.4-x64.zip'
$downloadedModel = Join-Path $cacheDir $modelName
$installedModel = Join-Path $modelInstallDir $modelName

try {
  Download-Verified $llamaUrl $llamaZip $llamaSha256 'llama.cpp CUDA 12.4 runtime'
  Download-Verified $cudaUrl $cudaZip $cudaSha256 'CUDA 12.4 libraries'

  $modelReady = Test-Hash $installedModel $modelSha256
  if (-not $modelReady) {
    Download-Verified $modelUrl $downloadedModel $modelSha256 'Qwen3.5-9B Q4_K_M model (about 5.24 GiB)'
    Move-Item -LiteralPath $downloadedModel -Destination $installedModel -Force
  } else {
    Write-Host 'The model is already installed and verified.'
  }

  $extractDir = Join-Path $setupTemp 'llama.cpp'
  New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
  Expand-Archive -LiteralPath $llamaZip -DestinationPath $extractDir -Force
  Expand-Archive -LiteralPath $cudaZip -DestinationPath $extractDir -Force

  $serverFile = Get-ChildItem -LiteralPath $extractDir -Filter 'llama-server.exe' -File -Recurse | Select-Object -First 1
  if (-not $serverFile) { throw 'llama-server.exe was not found after extraction.' }
  if (Test-Path -LiteralPath $llamaInstallDir) {
    Get-ChildItem -LiteralPath $llamaInstallDir -Force | Remove-Item -Recurse -Force
  }
  Get-ChildItem -LiteralPath $extractDir -File -Recurse | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $llamaInstallDir $_.Name) -Force
  }

  $installedServer = Join-Path $llamaInstallDir 'llama-server.exe'
  if (-not (Test-Path -LiteralPath $installedServer -PathType Leaf)) {
    throw 'llama-server.exe installation failed.'
  }

  & (Join-Path $runtimeRoot 'install-runtime.ps1') `
    -ExtensionIds $ExtensionIds `
    -LlamaServerPath $installedServer `
    -ModelPath $installedModel

  if (-not $?) { throw 'Native runtime registration failed.' }

  Write-Host ''
  Write-Host 'AnanChrome is ready.' -ForegroundColor Green
  Write-Host 'Reload the extension once. Future launches will start the model automatically.'
}
finally {
  $resolvedTemp = [IO.Path]::GetFullPath($setupTemp)
  $expectedTempRoot = [IO.Path]::GetFullPath($env:TEMP)
  if ($resolvedTemp.StartsWith($expectedTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedTemp).StartsWith('AnanChromeSetup-', [StringComparison]::OrdinalIgnoreCase) -and
      (Test-Path -LiteralPath $resolvedTemp)) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
  }
}
