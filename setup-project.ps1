param(
  [string[]]$ExtensionIds = @('padicgoaheglbafnjjbjaooakfdcjfmi'),
  [string]$LlamaServerPath = '',
  [string]$ModelPath = ''
)

$ErrorActionPreference = 'Stop'
$installArgs = @{ ExtensionIds = $ExtensionIds }
if ($LlamaServerPath) { $installArgs.LlamaServerPath = $LlamaServerPath }
if ($ModelPath) {
  $installArgs.ModelPath = $ModelPath
} else {
  $installArgs.ModelDirectory = Join-Path $PSScriptRoot 'models'
}
& (Join-Path $PSScriptRoot 'runtime\install-runtime.ps1') @installArgs
Write-Host 'Project setup complete. Put one GGUF model in models, then open the extension.' -ForegroundColor Green
Write-Host 'Run this setup again only if you move the project or change the extension ID.'
