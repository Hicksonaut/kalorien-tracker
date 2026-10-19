"""Wettkaempfe (Countdown) und Formkurve.

Formkurve nach dem ueblichen Modell: Fitness = gleitender Mittelwert der Tageslast ueber
42 Tage, Ermuedung = ueber 7 Tage, Form = Fitness minus Ermuedung vom Vortag. Als Tageslast
dient Garmins Trainingslast je Einheit, nicht TSS - die absoluten Zahlen sind deshalb nicht
mit TrainingPeaks vergleichbar, die Form wird relativ zur Fitness bewertet.
"""

from __future__ import annotations

import math
import re
import time
from datetime import date, timedelta
from typing import Any

from . import db

KINDS = ("run", "triathlon", "ride", "other")
CTL_DAYS, ATL_DAYS = 42, 7
WARMUP_DAYS = 42  # so lange ist die Fitness nach dem ersten gespeicherten Tag noch unterschaetzt

# Form in Prozent der Fitness: (Untergrenze, Kurzname, Erklaerung)
FORM_ZONES = (
    (20, "Sehr frisch", "Deutlich ausgeruht. Hält das länger an, geht Fitness verloren."),
    (5, "Frisch", "Ausgeruht bei erhaltener Fitness: der Bereich für Wettkämpfe."),
    (-10, "Neutral", "Weder ermüdet noch frisch, typisch für ruhigere Wochen."),
    (-30, "Aufbau", "Ermüdung über der Fitness: der Bereich, in dem Training wirkt."),
    (-math.inf, "Hohe Ermüdung", "Viel Ermüdung im Verhältnis zur Fitness; Erholung einplanen. "
                                 "Bei niedriger Fitness schlägt der Wert schnell aus."),
)


# --- Wettkaempfe ----------------------------------------------------------------------

def events() -> list[dict]:
    return sorted(db.get_state("events", []) or [], key=lambda e: e["date"])


def add_event(name: str, day: str, kind: str, detail: str = "") -> dict:
    name, detail = name.strip()[:80], detail.strip()[:80]
    if not name:
        raise ValueError("Name fehlt")
    date.fromisoformat(day)
    if kind not in KINDS:
        raise ValueError("Unbekannte Art")
    event = {"id": int(time.time() * 1000), "name": name, "date": day, "kind": kind, "detail": detail}
    db.set_state("events", events() + [event])
    return event


def delete_event(event_id: int) -> bool:
    items = events()
    keep = [e for e in items if e["id"] != event_id]
    db.set_state("events", keep)
    return len(keep) != len(items)


def _prediction(event: dict) -> int | None:
    """Garmins Rennprognose, wenn der Wettkampf ein Lauf ueber eine der Standarddistanzen ist."""
    if event["kind"] != "run":
        return None
    text = f"{event['name']} {event['detail']}".lower()
    if re.search(r"halbmarathon|\bhm\b|21[,.]1", text):
        key = "timeHalfMarathon"
    elif "marathon" in text or "42" in text:
        key = "timeMarathon"
    elif re.search(r"\b10\s?(km|k)\b", text):
        key = "time10K"
    elif re.search(r"\b5\s?(km|k)\b", text):
        key = "time5K"
    else:
        return None
    return (db.get_blob("race_predictions") or {}).get(key)


def upcoming(today: date | None = None) -> list[dict]:
    today = today or date.today()
    out = []
    for e in events():
        days = (date.fromisoformat(e["date"]) - today).days
        if days >= 0:
            out.append({**e, "days": days, "prediction": _prediction(e)})
    return out


# --- Formkurve ------------------------------------------------------------------------

def form_zone(pct: float | None) -> dict | None:
    if pct is None:
        return None
    for floor, label, text in FORM_ZONES:
        if pct >= floor:
            return {"label": label, "text": text}
    return None


def curve(today: date | None = None) -> list[dict]:
    """Ein Eintrag je Tag vom ersten gespeicherten Training bis heute."""
    today = today or date.today()
    acts = db.activities_between("0000-00-00", today.isoformat())
    if not acts:
        return []
    load: dict[str, float] = {}
    for a in acts:
        ds = a["startTimeLocal"][:10]
        load[ds] = load.get(ds, 0) + (a.get("activityTrainingLoad") or 0)
    first = date.fromisoformat(min(load))
    k_ctl, k_atl = 1 - math.exp(-1 / CTL_DAYS), 1 - math.exp(-1 / ATL_DAYS)
    ctl = atl = 0.0
    out = []
    for i in range((today - first).days + 1):
        ds = (first + timedelta(days=i)).isoformat()
        tsb = ctl - atl  # Form am Morgen: Stand vor der heutigen Einheit
        day_load = load.get(ds, 0)
        ctl += (day_load - ctl) * k_ctl
        atl += (day_load - atl) * k_atl
        out.append({"date": ds, "load": round(day_load, 1), "ctl": round(ctl, 1), "atl": round(atl, 1),
                    "tsb": round(tsb, 1), "warmup": i < WARMUP_DAYS})
    return out


def status(series: list[dict] | None = None) -> dict[str, Any] | None:
    series = series if series is not None else curve()
    if len(series) < 14:
        return None
    last = series[-1]
    morning = series[-2]["ctl"]  # Form und Fitness vom selben Zeitpunkt: vor der heutigen Einheit
    pct = last["tsb"] / morning * 100 if morning > 1 else None
    back = lambda n: series[-1 - n]["ctl"] if len(series) > n else None  # noqa: E731
    return {
        "date": last["date"], "ctl": last["ctl"], "atl": last["atl"], "tsb": last["tsb"],
        "pct": round(pct, 1) if pct is not None else None, "zone": form_zone(pct),
        "ramp7": round(last["ctl"] - back(7), 1) if back(7) is not None else None,
        "ramp28": round(last["ctl"] - back(28), 1) if back(28) is not None else None,
        "warmup": last["warmup"], "days": len(series),
    }


def view(weeks: int, today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    series = curve(today)
    return {"series": series[-weeks * 7:], "status": status(series), "events": upcoming(today),
            "past": [e for e in events() if e["date"] < today.isoformat()][-5:]}
