"""Open Food Facts: Normalisierung (Export fuer scripts/build_off.py und Live-API) und Barcode-Fallback.

Die Suche laeuft nie gegen die OFF-API. Live wird nur ein einzelner Barcode
nachgeschlagen, wenn er lokal fehlt - hoechstens 15 Anfragen pro Minute, mit
eigenem User-Agent. Treffer landen in captured.db (source 'off-live').
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import deque
from typing import Any

import httpx

log = logging.getLogger("off")

USER_AGENT = "kalorien-tracker/1.0 (privat)"
API = "https://world.openfoodfacts.org/api/v2/product/{code}"
API_FIELDS = ("code,product_name,product_name_de,brands,quantity,product_quantity_unit,serving_size,"
              "serving_quantity,nutriments,nutriscore_grade,image_front_small_url,lang")
IMG_BASE = "https://images.openfoodfacts.org/images/products"
RATE_PER_MIN = 15

NUTRI_MAP = {
    "proteins": "protein", "carbohydrates": "carbs", "sugars": "sugar", "fat": "fat",
    "saturated-fat": "satfat", "fiber": "fiber", "salt": "salt",
}


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # NaN raus


def _serving(size: str | None, qty: Any) -> tuple[float | None, str | None]:
    g = _num(qty)
    label = (size or "").strip() or None
    if g is None and label:
        m = re.search(r"(\d+(?:[.,]\d+)?)\s*(g|ml)\b", label, re.I)
        if m:
            g = float(m.group(1).replace(",", "."))
    if g is not None and not (0 < g <= 2000):
        g = None
    if label and len(label) > 40:
        label = label[:40]
    return g, (label if g else None)


def _liquid(quantity: str | None, unit: str | None) -> int:
    if (unit or "").lower() in ("ml", "l", "cl"):
        return 1
    return 1 if re.search(r"\d\s*(ml|cl|l)\b", quantity or "", re.I) else 0


def image_url(code: str, key: str, rev: Any) -> str:
    c = code.zfill(13) if len(code) <= 13 else code
    folder = f"{c[0:3]}/{c[3:6]}/{c[6:9]}/{c[9:]}" if len(c) > 8 else c
    return f"{IMG_BASE}/{folder}/{key}.{rev}.200.jpg"


def _finish(item: dict[str, Any]) -> dict[str, Any] | None:
    """Plausibilitaet: Name, kcal und mindestens ein Makro muessen stimmen."""
    if not item.get("name") or item.get("kcal") is None:
        return None
    if not (0 <= item["kcal"] <= 950):
        return None
    item["kcal"] = round(item["kcal"], 1)
    for k in ("protein", "carbs", "sugar", "fat", "satfat", "fiber", "salt"):
        v = item.get(k)
        if v is not None and not (0 <= v <= 100):
            item[k] = None
        elif v is not None:
            item[k] = round(v, 2)  # Parquet liefert float32
    if all(item.get(k) is None for k in ("protein", "carbs", "fat")):
        return None
    item["name"] = re.sub(r"\s+", " ", item["name"]).strip()[:160]
    if item.get("brand"):
        item["brand"] = item["brand"].split(",")[0].strip()[:80] or None
    if item.get("nutriscore") not in ("a", "b", "c", "d", "e"):
        item["nutriscore"] = None
    return item


def from_api(p: dict[str, Any]) -> dict[str, Any] | None:
    nut = p.get("nutriments") or {}
    kcal = _num(nut.get("energy-kcal_100g"))
    if kcal is None and _num(nut.get("energy_100g")) is not None:
        kcal = _num(nut.get("energy_100g")) / 4.184
    sg, sl = _serving(p.get("serving_size"), p.get("serving_quantity"))
    item = {
        "code": str(p.get("code")), "name": p.get("product_name_de") or p.get("product_name"),
        "brand": p.get("brands"), "quantity": p.get("quantity") or None,
        "serving_g": sg, "serving_label": sl, "piece_g": None, "piece_label": None,
        "kcal": kcal, **{v: _num(nut.get(f"{k}_100g")) for k, v in NUTRI_MAP.items()},
        "nutriscore": p.get("nutriscore_grade"), "image": p.get("image_front_small_url"),
        "liquid": _liquid(p.get("quantity"), p.get("product_quantity_unit")),
        "popularity": 0,
    }
    return _finish(item)


def code_variants(code: str) -> list[str]:
    """EAN-13 vs. UPC-A (12 Stellen) mit/ohne fuehrende Null."""
    code = re.sub(r"\D", "", code)
    out = [code]
    if len(code) == 12:
        out.append("0" + code)
    if code.startswith("0"):
        out.append(code.lstrip("0"))
    return [c for i, c in enumerate(out) if c and c not in out[:i]]


# --- Live-Abfrage mit Drosselung ----------------------------------------------------

class RateLimited(Exception):
    pass


_calls: deque[float] = deque()
_rl_lock = threading.Lock()


def _take_slot() -> None:
    with _rl_lock:
        now = time.time()
        while _calls and now - _calls[0] > 60:
            _calls.popleft()
        if len(_calls) >= RATE_PER_MIN:
            raise RateLimited()
        _calls.append(now)


def fetch_live(code: str) -> dict[str, Any] | None:
    """Fragt OFF nach einem Barcode. None = unbekannt. Wirft RateLimited/httpx-Fehler."""
    _take_slot()
    r = httpx.get(API.format(code=code), params={"fields": API_FIELDS},
                  headers={"User-Agent": USER_AGENT}, timeout=8)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    data = r.json()
    if data.get("status") != 1 or not data.get("product"):
        return None
    p = data["product"]
    p.setdefault("code", code)
    return from_api(p)
