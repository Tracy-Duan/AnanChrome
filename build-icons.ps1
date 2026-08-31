param(
  [string]$SourcePath = (Join-Path $PSScriptRoot 'assets\anan-chrome-icon.png')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$source = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePath).Path)
try {
  if ($source.Width -ne $source.Height) {
    throw 'The icon source must be square; refusing to stretch the artwork.'
  }
  $iconDir = Join-Path $PSScriptRoot 'icons'
  New-Item -ItemType Directory -Path $iconDir -Force | Out-Null
  foreach ($size in @(16, 32, 48, 128)) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $attributes = New-Object System.Drawing.Imaging.ImageAttributes
    try {
      $graphics.Clear([System.Drawing.Color]::Transparent)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
      $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
      $graphics.DrawImage($source, $rect, 0, 0, $source.Width, $source.Height,
        [System.Drawing.GraphicsUnit]::Pixel, $attributes)
      $destination = Join-Path $iconDir "icon$size.png"
      $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output "Created icon$size.png ($size x $size)"
    }
    finally {
      $attributes.Dispose()
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  }
}
finally {
  $source.Dispose()
}
