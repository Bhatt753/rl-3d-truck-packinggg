# End-to-end demo: train (short), record trace, then start renderer.

$ErrorActionPreference = "Stop"
. .\.venv\Scripts\Activate.ps1

if (-not (Test-Path checkpoints\best_model.zip)) {
    Write-Host "==> No trained checkpoint. Running a quick 20k-step train." -ForegroundColor Yellow
    python -m src.agent.train --quick
}

$ckpt = "checkpoints\best_model.zip"
if (-not (Test-Path $ckpt)) { $ckpt = "checkpoints\final.zip" }
if (-not (Test-Path $ckpt)) { Write-Host "No checkpoint found." -ForegroundColor Red; exit 1 }

Write-Host "==> Recording trace from $ckpt" -ForegroundColor Cyan
python -m src.trace.recorder --checkpoint $ckpt --out renderer\public\traces\latest.json

Write-Host "==> Starting renderer" -ForegroundColor Cyan
Push-Location renderer
npm run dev
Pop-Location
