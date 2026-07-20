param(
  [string]$Version = '0.1.0-beta.1',
  [string]$SourceVersion = '0.4.7-beta.1',
  [string]$OutputRoot = (Join-Path $PSScriptRoot '..\packaging\dist')
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$packageName = "motk-shoot-local-$Version-win-x64"
$package = Join-Path $OutputRoot $packageName
$internal = Join-Path $package '_internal'
$app = Join-Path $internal 'app'
$zip = Join-Path $OutputRoot "$packageName.zip"

if (Test-Path -LiteralPath $package) { Remove-Item -LiteralPath $package -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
New-Item -ItemType Directory -Path $app -Force | Out-Null

foreach ($file in @('index.html', 'monitor.html', 'manifest.json', 'LICENSE')) {
  Copy-Item -LiteralPath (Join-Path $repo $file) -Destination $app
}
foreach ($folder in @('css', 'js')) {
  Copy-Item -LiteralPath (Join-Path $repo $folder) -Destination $app -Recurse
}

$cscCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'Windows C# compiler was not found.' }

$iconPath = Join-Path $internal 'motk-shoot-local.ico'
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 64, 64
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(25, 29, 36))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 95, 69)), 8
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 95, 69))
$graphics.DrawEllipse($pen, 10, 10, 44, 44)
$graphics.FillEllipse($brush, 25, 25, 14, 14)
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create($iconPath)
$icon.Save($stream)
$stream.Close()
$icon.Dispose()
$brush.Dispose()
$pen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

$exe = Join-Path $package 'MOTK Shoot Local.exe'
& $csc /nologo /target:winexe /optimize+ /reference:System.dll /reference:System.Windows.Forms.dll /win32icon:$iconPath /out:$exe (Join-Path $PSScriptRoot 'launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }

Set-Content -LiteralPath (Join-Path $internal 'VERSION.txt') -Encoding UTF8 -Value @(
  "MOTK Shoot Local $Version",
  "MOTK Shoot source $SourceVersion",
  'Focused local edition of MOTK Shoot',
  'Capture, timeline editing, playback, audio/X-Sheet, local mirror and export.'
)
Set-Content -LiteralPath (Join-Path $internal 'README.txt') -Encoding UTF8 -Value @(
  'Double-click MOTK Shoot Local.exe.',
  'Keep the _internal folder next to the application.',
  'Captured frames are stored in local recovery storage. Choose Files > Local capture folder for an explicit disk mirror.',
  'Camera SDK control remains available when MOTK Companion is installed and paired.'
)

& $exe --self-test
if ($LASTEXITCODE -ne 0) { throw 'Packaged application self-test failed.' }

$textFiles = Get-ChildItem -LiteralPath $package -Recurse -File | Where-Object { $_.Extension -match '^\.(html|css|js|json|txt)$' }
foreach ($file in $textFiles) {
  $text = Get-Content -LiteralPath $file.FullName -Raw
  if ($text -match 'C:\\Users\\' -or $text -match 'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY' -or $text -match 'AIza[0-9A-Za-z_-]{20,}') {
    throw "Private or machine-specific text detected in $($file.FullName)"
  }
}

Compress-Archive -Path (Join-Path $package '*') -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
Write-Host "Package: $zip"
Write-Host "SHA256: $hash"
