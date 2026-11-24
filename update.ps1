# Ежедневное обновление цен на Windows: парсинг -> сборка -> push на GitHub Pages.
# .\update.ps1            — всё
# .\update.ps1 -NoPush    — без отправки (для проверки)
param([switch]$NoPush)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:PYTHONIOENCODING = "utf-8"
New-Item -ItemType Directory -Force logs | Out-Null
$log = "logs\$(Get-Date -Format yyyy-MM-dd).log"
& {
  "=== $(Get-Date)"
  .\.venv\Scripts\python.exe scrapers\run_all.py
  .\.venv\Scripts\python.exe build_app.py
  if (-not $NoPush) {
    git add docs/prices.json docs/index.html
    git commit -m "Цены $(Get-Date -Format yyyy-MM-dd)"
    git push
  }
} *>&1 | Tee-Object -FilePath $log -Append
