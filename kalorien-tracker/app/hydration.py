"""Wasser nach Garmin Connect uebertragen (ueber das Training-Dashboard, das den Garmin-Login hat).

Jede Zeile in `water` merkt sich in `synced_ml`, wie viel davon schon in Garmin steht.
Soll-Wert ist `ml`, bzw. 0 wenn geloescht. Der Hintergrund-Thread schickt nur die
Differenz (Garmin erlaubt negative Mengen zum Abziehen). Dadurch funktionieren
Rueckgaengig und Wiederherstellen ohne Sonderfaelle, und Ausfaelle holt er nach.
`synced_ml IS NULL` = Eintrag von vor der Garmin-Uebertragung, wird nie gesendet.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import date, timedelta
from typing import Any

import httpx

from . import budget, db

log = logging.getLogger("hydration")

_wake = threading.Event()
_state: dict[str, Any] = {"lastOk": None, "error": None}
MAX_AGE_DAYS = 7          # aeltere offene Aenderungen nicht mehr nachtragen


def status() -> dict[str, Any]:
    pending = db.one(
        "SELECT COUNT(*) n FROM water WHERE synced_ml IS NOT NULL "
        "AND synced_ml <> CASE WHEN deleted IS NULL THEN ml ELSE 0 END AND day >= ?",
        ((date.today() - timedelta(days=MAX_AGE_DAYS)).isoformat(),))["n"]
    return {"enabled": budget.enabled(), "pending": pending, **_state}


def kick() -> None:
    """Nach einer Aenderung sofort uebertragen statt auf den naechsten Durchlauf zu warten."""
    _wake.set()


def _push(day: str, tm: str | None, delta: float) -> None:
    r = httpx.post(f"{budget.DASHBOARD_URL}/internal/v1/hydration",
                   json={"date": day, "time": tm, "ml": delta},
                   headers={"Authorization": f"Bearer {budget.INTERNAL_TOKEN}"}, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"{r.status_code} {r.text[:120]}")


def sync_once() -> int:
    if not budget.enabled():
        return 0
    rows = db.query(
        "SELECT id, day, time, ml, deleted, synced_ml FROM water WHERE synced_ml IS NOT NULL "
        "AND synced_ml <> CASE WHEN deleted IS NULL THEN ml ELSE 0 END AND day >= ? ORDER BY id",
        ((date.today() - timedelta(days=MAX_AGE_DAYS)).isoformat(),))
    done = 0
    for r in rows:
        target = 0.0 if r["deleted"] else r["ml"]
        delta = target - r["synced_ml"]
        try:
            _push(r["day"], r["time"], delta)
        except Exception as e:
            _state["error"] = str(e)[:160]
            db.execute("UPDATE water SET sync_error=? WHERE id=?", (str(e)[:160], r["id"]))
            log.warning("Wasser nach Garmin fehlgeschlagen: %s", e)
            break  # Reihenfolge wahren, spaeter erneut
        db.execute("UPDATE water SET synced_ml=?, sync_error=NULL WHERE id=?", (target, r["id"]))
        _state.update(lastOk=time.time(), error=None)
        done += 1
    return done


def worker() -> None:
    while True:
        try:
            sync_once()
        except Exception as e:  # nie den Thread verlieren
            log.warning("Hydration-Worker: %s", e)
        _wake.wait(timeout=5 * 60)
        _wake.clear()
        time.sleep(1)  # mehrere schnelle Klicks zusammenfassen


def start() -> None:
    if budget.enabled():
        threading.Thread(target=worker, name="hydration", daemon=True).start()
