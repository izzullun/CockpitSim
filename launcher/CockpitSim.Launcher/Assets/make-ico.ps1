# Builds app.ico (multi-size) from the repo favicon. Re-run if the logo changes.
# Source: backend/CockpitSim/wwwroot/favicon.png (native 32x32). We embed the
# native 32 plus scaled 16/48/256 so Windows picks the best size per context;
# the native 32 keeps small sizes crisp, 256 is upscaled (acceptable for the
# desktop icon — the source logo is 32px, so large sizes are inherently soft).
Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot "..\..\..\backend\CockpitSim\wwwroot\favicon.png"
$dest = Join-Path $PSScriptRoot "app.ico"
$source = [System.Drawing.Image]::FromFile((Resolve-Path $src))

function Resize-Png([System.Drawing.Image]$img, [int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($img, 0, 0, $size, $size)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return ,$ms.ToArray()
}

# ICO supports PNG-compressed entries (Vista+) for >=256; use PNG for all sizes.
$sizes = @(16, 32, 48, 256)
$images = @{}
foreach ($s in $sizes) { $images[$s] = Resize-Png $source $s }

$fs = [System.IO.File]::Create($dest)
$bw = New-Object System.IO.BinaryWriter $fs

# ICONDIR header
$bw.Write([uint16]0)              # reserved
$bw.Write([uint16]1)              # type = icon
$bw.Write([uint16]$sizes.Count)   # image count

$offset = 6 + (16 * $sizes.Count) # header + directory entries
foreach ($s in $sizes) {
    $data = $images[$s]
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))) # width  (0 = 256)
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))) # height (0 = 256)
    $bw.Write([byte]0)              # color palette
    $bw.Write([byte]0)              # reserved
    $bw.Write([uint16]1)            # color planes
    $bw.Write([uint16]32)           # bits per pixel
    $bw.Write([uint32]$data.Length) # data size
    $bw.Write([uint32]$offset)      # data offset
    $offset += $data.Length
}
foreach ($s in $sizes) { $bw.Write($images[$s]) }

$bw.Flush(); $bw.Dispose(); $fs.Dispose(); $source.Dispose()
Write-Output "Wrote $dest ($((Get-Item $dest).Length) bytes, sizes: $($sizes -join ', '))"
