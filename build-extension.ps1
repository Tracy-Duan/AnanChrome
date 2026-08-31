$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$distRoot = Join-Path $projectRoot 'dist'
$stageDir = Join-Path $distRoot 'extension'
$zipPath = Join-Path $distRoot 'AnanChrome-extension.zip'

$resolvedProject = [IO.Path]::GetFullPath($projectRoot)
$resolvedStage = [IO.Path]::GetFullPath($stageDir)
if (-not $resolvedStage.StartsWith($resolvedProject, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $resolvedStage) -ne 'extension') {
  throw "Refusing to replace unexpected staging directory: $resolvedStage"
}

if (Test-Path -LiteralPath $stageDir) {
  Remove-Item -LiteralPath $stageDir -Recurse -Force
}
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

$files = @(
  'manifest.json',
  'service-worker.js',
  'chat-policy.js',
  'chat-stream.js',
  'conversation.js',
  'chat-library.js',
  'page-access.js',
  'sidepanel.html',
  'sidepanel.js',
  'options.html',
  'options.js'
)
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $stageDir
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'icons') -Destination $stageDir -Recurse
Copy-Item -LiteralPath (Join-Path $projectRoot 'styles') -Destination $stageDir -Recurse

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host "Extension package created: $zipPath" -ForegroundColor Green
