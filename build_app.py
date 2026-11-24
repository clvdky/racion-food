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
data["cafe"] = cfg.get("cafe_meal_price", 2500)
prices = ROOT / "docs/prices.json"
data["prices"] = load("docs/prices.json") if prices.exists() else {"stores": {}}
# правила сопоставления товаров для сервера цен (Cloudflare Worker читает docs/match.json)
import re
def js_re(r):  # \b в JS не работает с кириллицей — заменяем на явные границы слова
    r = re.sub(r"\\b(?=[а-яё])", "(?<![а-яё])", r)
    return re.sub(r"(?<=[а-яё])\\b", "(?![а-яё])", r)
match = [{"id": p["id"], "unit": p["unit"], "q": p["q"], "must": [js_re(m) for m in p["must"]], "excl": js_re(p.get("excl") or ""), "ref": data["fallback"].get(p["id"])} for p in data["products"]]
(ROOT / "docs/match.json").write_text(json.dumps(match, ensure_ascii=False, indent=0), encoding="utf-8")
data["pricesUrl"] = cfg.get("prices_url", "")
for p in data["products"]:  # регулярки парсера приложению не нужны
    for k in ("must", "excl", "q"):  # pack оставляем
        p.pop(k, None)

html = (ROOT / "app/template.html").read_text(encoding="utf-8")
html = html.replace("<title>Рацион на неделю</title>", "<title>" + data["appName"] + "</title>")
html = html.replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
(ROOT / "docs/index.html").write_text(html, encoding="utf-8")
print("docs/index.html собран")
