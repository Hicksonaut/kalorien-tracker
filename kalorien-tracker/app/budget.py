"""Tagesbudget aus dem Garmin-Verbrauch (ueber das Training-Dashboard).

Regel: Budget = Ruheumsatz + Aktivkalorien +/- Ziel.
- Abgeschlossene Tage: Gesamtverbrauch laut Garmin + Ziel.
- Heute: Ruheumsatz (Mittel der letzten 7 abgeschlossenen Tage) + heutige
  Aktivkalorien bisher + Ziel. Das Budget waechst also nach dem Training.
- Ohne Garmin-Daten: fester Ersatzwert aus den Einstellungen.

Der Verbrauch kommt Server zu Server vom Dashboard (`/internal/v1/energy`) und
wird in `energy` gecacht. Faellt das Dashboard aus, laeuft alles mit dem Cache
bzw. dem Ersatzwert weiter.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import date, timedelta
from typing import Any

import httpx

from . import db

log = logging.getLogger("budget")

DASHBOARD_URL = os.getenv("DASHBOARD_URL", "").rstrip("/")   # z. B. http://garmin-dashboard:8000
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")
REFRESH_TODAY = 5 * 60        # heutigen Wert hoechstens alle 5 min holen
REFRESH_OPEN = 60 * 60        # nicht abgeschlossene Vortage stuendlich
RETRY_AFTER_FAIL = 2 * 60     # nach einem Fehler das Dashboard kurz in Ruhe lassen
RESTING_DAYS = 7
DEFAULT_WEIGHT = 75.0

_state: dict[str, Any] = {"lastError": None, "failedAt": 0.0, "weightKg": None, "lastOk": None}
_lock = threading.Lock()


def enabled() -> bool:
    return bool(DASHBOARD_URL and INTERNAL_TOKEN)


def status() -> dict[str, Any]:
    return {"enabled": enabled(), "lastOk": _state["lastOk"], "error": _state["lastError"]}


def _fetch(start: date, end: date) -> None:
    """Holt Verbrauchswerte fuer einen Zeitraum und schreibt sie in den Cache."""
    if not enabled() or time.time() - _state["failedAt"] < RETRY_AFTER_FAIL:
        return
    try:
        r = httpx.get(f"{DASHBOARD_URL}/internal/v1/energy",
                      params={"from": start.isoformat(), "to": end.isoformat()},
                      headers={"Authorization": f"Bearer {INTERNAL_TOKEN}"}, timeout=4)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        _state.update(lastError=str(e)[:160], failedAt=time.time())
        log.warning("Dashboard nicht erreichbar: %s", e)
        return
    now = time.time()
    with db.transaction() as c:
        for d in data.get("days", []):
            c.execute("INSERT OR REPLACE INTO energy(day, total, active, final, fetched_at, training_min) VALUES (?,?,?,?,?,?)",
                      (d["date"], d.get("totalKcal"), d.get("activeKcal"), int(bool(d.get("final"))), now,
                       d.get("trainingMinutes")))
    if data.get("weightKg"):
        _state["weightKg"] = data["weightKg"]
    _state.update(lastError=None, lastOk=now)


def refresh(start: date, end: date) -> None:
    """Aktualisiert fehlende oder veraltete Tage im Bereich (inkl. Ruheumsatz-Fenster)."""
    today = date.today()
    end = min(end, today)
    start = min(start, end) - timedelta(days=RESTING_DAYS + 3)
    rows = {r["day"]: r for r in db.query("SELECT * FROM energy WHERE day BETWEEN ? AND ?",
                                           (start.isoformat(), end.isoformat()))}
    now = time.time()
    stale = []
    d = start
    while d <= end:
        r = rows.get(d.isoformat())
        if r is None or not r["final"]:
            age = now - r["fetched_at"] if r else 1e12
            if age > (REFRESH_TODAY if d == today else REFRESH_OPEN):
                stale.append(d)
        d += timedelta(days=1)
    if stale:
        with _lock:
            _fetch(stale[0], stale[-1])


def _energy(start: date, end: date) -> dict[str, Any]:
    return {r["day"]: dict(r) for r in db.query("SELECT * FROM energy WHERE day BETWEEN ? AND ?",
                                                 (start.isoformat(), end.isoformat()))}


def _resting(energy: dict[str, Any], before: date) -> float | None:
    vals = []
    d = before - timedelta(days=1)
    for _ in range(21):  # die letzten 7 Tage mit Daten, max. 3 Wochen zurueck
        e = energy.get(d.isoformat())
        if e and e["final"] and e["total"] and e["active"] is not None and e["total"] > 800:
            vals.append(e["total"] - e["active"])
            if len(vals) >= RESTING_DAYS:
                break
        d -= timedelta(days=1)
    return sum(vals) / len(vals) if vals else None


def weight(settings: dict[str, Any] | None = None) -> float:
    s = settings or db.settings()
    return float(s.get("weightKg") or _state["weightKg"] or DEFAULT_WEIGHT)


def targets(budget: float, settings: dict[str, Any]) -> dict[str, float]:
    """Makroziele in g: Eiweiss und Fett pro kg, Kohlenhydrate = Rest."""
    kg = weight(settings)
    protein = kg * float(settings["proteinPerKg"])
    fat = kg * float(settings["fatPerKg"])
    carbs = max(0.0, (budget - protein * 4 - fat * 9) / 4)
    return {"protein": protein, "fat": fat, "carbs": carbs, "fiber": float(settings["fiberGoal"]),
            "sugar": float(settings["sugarMax"]), "salt": float(settings["saltMax"])}


def days(start: date, end: date, fetch: bool = True) -> dict[str, dict[str, Any]]:
    """Budget und Verbrauch pro Tag. `fetch=False` nutzt nur den Cache (fuer /internal)."""
    if fetch:
        refresh(start, end)
    s = db.settings()
    offset = float((s.get("goalOffset") or {}).get(s.get("goal", "maintain"), 0))
    energy = _energy(start - timedelta(days=25), end)
    today = date.today()
    out = {}
    d = start
    while d <= end:
        e = energy.get(d.isoformat())
        rest = _resting(energy, min(d, today))
        burned = None      # bisheriger bzw. endgueltiger Verbrauch
        estimate = None    # Verbrauch, der fuers Budget angesetzt wird
        source = "fallback"
        if d < today and e and e["total"]:
            burned = estimate = e["total"]
            if not e["final"] and rest and e["active"] is not None:
                estimate = max(e["total"], rest + e["active"])
            source = "garmin"
        elif d == today and rest is not None:
            active = (e or {}).get("active") or 0
            burned = e["total"] if e and e["total"] else None
            estimate = rest + active
            source = "garmin-live"
        elif d > today and rest is not None:
            estimate = rest
            source = "garmin-estimate"
        budget = (estimate + offset) if estimate else float(s["fallbackBudget"])
        out[d.isoformat()] = {
            "budget": round(budget),
            "burned": round(burned) if burned else None,
            "active": round(e["active"]) if e and e["active"] is not None else None,
            "resting": round(rest) if rest else None,
            "final": bool(e and e["final"]),
            "trainingMin": round(e["training_min"]) if e and e.get("training_min") else 0,
            "source": source,
            "offset": offset,
        }
        d += timedelta(days=1)
    return out
