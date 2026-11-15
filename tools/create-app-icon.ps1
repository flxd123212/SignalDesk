$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot '..\desktop\assets'
[IO.Directory]::CreateDirectory($iconDirectory) | Out-Null
$frames = @()
foreach ($size in @(16, 32, 48, 64, 128, 256, 1024)) {
    $bitmap = New-Object Drawing.Bitmap($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::FromArgb(32, 37, 43))
    $graphics.ScaleTransform($size / 256.0, $size / 256.0)
    $pen = New-Object Drawing.Pen([Drawing.Color]::FromArgb(115, 216, 187), 12)
    $pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawRectangle($pen, 45, 45, 166, 166)
    $graphics.DrawEllipse($pen, 75, 75, 26, 26)
    $graphics.DrawEllipse($pen, 155, 155, 26, 26)
    $graphics.DrawLine($pen, 88, 101, 88, 168)
    $graphics.DrawLine($pen, 88, 168, 127, 168)
    $graphics.DrawLine($pen, 168, 155, 168, 88)
    $graphics.DrawLine($pen, 168, 88, 129, 88)
    $stream = New-Object IO.MemoryStream
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    if ($size -le 256) { $frames += ,$stream.ToArray() }
    if ($size -eq 1024) { $bitmap.Save((Join-Path $iconDirectory 'icon.png'), [Drawing.Imaging.ImageFormat]::Png) }
    $stream.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$output = [IO.File]::Create((Join-Path $iconDirectory 'icon.ico'))
$writer = New-Object IO.BinaryWriter($output)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
    $offset = 6 + 16 * $frames.Count
    $sizes = @(16, 32, 48, 64, 128, 0)
    for ($index = 0; $index -lt $frames.Count; $index++) {
        $writer.Write([byte]$sizes[$index]); $writer.Write([byte]$sizes[$index]); $writer.Write([uint16]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$frames[$index].Length); $writer.Write([uint32]$offset)
        $offset += $frames[$index].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
} finally { $writer.Dispose(); $output.Dispose() }
