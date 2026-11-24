"""Запуск всех парсеров -> docs/prices.json.

Если магазин или товар не спарсился, остаётся последняя известная цена (с её датой).
Использование:  python scrapers/run_all.py [arbuz magnum small]
"""
import json
import sys
from datetime import date

from common import ROOT, config, load_json, pick_best

STORES = {
    "magnum": ("Magnum (Kaspi)", "kaspi_magnum"),
    "small": ("Small (Wolt)", "wolt_small"),
    "arbuz": ("Arbuz.kz", "arbuz"),
}


def main():
    only = set(sys.argv[1:]) or set(STORES)
    cfg = config()
    products = load_json("products.json")
    fallback = load_json("fallback_prices.json")
    out_path = ROOT / "docs" / "prices.json"
    prev = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {"stores": {}}
    today = date.today().isoformat()
    result = {"updated": today, "stores": prev.get("stores", {})}

    for key, (title, module) in STORES.items():
        if key not in only:
            continue
        print(f"== {title}")
        store_prev = result["stores"].get(key, {}).get("items", {})
        try:
            mod = __import__(module)
            raw = mod.scrape(products, cfg)
        except Exception as e:  # noqa: BLE001
            print(f"  ОШИБКА: {e} — оставляю прошлые цены")
            continue
        items, found = dict(store_prev), 0
        for p in products:
            best = pick_best(p, raw.get(p["id"], []), fallback)
            if best:
                best["d"] = today
                items[p["id"]] = best
                found += 1
                print(f"  ✓ {p['name']:<28} {best['p']:>7} ₸/{p['unit']}  ← {best['t'][:60]}")
            else:
                print(f"  · {p['name']:<28} не найдено" + (" (оставлена прошлая цена)" if p["id"] in store_prev else ""))
        result["stores"][key] = {"name": title, "updated": today if found else
                                 result["stores"].get(key, {}).get("updated"), "items": items}
        print(f"  Итого: {found}/{len(products)}")

    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Сохранено: {out_path}")


if __name__ == "__main__":
    main()
