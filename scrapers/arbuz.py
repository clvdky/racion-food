"""Arbuz.kz — поиск по сайту, цены парсятся из HTML карточек."""
import re
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup

from common import dump_debug, norm, parse_price, polite_sleep, session

BASE = "https://arbuz.kz"
PRICE_RE = re.compile(r"(\d[\d\s ]*)\s*₸")


def parse_cards(html):
    soup = BeautifulSoup(html, "html.parser")
    items, seen = [], set()
    for a in soup.select('a[href*="/catalog/item/"]'):
        href = a.get("href", "")
        if href in seen:
            continue
        title = (a.get("title") or a.get_text(" ", strip=True)).strip()
        # Поднимаемся к карточке, в которой есть цена
        node, price = a, None
        for _ in range(6):
            node = node.parent
            if node is None:
                break
            txt = node.get_text(" ", strip=True)
            m = PRICE_RE.findall(txt)
            if m:
                # если есть старая и новая цена — берём минимальную
                price = min(parse_price(x) for x in m)
                if not title or len(title) < 3:
                    title = txt.split("₸")[0][:120]
                break
        if title and price:
            seen.add(href)
            items.append({"title": title, "price": price, "url": urljoin(BASE, href)})
    return items


def search(s, city, query):
    urls = [
        f"{BASE}/ru/{city}/search?query={quote(query)}",
        f"{BASE}/ru/{city}/search?q={quote(query)}",
    ]
    for url in urls:
        r = s.get(url, timeout=25)
        if r.status_code != 200:
            continue
        items = parse_cards(r.text)
        if items:
            return items
        dump_debug(f"arbuz_{norm(query).replace(' ', '_')}.html", r.text)
    return []


def scrape(products, cfg):
    s = session()
    city = cfg.get("arbuz_city", "almaty")
    out = {}
    for p in products:
        try:
            out[p["id"]] = search(s, city, p["q"])
        except Exception as e:  # noqa: BLE001
            print(f"  arbuz {p['id']}: {e}")
            out[p["id"]] = []
        polite_sleep()
    return out
