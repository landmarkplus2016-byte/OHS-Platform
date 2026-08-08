Add-Type -AssemblyName System.Drawing

$root = "h:\My Drive\Claude Projects\Visual Studio\Safety Department\OHS Platform"
$src  = Join-Path $root "OHS icon.png"
$out  = Join-Path $root "icons"
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }

# --navy from tokens.css. The maskable/apple plates need an opaque colour and
# this is the one the shell already wears.
$navy = [System.Drawing.ColorTranslator]::FromHtml("#0f1942")

$source = [System.Drawing.Image]::FromFile($src)

function New-Icon {
    param(
        [int]$Size,
        [string]$Path,
        [double]$Inset = 1.0,          # fraction of canvas the artwork occupies
        [System.Drawing.Color]$Back = [System.Drawing.Color]::Transparent
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)

    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    if ($Back -ne [System.Drawing.Color]::Transparent) {
        $g.Clear($Back)
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
    }

    $art    = [int][Math]::Round($Size * $Inset)
    $offset = [int][Math]::Round(($Size - $art) / 2)
    $g.DrawImage($source, $offset, $offset, $art, $art)

    $g.Dispose()
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    "  {0,-28} {1}x{1}" -f (Split-Path $Path -Leaf), $Size
}

"Transparent 'any' icons:"
New-Icon -Size 192 -Path (Join-Path $out "icon-192.png")
New-Icon -Size 512 -Path (Join-Path $out "icon-512.png")

# Maskable: the spec guarantees only the centre 80%-diameter circle survives the
# platform's mask, so the artwork sits at 60% on an opaque plate.
"Maskable icons (navy plate, 60% artwork):"
New-Icon -Size 192 -Path (Join-Path $out "icon-maskable-192.png") -Inset 0.60 -Back $navy
New-Icon -Size 512 -Path (Join-Path $out "icon-maskable-512.png") -Inset 0.60 -Back $navy

# iOS composites its own rounded rect and does NOT honour alpha, so this one
# needs the plate too, but only light padding — iOS does not crop.
"Apple touch icon:"
New-Icon -Size 180 -Path (Join-Path $out "apple-touch-icon.png") -Inset 0.78 -Back $navy

"Favicon PNGs:"
New-Icon -Size 16 -Path (Join-Path $out "favicon-16.png")
New-Icon -Size 32 -Path (Join-Path $out "favicon-32.png")
New-Icon -Size 48 -Path (Join-Path $out "favicon-48.png")

$source.Dispose()

# ---- favicon.ico -----------------------------------------------------------
# ICO container with PNG payloads (supported since Vista). Header is 6 bytes,
# then one 16-byte directory entry per size, then the PNG bytes back to back.
$sizes = @(16, 32, 48)
$pngs  = @()
foreach ($s in $sizes) {
    $pngs += ,([System.IO.File]::ReadAllBytes((Join-Path $out "favicon-$s.png")))
}

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)

$bw.Write([UInt16]0)                 # reserved
$bw.Write([UInt16]1)                 # type: 1 = icon
$bw.Write([UInt16]$sizes.Count)      # image count

$offset = 6 + (16 * $sizes.Count)
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $bw.Write([Byte]$sizes[$i])      # width  (0 would mean 256)
    $bw.Write([Byte]$sizes[$i])      # height
    $bw.Write([Byte]0)               # palette colours (0 = truecolour)
    $bw.Write([Byte]0)               # reserved
    $bw.Write([UInt16]1)             # colour planes
    $bw.Write([UInt16]32)            # bits per pixel
    $bw.Write([UInt32]$pngs[$i].Length)
    $bw.Write([UInt32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }

$bw.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root "favicon.ico"), $ms.ToArray())
$bw.Dispose(); $ms.Dispose()

"favicon.ico written: {0} bytes ({1})" -f (Get-Item (Join-Path $root "favicon.ico")).Length, ($sizes -join ', ')
