"""Magnum через Магазин на Kaspi.kz (внутренний JSON-API веб-версии).

Фильтр по Magnum задаётся в config.json -> kaspi_filter. Как его найти — см. README.
"""
from urllib.parse import quote

from common import dump_debug, norm, parse_price, polite_sleep, session

URL = "https://kaspi.kz/yml/product-view/pl/results"


def extract(data):
    items = []
    rows = data.get("data") if isinstance(data, dict) else None
    if rows is None and isinstance(data, dict):
        rows = data.get("products") or data.get("items") or []
    for row in rows or []:
        title = row.get("title") or row.get("name") or ""
        price = None
        for key in ("unitSalePrice", "unitPrice", "price", "priceFormatted"):
            if row.get(key):
                price = parse_price(row[key])
                break
        link = row.get("shopLink") or row.get("productUrl") or ""
        if link and link.startswith("/"):
            link = "https://kaspi.kz" + link
        unit_hint = " ".join(str(row.get(k, "")) for k in ("unit", "weight", "volume") if row.get(k))
        if title and price:
            items.append({"title": title, "price": price, "url": link, "unit_hint": unit_hint})
    return items


def search(s, cfg, query):
    city = cfg.get("kaspi_city", "750000000")
    params = {
        "text": query,
        "q": cfg.get("kaspi_filter", ":availableInZones:Magnum_ZONE1"),
        "page": 0, "all": "false", "fl": "true", "ui": "d", "i": -1, "c": city, "sort": "relevance",
    }
    headers = {
        "Accept": "application/json, text/*",
        "X-KS-City": city,
        "Referer": f"https://kaspi.kz/shop/search/?text={quote(query)}",
    }
    r = s.get(URL, params=params, headers=headers, timeout=25)
    if r.status_code != 200:
        dump_debug(f"kaspi_{norm(query).replace(' ', '_')}.txt", f"HTTP {r.status_code}\n{r.text[:3000]}")
        return []
    try:
        data = r.json()
    except ValueError:
        dump_debug(f"kaspi_{norm(query).replace(' ', '_')}.txt", r.text[:5000])
        return []
    items = extract(data)
    if not items:
        dump_debug(f"kaspi_{norm(query).replace(' ', '_')}.json", data)
    return items


def scrape(products, cfg):
    s = session()
    s.get("https://kaspi.kz/shop/", timeout=25)  # получить cookies
    out = {}
    for p in products:
        try:
            out[p["id"]] = search(s, cfg, p["q"])
        except Exception as e:  # noqa: BLE001
            print(f"  kaspi {p['id']}: {e}")
            out[p["id"]] = []
        polite_sleep(1.0)
    return out
