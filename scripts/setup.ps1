# One-shot bootstrap. Creates a venv, installs Python deps, and the renderer.

$ErrorActionPreference = "Stop"

Write-Host "==> Creating Python venv" -ForegroundColor Cyan
if (-not (Test-Path .venv)) { python -m venv .venv }
. .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e .

Write-Host "==> Installing renderer deps" -ForegroundColor Cyan
Push-Location renderer
npm install
Pop-Location

Write-Host "==> Done. Try:" -ForegroundColor Green
Write-Host "    python -m src.env.truck_packing_env    # sanity check"
Write-Host "    cd renderer; npm run dev               # view the sample trace"
