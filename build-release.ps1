param([string]$LlamaDirectory = (Join-Path $PSScriptRoot 'llama.cpp'))
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$packageDir = Join-Path $distRoot 'windows-bundle'
$packageZip = Join-Path $distRoot 'AnanChrome-Windows.zip'
$server = Join-Path $LlamaDirectory 'llama-server.exe'
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) {
  throw 'Pass -LlamaDirectory with the complete llama.cpp b10630 Windows x64 directory (including DLLs).'
}
$probeInfo = New-Object Diagnostics.ProcessStartInfo
$probeInfo.FileName = $server
$probeInfo.Arguments = '--version'
$probeInfo.UseShellExecute = $false
$probeInfo.CreateNoWindow = $true
$probeInfo.RedirectStandardOutput = $true
$probeInfo.RedirectStandardError = $true
$probe = [Diagnostics.Process]::Start($probeInfo)
$version = $probe.StandardOutput.ReadToEnd() + $probe.StandardError.ReadToEnd()
$probe.WaitForExit()
if ($probe.ExitCode -ne 0 -or $version -notmatch 'build 10630') { throw 'This release is tested against llama.cpp build 10630 only.' }
$probe.Dispose()
foreach ($required in @('llama.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-cpu-x64.dll', 'llama-server-impl.dll', 'llama-common.dll', 'libomp.dll', 'LICENSE-LLVM-OpenMP')) {
  if (-not (Test-Path -LiteralPath (Join-Path $LlamaDirectory $required))) { throw "Missing runtime dependency: $required" }
}
if (Test-Path -LiteralPath (Join-Path $LlamaDirectory 'ggml-cuda.dll')) {
  foreach ($required in @('cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll')) {
    if (-not (Test-Path -LiteralPath (Join-Path $LlamaDirectory $required))) { throw "Missing CUDA dependency: $required" }
  }
}
& (Join-Path $projectRoot 'runtime/build.ps1')
& (Join-Path $projectRoot 'build-extension.ps1')

# Only replace this exact generated directory, never the project or its models.
$expectedPackage = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist\windows-bundle'))
if ([IO.Path]::GetFullPath($packageDir) -ne $expectedPackage) { throw 'Unexpected staging path.' }
if (Test-Path -LiteralPath $packageDir) { Remove-Item -LiteralPath $packageDir -Recurse -Force }
New-Item -ItemType Directory -Path $packageDir,(Join-Path $packageDir 'runtime\dist\win-x64'),(Join-Path $packageDir 'llama.cpp'),(Join-Path $packageDir 'licenses') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $distRoot 'extension') -Destination $packageDir -Recurse
foreach ($file in @('setup-bundled.ps1', 'install-runtime.ps1', 'uninstall-runtime.ps1')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "runtime\$file") -Destination (Join-Path $packageDir 'runtime')
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'runtime\dist\win-x64\AnanChromeRuntime.exe') -Destination (Join-Path $packageDir 'runtime\dist\win-x64')
Copy-Item -LiteralPath (Join-Path $projectRoot 'release\Install-AnanChrome.cmd') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'release\README.zh-CN.md') -Destination $packageDir
Copy-Item -LiteralPath (Join-Path $projectRoot 'release\THIRD-PARTY-NOTICES.md') -Destination (Join-Path $packageDir 'licenses')
Get-ChildItem -LiteralPath $LlamaDirectory -File | Where-Object {
  $_.Extension -eq '.dll' -or $_.Name -eq 'llama-server.exe' -or $_.Name -match '^(LICENSE|NOTICE|COPYING)'
} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $packageDir 'llama.cpp') }

$licenseSources = @{
  'llama.cpp-LICENSE.txt' = 'https://raw.githubusercontent.com/ggml-org/llama.cpp/b10630/LICENSE'
  'CUDA-EULA.html' = 'https://docs.nvidia.com/cuda/archive/12.4.1/eula/index.html'
  'dotnet-LICENSE.txt' = 'https://raw.githubusercontent.com/dotnet/runtime/v9.0.0/LICENSE.TXT'
  'dotnet-THIRD-PARTY-NOTICES.txt' = 'https://raw.githubusercontent.com/dotnet/runtime/v9.0.0/THIRD-PARTY-NOTICES.TXT'
}
foreach ($name in $licenseSources.Keys) {
  Invoke-WebRequest -UseBasicParsing -Uri $licenseSources[$name] -OutFile (Join-Path $packageDir "licenses\$name")
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceZip = Join-Path $distRoot 'llama.cpp-b10630-source.zip'
if (-not (Test-Path -LiteralPath $sourceZip)) {
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  & $curl --fail --location --retry 2 --connect-timeout 15 --max-time 180 --output "$sourceZip.part" 'https://codeload.github.com/ggml-org/llama.cpp/zip/refs/tags/b10630'
  if ($LASTEXITCODE -ne 0) { throw 'Could not download upstream source license archive.' }
  Move-Item -LiteralPath "$sourceZip.part" -Destination $sourceZip
}
$sources = [IO.Compression.ZipFile]::OpenRead($sourceZip)
try {
  foreach ($entry in $sources.Entries) {
    if ($entry.Name -notmatch '(?i)(license|copying|notice)') { continue }
    $targetRoot = [IO.Path]::GetFullPath((Join-Path $packageDir 'licenses\upstream')) + [IO.Path]::DirectorySeparatorChar
    $target = [IO.Path]::GetFullPath((Join-Path $targetRoot $entry.FullName))
    if (-not $target.StartsWith($targetRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive path.' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
  }
} finally { $sources.Dispose() }
if (Test-Path -LiteralPath $packageZip) {
  $backup = Join-Path $distRoot ('AnanChrome-Windows-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-backup.zip')
  Move-Item -LiteralPath $packageZip -Destination $backup
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($packageDir, $packageZip, [IO.Compression.CompressionLevel]::Optimal, $false)
Write-Host "Windows all-in-one ZIP created: $packageZip" -ForegroundColor Green
