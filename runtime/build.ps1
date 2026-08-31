$ErrorActionPreference = 'Stop'

$runtimeRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectFile = Join-Path $runtimeRoot 'AnanChrome.Runtime.csproj'
$outputDir = Join-Path $runtimeRoot 'dist\win-x64'

dotnet publish $projectFile `
  --configuration Release `
  --runtime win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  --output $outputDir

if ($LASTEXITCODE -ne 0) {
  throw "AnanChrome Runtime build failed with exit code $LASTEXITCODE"
}

Write-Host "Build completed: $outputDir" -ForegroundColor Green
