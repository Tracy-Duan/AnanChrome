$ErrorActionPreference = 'Stop'
$nativeHostName = 'com.anan.chrome.runtime'
$installDir = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AnanChrome\Runtime'))
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'AnanChrome'))

$registryKeys = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$nativeHostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$nativeHostName"
)
foreach ($registryKey in $registryKeys) {
  if (Test-Path -LiteralPath $registryKey) {
    Remove-Item -LiteralPath $registryKey -Recurse -Force
  }
}

if (-not $installDir.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase) -or
    (Split-Path -Leaf $installDir) -ne 'Runtime') {
  throw "Refusing to remove unexpected directory: $installDir"
}
if (Test-Path -LiteralPath $installDir) {
  Remove-Item -LiteralPath $installDir -Recurse -Force
}

Write-Host 'AnanChrome Runtime uninstalled successfully.' -ForegroundColor Green
