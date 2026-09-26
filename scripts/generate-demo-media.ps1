# Genera las imágenes de relleno de la clínica demo (media/denvari/*.png).
# Uso (Windows, PowerShell 7+):  pwsh scripts/generate-demo-media.ps1
# Son ilustraciones propias de marca; ninguna es foto de pacientes reales.

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\media\denvari'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$brandDark = [System.Drawing.Color]::FromArgb(255, 14, 58, 74)
$brand = [System.Drawing.Color]::FromArgb(255, 20, 128, 140)
$accent = [System.Drawing.Color]::FromArgb(255, 94, 214, 196)
$white = [System.Drawing.Color]::White
$size = 800

function New-Canvas {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $brandDark, $brand, 45
  $g.FillRectangle($grad, $rect)
  return @{ Bitmap = $bmp; Graphics = $g }
}

function Draw-Centered($g, $text, $fontSize, $y, $color, $style = 'Regular') {
  $font = New-Object System.Drawing.Font 'Segoe UI', $fontSize, ([System.Drawing.FontStyle]::$style), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'
  $brush = New-Object System.Drawing.SolidBrush $color
  $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF 40, $y, ($size - 80), ($fontSize * 3)), $fmt)
}

function Draw-Tooth($g, $cx, $cy, $scale, $color) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $s = $scale
  $path.AddBezier(($cx - 60*$s), ($cy - 40*$s), ($cx - 70*$s), ($cy - 90*$s), ($cx - 15*$s), ($cy - 95*$s), $cx, ($cy - 70*$s))
  $path.AddBezier($cx, ($cy - 70*$s), ($cx + 15*$s), ($cy - 95*$s), ($cx + 70*$s), ($cy - 90*$s), ($cx + 60*$s), ($cy - 40*$s))
  $path.AddBezier(($cx + 60*$s), ($cy - 40*$s), ($cx + 50*$s), ($cy + 10*$s), ($cx + 45*$s), ($cy + 80*$s), ($cx + 25*$s), ($cy + 85*$s))
  $path.AddBezier(($cx + 25*$s), ($cy + 85*$s), ($cx + 5*$s), ($cy + 90*$s), ($cx + 5*$s), ($cy + 20*$s), $cx, ($cy + 20*$s))
  $path.AddBezier($cx, ($cy + 20*$s), ($cx - 5*$s), ($cy + 20*$s), ($cx - 5*$s), ($cy + 90*$s), ($cx - 25*$s), ($cy + 85*$s))
  $path.AddBezier(($cx - 25*$s), ($cy + 85*$s), ($cx - 45*$s), ($cy + 80*$s), ($cx - 50*$s), ($cy + 10*$s), ($cx - 60*$s), ($cy - 40*$s))
  $g.FillPath((New-Object System.Drawing.SolidBrush $color), $path)
}

function Draw-Footer($g) {
  Draw-Centered $g 'Clínica Dental Denvari' 34 690 $white 'Bold'
  Draw-Centered $g 'Imagen referencial · demostración' 22 735 $accent
}

function Save($canvas, $name) {
  $path = Join-Path $outDir $name
  $canvas.Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Graphics.Dispose(); $canvas.Bitmap.Dispose()
  Write-Output "ok $name"
}

# Logo
$c = New-Canvas
$c.Graphics.FillEllipse((New-Object System.Drawing.SolidBrush $white), 200, 120, 400, 400)
Draw-Tooth $c.Graphics 400 330 1.9 $brand
Draw-Centered $c.Graphics 'DENVARI' 96 540 $white 'Bold'
Draw-Centered $c.Graphics 'CLÍNICA DENTAL' 30 660 $accent 'Bold'
Save $c 'logo.png'

# Fachada
$c = New-Canvas; $g = $c.Graphics
$g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 236, 242, 244))), 130, 170, 540, 440)
$g.FillRectangle((New-Object System.Drawing.SolidBrush $brandDark), 130, 170, 540, 90)
Draw-Centered $g 'DENVARI · Clínica Dental' 40 195 $white 'Bold'
foreach ($x in 170, 330, 490) { $g.FillRectangle((New-Object System.Drawing.SolidBrush $accent), $x, 300, 140, 120) }
$g.FillRectangle((New-Object System.Drawing.SolidBrush $brand), 340, 460, 120, 150)
Draw-Footer $g
Save $c 'fachada.png'

# Ubicación
$c = New-Canvas; $g = $c.Graphics
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 255, 255, 255)), 18
foreach ($i in 0..4) { $g.DrawLine($pen, 0, (120 + $i*120), $size, (80 + $i*120)); $g.DrawLine($pen, (100 + $i*160), 0, (140 + $i*150), 640) }
$g.FillEllipse((New-Object System.Drawing.SolidBrush $white), 330, 220, 140, 140)
$g.FillPolygon((New-Object System.Drawing.SolidBrush $white), [System.Drawing.PointF[]]@((New-Object System.Drawing.PointF 345, 320), (New-Object System.Drawing.PointF 455, 320), (New-Object System.Drawing.PointF 400, 440)))
$g.FillEllipse((New-Object System.Drawing.SolidBrush $brand), 370, 260, 60, 60)
Draw-Centered $g 'Calle Las Orquídeas 450, San Isidro' 30 480 $white 'Bold'
Draw-Centered $g '(dirección de demostración)' 24 525 $accent
Draw-Footer $g
Save $c 'ubicacion.png'

# Una imagen por tratamiento
$treatments = [ordered]@{
  'ortodoncia' = @('Ortodoncia', 'Brackets metálicos y estéticos');
  'carillas' = @('Carillas', 'Diseño de sonrisa');
  'implantes' = @('Implantes', 'Recupera tu sonrisa completa');
  'blanqueamiento' = @('Blanqueamiento', 'Sonrisa más blanca en 1 sesión');
  'limpieza' = @('Limpieza dental', 'Profilaxis y prevención');
  'odontopediatria' = @('Odontopediatría', 'Atención para niños');
  'endodoncia' = @('Endodoncia', 'Tratamiento de conducto');
  'extraccion' = @('Extracción', 'Rápida y con anestesia local');
}
foreach ($key in $treatments.Keys) {
  $c = New-Canvas; $g = $c.Graphics
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 255, 255, 255))), 220, 80, 360, 360)
  Draw-Tooth $g 400 260 1.6 $white
  Draw-Centered $g $treatments[$key][0] 72 470 $white 'Bold'
  Draw-Centered $g $treatments[$key][1] 32 575 $accent
  Draw-Footer $g
  Save $c "$key.png"
}
