$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$testRoot = Join-Path $env:TEMP ('AnanChromeBundleTest-' + [Guid]::NewGuid().ToString('N'))
Microsoft.PowerShell.Management\New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
$previousAppData = $env:LOCALAPPDATA
$global:AnanTestRegistrations = @{}

# Exercise real filesystem installation, but intercept registry writes. Never
# alter Chrome/Edge's real registration while testing the release installer.
function New-Item {
  param([string[]]$Path, [string]$ItemType, [switch]$Force)
  if ($Path[0].StartsWith('HKCU:')) { return }
  Microsoft.PowerShell.Management\New-Item @PSBoundParameters
}
function Set-Item {
  param([string]$Path, [object]$Value)
  if (-not $Path.StartsWith('HKCU:\Software\')) { throw 'Unexpected registry target' }
  $global:AnanTestRegistrations[$Path] = $Value
}
try {
  $env:LOCALAPPDATA = $testRoot
  & (Join-Path $projectRoot 'dist\windows-bundle\runtime\setup-bundled.ps1')
  $config = Get-Content -LiteralPath (Join-Path $testRoot 'AnanChrome\Runtime\config.json') -Raw | ConvertFrom-Json
  if (-not $config.llamaServerPath.StartsWith($testRoot)) { throw 'Leaked developer engine path' }
  if ($config.modelPath) { throw 'Clean install should not select an external model' }
  if (-not $config.modelDirectory.StartsWith($testRoot)) { throw 'Leaked developer model path' }
  if (-not (Test-Path -LiteralPath $config.llamaServerPath)) { throw 'Engine missing after installation' }
  if ($global:AnanTestRegistrations.Count -ne 2) { throw 'Both Chrome and Edge registrations required' }
  $manifest = Get-Content -LiteralPath (Join-Path $testRoot 'AnanChrome\Runtime\com.anan.chrome.runtime.json') -Raw | ConvertFrom-Json
  if ($manifest.allowed_origins[0] -ne 'chrome-extension://padicgoaheglbafnjjbjaooakfdcjfmi/') { throw 'Extension ID changed' }
  if (-not (Test-Path -LiteralPath $manifest.path)) { throw 'Native host missing' }
  Write-Host 'PASS: clean bundle install, portable paths, stable ID, two registry registrations (mocked).'
} finally {
  $env:LOCALAPPDATA = $previousAppData
  $resolved = [IO.Path]::GetFullPath($testRoot)
  $allowed = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
  if ($resolved.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolved).StartsWith('AnanChromeBundleTest-')) {
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
