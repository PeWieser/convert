# Runs per-user, never modifies PATH, never bundles FFmpeg into the app.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$destination = Join-Path $env:LOCALAPPDATA 'Wandler\ffmpeg'
$manifest = Get-Content (Join-Path $PSScriptRoot 'ffmpeg-manifest.json') -Raw | ConvertFrom-Json

function Test-Tools([string]$ffmpeg) {
  if (-not $ffmpeg) { return $false }
  try {
    if ($ffmpeg -eq 'ffmpeg') { $ffprobe = 'ffprobe' }
    else { $ffprobe = Join-Path (Split-Path $ffmpeg) 'ffprobe.exe' }
    & $ffmpeg -version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    & $ffprobe -version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    $encoders = (& $ffmpeg -hide_banner -encoders 2>$null) -join "`n"
    return ($LASTEXITCODE -eq 0 -and $encoders -match '\blibx264\b' -and $encoders -match '\baac\b')
  } catch { return $false }
}

$candidates = @(
  $env:FFMPEG_PATH,
  'ffmpeg',
  (Join-Path $destination 'bin\ffmpeg.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'),
  (Join-Path $env:USERPROFILE 'scoop\shims\ffmpeg.exe'),
  'C:\ProgramData\chocolatey\bin\ffmpeg.exe',
  'C:\ffmpeg\bin\ffmpeg.exe'
)
foreach ($candidate in $candidates) {
  if (Test-Tools $candidate) { Write-Output "FFmpeg vorhanden: $candidate"; exit 0 }
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$temp = Join-Path ([IO.Path]::GetTempPath()) ('wandler-ffmpeg-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
$staging = $null
try {
  Write-Output 'FFmpeg fehlt. Geprueften GPL-Build herunterladen ...'
  $zip = Join-Path $temp 'ffmpeg.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $manifest.url -OutFile $zip -TimeoutSec 300
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $manifest.sha256) { throw 'SHA-256 stimmt nicht. Der Download wird nicht ausgefuehrt.' }
  $unpack = Join-Path $temp 'unpacked'
  Expand-Archive -LiteralPath $zip -DestinationPath $unpack
  $binary = Get-ChildItem $unpack -Filter ffmpeg.exe -Recurse | Select-Object -First 1
  if (-not $binary -or -not (Test-Tools $binary.FullName)) { throw 'Der Download enthaelt keinen vollstaendigen FFmpeg-Build.' }
  $root = Split-Path (Split-Path $binary.FullName)
  $parent = Split-Path $destination
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $staging = Join-Path $parent ('ffmpeg-' + [guid]::NewGuid())
  # Keep licenses and documentation, not only the two executables.
  Copy-Item -LiteralPath $root -Destination $staging -Recurse
  Copy-Item (Join-Path $PSScriptRoot 'ffmpeg-manifest.json') (Join-Path $staging 'wandler-build.json')
  $backup = $destination + '.previous'
  if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
  if (Test-Path $destination) { Move-Item $destination $backup }
  try { Move-Item $staging $destination }
  catch {
    if (Test-Path $backup) { Move-Item $backup $destination }
    throw
  }
  if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
  Write-Output 'FFmpeg eingerichtet.'
} catch {
  Write-Error $_
  exit 1
} finally {
  if ($staging -and (Test-Path $staging)) { Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue }
  Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
}
