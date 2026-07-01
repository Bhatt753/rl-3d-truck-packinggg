# Quick train wrapper. Pass --quick for a 20k-step smoke run.

$ErrorActionPreference = "Stop"
. .\.venv\Scripts\Activate.ps1
python -m src.agent.train @args
