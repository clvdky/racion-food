#!/bin/bash
# Ежедневное обновление цен: парсинг -> сборка -> push на GitHub Pages.
# ./update.sh            — всё
# ./update.sh --no-push  — без отправки на GitHub (для проверки)
set -e
cd "$(dirname "$0")"
LOG="logs/$(date +%F).log"; mkdir -p logs
{
  echo "=== $(date)"
  .venv/bin/python scrapers/run_all.py
  .venv/bin/python build_app.py
  if [ "$1" != "--no-push" ]; then
    git add docs/prices.json docs/index.html
    git commit -m "Цены $(date +%F)" || echo "Нет изменений"
    git push
  fi
} 2>&1 | tee -a "$LOG"
