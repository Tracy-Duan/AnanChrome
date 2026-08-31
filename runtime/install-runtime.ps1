param(
  [string[]]$ExtensionIds = @('padicgoaheglbafnjjbjaooakfdcjfmi'),
  [string]$LlamaServerPath = '',
  [string]$ModelPath = '',
  [string]$ModelDirectory = '',
  [int]$ContextSize = 8192,
  [int]$GpuLayers = -1
)

$ErrorActionPreference = 'Stop'
$nativeHostName = 'com.anan.chrome.runtime'
$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$publishedExe = Join-Path $runtimeRoot 'dist\win-x64\AnanChromeRuntime.exe'
$installDir = Join-Path $env:LOCALAPPDATA 'AnanChrome\Runtime'
$installedExe = Join-Path $installDir 'AnanChromeRuntime.exe'
$configPath = Join-Path $installDir 'config.json'
$hostManifestPath = Join-Path $installDir 'com.anan.chrome.runtime.json'

$previous = $null
if (Test-Path -LiteralPath $configPath -PathType Leaf) {
  $previous = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (-not $LlamaServerPath) {
  $serverCandidates = @(
    (Join-Path (Split-Path -Parent $runtimeRoot) 'llama.cpp\llama-server.exe'),
    (Join-Path $runtimeRoot 'llama.cpp\llama-server.exe'),
    $previous.llamaServerPath,
    (Join-Path $env:LOCALAPPDATA 'AnanChrome\LlamaCpp\llama-server.exe')
  )
  $LlamaServerPath = $serverCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
}
if (-not $LlamaServerPath) {
  throw 'llama-server.exe was not found. Install the Windows runtime once, or pass -LlamaServerPath with the existing llama-server.exe path.'
}
# An explicit model path selects that file only. Otherwise prefer the project
# directory and retain a working older path as a migration fallback.
if (-not $ModelPath) {
  if (-not $ModelDirectory) {
    $ModelDirectory = Join-Path (Split-Path -Parent $runtimeRoot) 'models'
  }
  if ($previous.modelPath -and (Test-Path -LiteralPath $previous.modelPath -PathType Leaf)) {
    $ModelPath = $previous.modelPath
  }
}
if ($ModelDirectory) {
  $ModelDirectory = [IO.Path]::GetFullPath($ModelDirectory)
  New-Item -ItemType Directory -Path $ModelDirectory -Force | Out-Null
}
if (-not $PSBoundParameters.ContainsKey('ContextSize') -and $previous.contextSize) {
  $ContextSize = $previous.contextSize
}
if (-not $PSBoundParameters.ContainsKey('GpuLayers') -and $null -ne $previous.gpuLayers) {
  $GpuLayers = $previous.gpuLayers
}

foreach ($extensionId in $ExtensionIds) {
  if ($extensionId -notmatch '^[a-p]{32}$') {
    throw "Invalid Chrome/Edge extension ID: $extensionId"
  }
}
if (-not (Test-Path -LiteralPath $LlamaServerPath -PathType Leaf)) {
  throw "llama-server.exe was not found: $LlamaServerPath"
}
if ($ModelPath -and -not (Test-Path -LiteralPath $ModelPath -PathType Leaf)) {
  throw "Model file was not found: $ModelPath"
}

if (-not (Test-Path -LiteralPath $publishedExe -PathType Leaf)) {
  & (Join-Path $runtimeRoot 'build.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed.' }
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -LiteralPath $publishedExe -Destination $installedExe -Force

$config = [ordered]@{
  serverUrl = 'http://127.0.0.1:8080'
  llamaServerPath = [IO.Path]::GetFullPath($LlamaServerPath)
  modelDirectory = $ModelDirectory
  modelPath = $(if ($ModelPath) { [IO.Path]::GetFullPath($ModelPath) } else { '' })
  port = 8080
  contextSize = $ContextSize
  gpuLayers = $GpuLayers
  startupTimeoutSeconds = 120
}
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8NoBom)

$allowedOrigins = @($ExtensionIds | ForEach-Object { "chrome-extension://$_/" })
if (Test-Path -LiteralPath $hostManifestPath -PathType Leaf) {
  $oldHost = Get-Content -LiteralPath $hostManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $allowedOrigins = @($allowedOrigins + @($oldHost.allowed_origins | Where-Object {
    $_ -match '^chrome-extension://[a-p]{32}/$'
  }) | Select-Object -Unique)
}
$hostManifest = [ordered]@{
  name = $nativeHostName
  description = 'AnanChrome Windows local model runtime'
  path = $installedExe
  type = 'stdio'
  allowed_origins = $allowedOrigins
}
[IO.File]::WriteAllText($hostManifestPath, ($hostManifest | ConvertTo-Json -Depth 4), $utf8NoBom)

$registryKeys = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$nativeHostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$nativeHostName"
)
foreach ($registryKey in $registryKeys) {
  New-Item -Path $registryKey -Force | Out-Null
  Set-Item -Path $registryKey -Value $hostManifestPath
}

Write-Host 'AnanChrome Runtime installed successfully.' -ForegroundColor Green
Write-Host "Install directory: $installDir"
Write-Host "Extension IDs: $($ExtensionIds -join ', ')"
if ($ModelDirectory) { Write-Host "Automatic model directory: $ModelDirectory" }
if ($ModelPath) { Write-Host "Configured model / migration fallback: $ModelPath" }
Write-Host 'Reload the extension from chrome://extensions or edge://extensions.'
