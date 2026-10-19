"""Bestleistungen und Kraft-Verlauf je Uebung - nur aus dem Cache gerechnet.

Die Zeitreihen sind auf rund 400 Punkte je Einheit verdichtet. Fuer Strecken ab 1 km und
Leistungsfenster ab 1 min reicht das; kuerzere Spitzen (5 s) lassen sich daraus nicht ableiten.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from . import db

RUN_DISTANCES = (("1k", "1 km", 1000.0), ("5k", "5 km", 5000.0), ("10k", "10 km", 10000.0),
                 ("hm", "Halbmarathon", 21097.5))
RIDE_DISTANCES = (("20k", "20 km", 20000.0), ("40k", "40 km", 40000.0))
POWER_WINDOWS = (("p1", "1 min", 60.0), ("p5", "5 min", 300.0), ("p20", "20 min", 1200.0),
                 ("p60", "60 min", 3600.0))
MAX_SPEED = {"running": 6.7, "cycling": 22.0}  # m/s, alles darueber ist ein GPS-Sprung
RECENT_DAYS = 30

_cache: dict[int, dict[str, float]] = {}


def _pairs(a: list, b: list) -> tuple[list[float], list[float]]:
    xs, ys = [], []
    for x, y in zip(a or [], b or []):
        if x is None or y is None or (xs and x <= xs[-1]):
            continue
        xs.append(x)
        ys.append(y)
    return xs, ys


def best_time(t: list[float], d: list[float], dist: float, vmax: float) -> float | None:
    """Schnellste Zeit ueber `dist` Meter irgendwo in der Einheit (linear interpoliert)."""
    best = None
    i = 0
    for j in range(1, len(d)):
        target = d[j] - dist
        if target < d[0]:
            continue
        while i + 1 < j and d[i + 1] <= target:
            i += 1
        span = d[i + 1] - d[i]
        t0 = t[i] + (t[i + 1] - t[i]) * ((target - d[i]) / span if span > 0 else 0)
        secs = t[j] - t0
        if secs <= 0 or dist / secs > vmax:
            continue
        if best is None or secs < best:
            best = secs
    return best


def best_power(t: list[float], p: list[float], window: float) -> float | None:
    """Hoechste mittlere Leistung ueber `window` Sekunden (zeitgewichtet)."""
    if len(t) < 3 or t[-1] - t[0] < window:
        return None
    steps = sorted(t[k + 1] - t[k] for k in range(len(t) - 1))
    if window < 3 * steps[len(steps) // 2]:
        return None  # Fenster feiner als die Aufloesung der Zeitreihe
    cum = [0.0]
    for k in range(1, len(t)):
        cum.append(cum[-1] + (p[k] + p[k - 1]) / 2 * (t[k] - t[k - 1]))
    best = None
    i = 0
    for j in range(1, len(t)):
        start = t[j] - window
        if start < t[0]:
            continue
        while i + 1 < j and t[i + 1] <= start:
            i += 1
        span = t[i + 1] - t[i]
        c0 = cum[i] + (cum[i + 1] - cum[i]) * ((start - t[i]) / span if span > 0 else 0)
        avg = (cum[j] - c0) / window
        if best is None or avg > best:
            best = avg
    return best


def _activity_bests(act_id: int, sport: str) -> dict[str, float]:
    if act_id in _cache:
        return _cache[act_id]
    found = db.activity(act_id)
    detail = found[1] if found else None
    if detail is None:
        return {}  # Details noch nicht geladen - nicht merken
    series = detail.get("series") or {}
    out: dict[str, float] = {}
    t, d = _pairs(series.get("t"), series.get("d"))
    if len(t) > 2:
        for key, _, dist in (RUN_DISTANCES if sport == "running" else RIDE_DISTANCES):
            secs = best_time(t, d, dist, MAX_SPEED[sport])
            if secs:
                out[key] = secs
    if sport == "cycling":
        tp, p = _pairs(series.get("t"), series.get("p"))
        for key, _, window in POWER_WINDOWS:
            watts = best_power(tp, p, window)
            if watts:
                out[key] = watts
    _cache[act_id] = out
    return out


def _entry(key: str, label: str, kind: str, rows: list[tuple[float, dict]], lower_is_better: bool) -> dict | None:
    """rows: (Wert, Aktivitaet). Liefert Bestwert und den besten Wert einer frueheren Einheit."""
    if not rows:
        return None
    rows = sorted(rows, key=lambda r: r[0], reverse=not lower_is_better)
    value, act = rows[0]
    day = act["startTimeLocal"][:10]
    prev = next(((v, a) for v, a in rows[1:] if a["startTimeLocal"][:10] < day), None)
    return {
        "key": key, "label": label, "kind": kind, "value": value,
        "date": day, "id": act["activityId"], "name": act.get("activityName"),
        "recent": day >= (date.today() - timedelta(days=RECENT_DAYS)).isoformat(),
        "prev": {"value": prev[0], "date": prev[1]["startTimeLocal"][:10]} if prev else None,
    }


def bests(sport: str) -> list[dict]:
    """Bestleistungen ueber alle gespeicherten Einheiten einer Sportart."""
    if sport not in ("running", "cycling"):
        return []
    acts = db.activities_between("0000-00-00", "9999-12-31", sport)
    per_key: dict[str, list[tuple[float, dict]]] = {}
    for a in acts:
        for key, value in _activity_bests(a["activityId"], sport).items():
            per_key.setdefault(key, []).append((value, a))
    out = []
    for key, label, dist in (RUN_DISTANCES if sport == "running" else RIDE_DISTANCES):
        e = _entry(key, label, "time", per_key.get(key, []), True)
        if e:
            e["distance"] = dist
            out.append(e)
    if sport == "cycling":
        for key, label, _ in POWER_WINDOWS:
            e = _entry(key, f"Leistung {label}", "power", per_key.get(key, []), False)
            if e:
                out.append(e)
    longest = "Längster Lauf" if sport == "running" else "Längste Fahrt"
    for key, label, kind, field in (("dist", longest, "distance", "distance"),
                                    ("elev", "Meiste Höhenmeter", "elevation", "elevationGain")):
        e = _entry(key, label, kind, [(a[field], a) for a in acts if a.get(field)], False)
        if e:
            out.append(e)
    return out


def held_by(act_id: int, sport: str) -> list[str]:
    """Namen der Bestleistungen, die diese Einheit aktuell haelt."""
    return [b["label"] for b in bests(sport) if b["id"] == act_id]


# --- Kraft ------------------------------------------------------------------------

def _exercise_key(ex: dict | None) -> str | None:
    if not ex:
        return None
    key = ex.get("name") or ex.get("category")
    return key if key and key != "UNKNOWN" else None


def exercises(acts: list[dict]) -> list[dict]:
    """Verlauf je Uebung: bester Satz (geschaetztes 1RM nach Epley), Volumen, Saetze pro Einheit."""
    by_ex: dict[str, list[dict]] = {}
    for a in sorted(acts, key=lambda x: x["startTimeLocal"]):
        found = db.activity(a["activityId"])
        detail = found[1] if found else None
        session: dict[str, dict] = {}
        for s in (detail or {}).get("sets", []):
            key = _exercise_key(s.get("exercise"))
            reps, kg = s.get("reps") or 0, (s.get("weight") or 0) / 1000
            if s.get("type") != "ACTIVE" or not key or not reps:
                continue
            row = session.setdefault(key, {"date": a["startTimeLocal"][:10], "id": a["activityId"],
                                           "sets": 0, "reps": 0, "volume": 0.0,
                                           "topWeight": 0.0, "topReps": 0, "e1rm": 0.0})
            row["sets"] += 1
            row["reps"] += reps
            row["volume"] += kg * reps
            e1rm = kg * (1 + min(reps, 12) / 30) if kg else 0.0
            if e1rm > row["e1rm"] or (not kg and reps > row["topReps"] and not row["topWeight"]):
                row.update(e1rm=e1rm, topWeight=kg, topReps=reps)
        for key, row in session.items():
            row["volume"] = round(row["volume"])
            row["e1rm"] = round(row["e1rm"], 1)
            by_ex.setdefault(key, []).append(row)
    out = [{"key": k, "sessions": v} for k, v in by_ex.items()]
    out.sort(key=lambda e: (-len(e["sessions"]), e["key"]))
    return out
