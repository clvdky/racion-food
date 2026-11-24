"""Собирает docs/index.html из app/template.html и data/*.json."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
load = lambda p: json.loads((ROOT / p).read_text(encoding="utf-8"))

data = {
    "products": load("data/products.json"),
    "recipes": load("data/recipes.json"),
    "fallback": {k: v for k, v in load("data/fallback_prices.json").items() if not k.startswith("_")},
}
steps = load("data/steps.json")
for r in data["recipes"]:
    r["steps"] = steps.get(r["id"], [])
cfg = load("config.json")
data["botLink"] = cfg.get("bot_link", "")
data["appName"] = cfg.get("app_name", "Еда на неделю")
prices = ROOT / "docs/prices.json"
data["prices"] = load("docs/prices.json") if prices.exists() else {"stores": {}}
for p in data["products"]:  # регулярки парсера приложению не нужны
    for k in ("must", "excl", "q"):
        p.pop(k, None)

html = (ROOT / "app/template.html").read_text(encoding="utf-8")
html = html.replace("<title>Рацион на неделю</title>", "<title>" + data["appName"] + "</title>")
html = html.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
(ROOT / "docs/index.html").write_text(html, encoding="utf-8")
print("docs/index.html собран")
