"""Verbindung zum Kalorien-Tracker (Server zu Server im Docker-Netz `homelab-apps`).

- Tracker -> Dashboard: `energy()` liefert den Garmin-Verbrauch fuer /internal/v1/energy.
- Dashboard -> Tracker: `summary()` holt gegessene kcal/Makros pro Tag.

Beide Richtungen nutzen denselben geteilten Token (`INTERNAL_TOKEN` in `.env`).
Ist der Tracker nicht erreichbar, liefert `summary()` None und das Dashboard
zeigt "–" statt eines Fehlers.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from typing import Any

from . import db

log = logging.getLogger("nutrition")

INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")
TRACKER_URL = os.getenv("TRACKER_URL", "").rstrip("/")            # intern, z. B. http://kalorien-tracker:8000
TRACKER_PUBLIC_URL = os.getenv("TRACKER_PUBLIC_URL", "").rstrip("/")  # fuer den Link im Browser
INTERNAL_NET = ipaddress.ip_network(os.getenv("INTERNAL_NET", "172.30.0.0/24"))
PROXY_IP = os.getenv("PROXY_IP", "172.30.0.10")
CACHE_SECONDS = 60
RETRY_AFTER_FAIL = 60

_cache: dict[tuple[str, str], tuple[float, Any]] = {}
_failed_at = 0.0
_lock = threading.Lock()


def internal_allowed(auth_header: str, client_ip: str | None) -> bool:
    """Nur mit Token und nur direkt aus dem Docker-Netz (nicht ueber den HTTPS-Proxy)."""
    if not INTERNAL_TOKEN:
        return False
    sent = (auth_header or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(sent.encode(), INTERNAL_TOKEN.encode()):
        return False
    try:
        ip = ipaddress.ip_address(client_ip or "")
    except ValueError:
        return False
    gateway = INTERNAL_NET.network_address + 1
    return ip in INTERNAL_NET and str(ip) not in (PROXY_IP, str(gateway))


# --- Tracker -> Dashboard: Verbrauch -------------------------------------------------

def _energy_day(ds: str) -> dict[str, Any]:
    s = db.get_daily("summary", ds) or {}
    meta = db.daily_meta("summary", ds)
    total, active = s.get("totalKilocalories"), s.get("activeKilocalories")
    bmr = s.get("bmrKilocalories")
    if bmr is None and total is not None and active is not None:
        bmr = total - active
    # Trainingszeit fuer den Wasser-Vorschlag im Tracker (Summe aller Aktivitaeten des Tages)
    secs = sum((a.get("duration") or 0) for a in db.activities_between(ds, ds))
    return {"date": ds, "totalKcal": total, "activeKcal": active, "bmrKcal": bmr,
            "trainingMinutes": round(secs / 60) if secs else 0,
            "final": bool(meta["final"]) if meta else False,
            "fetchedAt": meta["fetched_at"] if meta else None}


def energy(start: date, end: date) -> dict[str, Any]:
    days = []
    d = start
    while d <= end:
        days.append(_energy_day(d.isoformat()))
        d += timedelta(days=1)
    profile = db.get_blob("profile") or {}
    return {"days": days, "weightKg": (profile.get("weight") or 0) / 1000 or None}


# --- Dashboard -> Tracker: gegessen ------------------------------------------------------

def enabled() -> bool:
    return bool(TRACKER_URL and INTERNAL_TOKEN)


def summary(start: date, end: date) -> dict[str, dict[str, Any]] | None:
    """Tageswerte aus dem Tracker, als {datum: {...}}. None = Tracker nicht erreichbar."""
    global _failed_at
    if not enabled():
        return None
    key = (start.isoformat(), end.isoformat())
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_SECONDS:
            return hit[1]
        if now - _failed_at < RETRY_AFTER_FAIL:
            return hit[1] if hit else None
    url = f"{TRACKER_URL}/internal/v1/summary?" + urllib.parse.urlencode({"from": key[0], "to": key[1]})
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {INTERNAL_TOKEN}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            data = {d["date"]: d for d in json.load(r).get("days", [])}
    except Exception as e:
        log.info("Kalorien-Tracker nicht erreichbar: %s", e)
        with _lock:
            _failed_at = now
        return hit[1] if hit else None
    with _lock:
        _cache[key] = (now, data)
        if len(_cache) > 50:
            _cache.pop(next(iter(_cache)))
    return data


def link() -> str | None:
    return TRACKER_PUBLIC_URL or None
