"""Общие функции: загрузка справочника, разбор фасовки, сопоставление товаров."""
import json
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DEBUG = ROOT / "debug"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")


def load_json(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def config():
    return json.loads((ROOT / "config.json").read_text(encoding="utf-8"))


def session():
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ru-RU,ru;q=0.9"})
    return s


def dump_debug(name, text):
    DEBUG.mkdir(exist_ok=True)
    (DEBUG / name).write_text(text if isinstance(text, str) else json.dumps(text, ensure_ascii=False, indent=1),
                              encoding="utf-8")


def norm(s):
    return (s or "").lower().replace("ё", "е").replace("\xa0", " ")


def parse_price(s):
    """'1 395 ₸' -> 1395.0"""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    digits = re.sub(r"[^\d.,]", "", str(s)).replace(",", ".")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


QTY_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(кг|гр|г|мл|л|шт)(?![а-я])")


def parse_qty(title, unit):
    """Количество товара в базовой единице продукта: кг, л или шт."""
    t = norm(title)
    found = QTY_RE.findall(t)
    for val, u in found:
        v = float(val.replace(",", "."))
        if v <= 0:
            continue
        if unit == "kg":
            if u == "кг":
                return v
            if u in ("г", "гр"):
                return v / 1000
        elif unit == "l":
            if u == "л":
                return v
            if u == "мл":
                return v / 1000
            if u == "кг":  # молочка иногда в кг
                return v
            if u in ("г", "гр"):
                return v / 1000
        elif unit == "pc":
            if u == "шт":
                return v
    # Весовой товар: "Картофель, кг" / "за 1 кг"
    if unit == "kg" and re.search(r"(^|[\s,(/])кг([\s,)]|$)|весов|за 1 кг", t):
        return 1.0
    if unit == "pc" and re.search(r"\bдесят", t):
        return 10.0
    return None


def matches(product, title):
    t = norm(title)
    for pat in product["must"]:
        if not re.search(pat, t):
            return False
    if product.get("excl") and re.search(product["excl"], t):
        return False
    return True


def pick_best(product, items, fallback):
    """items: [{title, price, url}] -> лучший по цене за единицу или None.

    Отсекаем подозрительные цены (в 3+ раза дешевле или в 4 раза дороже ориентира) —
    обычно это неверно распознанная фасовка или не тот товар.
    """
    best = None
    ref = fallback.get(product["id"])
    for it in items:
        if not it.get("price") or not matches(product, it["title"]):
            continue
        qty = it.get("qty") or parse_qty(it["title"] + " " + (it.get("unit_hint") or ""), product["unit"])
        if not qty:
            continue
        ppu = it["price"] / qty
        if ref and not (ref / 3 <= ppu <= ref * 4):
            continue
        if best is None or ppu < best["p"]:
            best = {"p": round(ppu), "t": it["title"], "u": it.get("url", ""), "price": it["price"]}
    return best


def polite_sleep(sec=0.6):
    time.sleep(sec)
