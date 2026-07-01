# Capture cinematic frames at specified timestamps via headless Edge.
# Requires the Vite dev server to be running at localhost:5173.

param(
  [string]$Url = "http://localhost:5173",
  [string]$OutDir = "D:\HYPERTANGENT\Truck simualtor\renderer\screenshots",
  [double[]]$Times = @(2, 6.5, 12, 16, 30, 80, 150, 215)
)

$msedge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $msedge)) {
  $msedge = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe"
}
if (-not (Test-Path $msedge)) { Write-Error "Edge not found"; exit 1 }

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

foreach ($t in $Times) {
  $tStr = "{0:00.0}" -f $t
  $shot = Join-Path $OutDir "t_$tStr.png"
  if (Test-Path $shot) { Remove-Item $shot -Force }
  $tmpProfile = "$env:TEMP\edge-headless-$([Guid]::NewGuid())"
  # Use paused=1 so the clock doesn't tick during render; t=$t sets the start.
  $u = "$Url/?t=$t&speed=0&paused=1"
  # We give ~3 seconds of virtual time for the first frame to settle.
  & $msedge --headless=new --disable-gpu --hide-scrollbars --no-sandbox `
    --user-data-dir="$tmpProfile" `
    --window-size=1280,720 `
    --virtual-time-budget=3500 `
    --screenshot="$shot" `
    $u 2>&1 | Out-Null
  if (Test-Path $shot) {
    $size = [math]::Round((Get-Item $shot).Length / 1KB, 1)
    Write-Host "t=$tStr -> $shot ($size KB)"
  } else {
    Write-Host "t=$tStr -> FAILED"
  }
  Remove-Item $tmpProfile -Recurse -Force -ErrorAction SilentlyContinue
}
