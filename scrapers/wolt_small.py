"""Small через Wolt: открытый consumer-API ассортимента магазина.

Слаг магазина задаётся в config.json -> wolt_small_slug (часть URL wolt.com/.../venue/<slug>).
Цены Wolt приходят в тиынах (×100). На Wolt цены могут быть чуть выше полочных.
"""
from common import dump_debug, polite_sleep, session

API = "https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/{slug}"


def _items_from(payload):
    out = []
    for it in payload.get("items", []) or []:
        name = it.get("name") or ""
        price = it.get("price")
        if price is None:
            continue
        unit_hint = " ".join(str(x) for x in (it.get("unit_info"), it.get("description")) if x)
        out.append({"title": name, "price": price / 100, "unit_hint": unit_hint,
                    "url": f"https://wolt.com/ru/kaz/almaty/venue/{{slug}}/itemid-{it.get('id', '')}"})
    return out


def _walk_categories(cats):
    for c in cats or []:
        yield c
        yield from _walk_categories(c.get("subcategories"))


def fetch_all(slug):
    s = session()
    base = API.format(slug=slug)
    r = s.get(f"{base}/assortment", params={"language": "ru"}, timeout=25)
    if r.status_code != 200:
        dump_debug("wolt_assortment.txt", f"HTTP {r.status_code}\n{r.text[:3000]}")
        return []
    root = r.json()
    items = _items_from(root)
    leaf = [c for c in _walk_categories(root.get("categories")) if not c.get("subcategories")]
    for c in leaf:
        cslug = c.get("slug")
        if not cslug:
            continue
        try:
            rc = s.get(f"{base}/assortment/categories/slug/{cslug}", params={"language": "ru"}, timeout=25)
            if rc.status_code == 200:
                items += _items_from(rc.json())
        except Exception as e:  # noqa: BLE001
            print(f"  wolt {cslug}: {e}")
        polite_sleep(0.4)
    if not items:
        dump_debug("wolt_assortment.json", root)
    for it in items:
        it["url"] = it["url"].replace("{slug}", slug)
    return items


def scrape(products, cfg):
    slug = cfg.get("wolt_small_slug", "smallala50")
    items = fetch_all(slug)
    print(f"  wolt: всего товаров в ассортименте {len(items)}")
    return {p["id"]: items for p in products}
