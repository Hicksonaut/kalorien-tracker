"""Regelbasierte Laufanalyse: was faellt an einer Einheit auf?

Reine Rechnung auf den gespeicherten Daten (Zusammenfassung, Runden, Zeitreihen),
keine externen Dienste. Jede Regel liefert einen Befund mit Ampel:
ok = unauffaellig, info = Hinweis, warn = auffaellig.

Die Schwellen sind Richtwerte. Wo es geht, wird gegen die eigene Baseline
verglichen (aehnliche Laeufe der letzten Monate), nicht gegen Normwerte.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from statistics import mean, median
from typing import Any

from . import db

# Pace-Vorgaben der Plan-Einheiten (s/km, schnelle und langsame Grenze).
# Stand 23.09.2026, identisch zu garmin-connect/training_plan.py.
TARGETS_SINCE = "2026-09-23"
TARGET_SCHWELLE = (300, 312)
TARGET_INTERVALL = (295, 305)
PACE_TOLERANCE = 3  # s/km Toleranz um den Zielbereich

STRUCTURED = {"WARMUP", "COOLDOWN", "RECOVERY", "REST"}


def _pace(sec_per_km: float) -> str:
    s = int(round(sec_per_km))
    return f"{s // 60}:{s % 60:02d}"


def _item(area: str, level: str, title: str, text: str) -> dict:
    return {"area": area, "level": level, "title": title, "text": text}


def _kind(name: str, laps: list[dict]) -> str:
    n = (name or "").lower()
    types = {l.get("intensityType") for l in laps}
    if "intervall" in n or re.search(r"\d+\s*x\s*\d+", n):
        return "intervals"
    if "schwelle" in n or "tempo" in n or "schwellen" in n:
        return "threshold"
    if types & STRUCTURED:
        return "structured"
    return "steady"


def _intended_zone(name: str) -> int | None:
    m = re.search(r"zone\s*(\d)", (name or "").lower())
    return int(m.group(1)) if m else None


def _series(detail: dict) -> tuple[list, list, list, list, list]:
    s = detail.get("series") or {}
    return (s.get("t") or [], s.get("d") or [], s.get("hr") or [], s.get("v") or [], s.get("c") or [])


def _time_at(t: list, d: list, dist: float) -> float | None:
    """Zeitpunkt, an dem die Distanz `dist` erreicht wurde."""
    for i in range(1, min(len(t), len(d))):
        if d[i] is not None and d[i] >= dist and d[i - 1] is not None:
            span = d[i] - d[i - 1]
            frac = (dist - d[i - 1]) / span if span > 0 else 0
            return t[i - 1] + frac * (t[i] - t[i - 1])
    return None


def _pacing(t: list, d: list, hr_steered: bool = False) -> list[dict]:
    """Gleichmaessigkeit: Start, Halbzeiten."""
    if len(t) < 20 or len(d) < 20 or not d[-1] or d[-1] < 3000:
        return []
    total = d[-1]
    t_half = _time_at(t, d, total / 2)
    if not t_half:
        return []
    p1 = t_half / (total / 2) * 1000
    p2 = (t[-1] - t_half) / (total / 2) * 1000
    diff = (p2 - p1) / p1 * 100  # positiv = zweite Haelfte langsamer
    out = []
    if diff > 4 and hr_steered:
        out.append(_item("Pacing", "info", "Tempo sinkt bei konstanter Herzfrequenz",
                         f"Erste Hälfte {_pace(p1)}, zweite {_pace(p2)} /km ({diff:.0f} % langsamer). "
                         "Bei pulsgesteuerten Läufen ist das normal, wenn Hitze oder Ermüdung den Puls treiben."))
    elif diff > 4:
        out.append(_item("Pacing", "warn", "Einbruch in der zweiten Hälfte",
                         f"Erste Hälfte {_pace(p1)}, zweite Hälfte {_pace(p2)} /km ({diff:.0f} % langsamer). "
                         "Der Start war vermutlich zu schnell oder die Belastung zu hoch."))
    elif diff > 2:
        out.append(_item("Pacing", "info", "Leicht nachlassend",
                         f"Zweite Hälfte {diff:.0f} % langsamer ({_pace(p1)} auf {_pace(p2)} /km)."))
    elif diff < -4:
        out.append(_item("Pacing", "info", "Deutlich negativer Split",
                         f"Zweite Hälfte {abs(diff):.0f} % schneller ({_pace(p1)} auf {_pace(p2)} /km). "
                         "Bei einem lockeren Lauf spricht das für einen zu verhaltenen Start."))
    else:
        out.append(_item("Pacing", "ok", "Gleichmäßig gelaufen",
                         f"Hälften {_pace(p1)} und {_pace(p2)} /km, Abweichung {diff:+.1f} %."))
    t_1k = _time_at(t, d, 1000)
    rest = (t[-1] - t_1k) / (total - 1000) * 1000 if t_1k and total > 2000 else None
    if t_1k and rest and (rest - t_1k) / rest * 100 > 6:
        out.append(_item("Start", "info" if hr_steered else "warn", "Zu schneller Start",
                         f"Erster Kilometer {_pace(t_1k)}, Rest im Schnitt {_pace(rest)} /km."
                         + (" Der Puls hängt dem Tempo anfangs hinterher; die ersten Minuten bewusst zurückhalten." if hr_steered else "")))
    return out


def drift_pct(t: list, hr: list, v: list) -> float | None:
    """Kardiale Drift in Prozent: Puls pro Tempo im letzten Viertel gegen das zweite."""
    n = min(len(t), len(hr), len(v))
    if n < 40:
        return None

    def eff(lo: float, hi: float) -> float | None:
        a, b = int(n * lo), int(n * hi)
        pairs = [(hr[i], v[i]) for i in range(a, b) if hr[i] and v[i] and v[i] > 1.2 and hr[i] > 80]
        if len(pairs) < 15:
            return None
        return mean(h for h, _ in pairs) / mean(s for _, s in pairs)

    e1, e2 = eff(0.20, 0.45), eff(0.75, 1.0)
    if not e1 or not e2:
        return None
    return (e2 / e1 - 1) * 100


def _drift(t: list, hr: list, v: list) -> dict | None:
    drift = drift_pct(t, hr, v)
    if drift is None:
        return None
    if drift > 7:
        return _item("Pulsdrift", "warn", "Starke Pulsdrift",
                     f"Der Puls pro Tempo liegt am Ende {drift:.0f} % über dem Mittelteil. "
                     "Typisch bei Ermüdung, Hitze, zu wenig Trinken oder zu hohem Tempo.")
    if drift > 4:
        return _item("Pulsdrift", "info", "Pulsdrift",
                     f"Der Puls pro Tempo steigt über den Lauf um {drift:.0f} %.")
    return _item("Pulsdrift", "ok", "Stabile Effizienz",
                 f"Puls pro Tempo über den Lauf {drift:+.1f} %.")


def _cadence_fade(c: list) -> dict | None:
    vals = [x for x in c if x and x > 100]
    if len(vals) < 60:
        return None
    third = len(vals) // 3
    a, b = mean(vals[:third]), mean(vals[-third:])
    drop = (a - b) / a * 100
    if drop > 4:
        return _item("Kadenz", "warn", "Kadenz fällt ab",
                     f"Von {a:.0f} auf {b:.0f} spm im Verlauf ({drop:.0f} %). "
                     "Bei Ermüdung werden die Schritte länger und seltener, das belastet die Muskulatur stärker.")
    return None


def _zone_check(name: str, detail: dict) -> dict | None:
    zone = _intended_zone(name)
    zones = detail.get("hrZones") or []
    if not zone or not zones:
        return None
    total = sum(z.get("secs") or 0 for z in zones) or 1
    secs = {z["zone"]: z.get("secs") or 0 for z in zones}
    above = sum(v for k, v in secs.items() if k > zone) / total * 100
    below = sum(v for k, v in secs.items() if k < zone) / total * 100
    inside = secs.get(zone, 0) / total * 100
    if above > 25:
        return _item("Intensität", "warn", f"Zu hart für Zone {zone}",
                     f"{above:.0f} % der Zeit oberhalb von Zone {zone}, nur {inside:.0f} % im Ziel.")
    if below > 35:
        return _item("Intensität", "info", f"Eher locker für Zone {zone}",
                     f"{below:.0f} % der Zeit unterhalb von Zone {zone}, {inside:.0f} % im Ziel.")
    return _item("Intensität", "ok", f"Zone {zone} getroffen", f"{inside:.0f} % der Zeit in Zone {zone}.")


def _work_laps(laps: list[dict]) -> list[dict]:
    work = [l for l in laps if l.get("intensityType") == "ACTIVE" and (l.get("distance") or 0) >= 150
            and (l.get("averageSpeed") or 0) > 0]
    return work


def _target_check(kind: str, name: str, start: str, laps: list[dict]) -> list[dict]:
    n = (name or "").lower()
    if start[:10] < TARGETS_SINCE or "lauf" not in n:
        return []
    if kind == "intervals":
        lo, hi, label = TARGET_INTERVALL[0], TARGET_INTERVALL[1], "Intervall"
        work = [l for l in _work_laps(laps) if (l.get("distance") or 0) >= 800]
    elif kind == "threshold":
        lo, hi, label = TARGET_SCHWELLE[0], TARGET_SCHWELLE[1], "Schwellen"
        work = _work_laps(laps)
    else:
        return []
    if not work:
        return []
    paces = [1000 / l["averageSpeed"] for l in work]
    fast = sum(1 for p in paces if p < lo - PACE_TOLERANCE)
    slow = sum(1 for p in paces if p > hi + PACE_TOLERANCE)
    avg = sum(l["duration"] for l in work) / sum(l["distance"] for l in work) * 1000
    rng = f"Ziel {_pace(lo)}-{_pace(hi)} /km, gelaufen im Schnitt {_pace(avg)}"
    out = []
    if fast:
        out.append(_item("Zielpace", "warn", f"{label}-Pace zu schnell",
                         f"{fast} von {len(paces)} Abschnitten schneller als vorgegeben. {rng}. "
                         "Zu schnelle Wiederholungen kosten Frische für die späteren und verfehlen den Trainingsreiz."))
    elif slow:
        out.append(_item("Zielpace", "warn", f"{label}-Pace zu langsam",
                         f"{slow} von {len(paces)} Abschnitten langsamer als vorgegeben. {rng}."))
    else:
        out.append(_item("Zielpace", "ok", "Im Zielbereich", f"Alle {len(paces)} Abschnitte im Bereich. {rng}."))
    if len(paces) >= 3:
        spread = max(paces) - min(paces)
        if spread > 10:
            out.append(_item("Wiederholungen", "info", "Ungleichmäßige Wiederholungen",
                             f"Spanne {spread:.0f} s/km zwischen schnellster ({_pace(min(paces))}) "
                             f"und langsamster ({_pace(max(paces))}) Wiederholung."))
        elif paces[-1] - paces[0] > 6:
            out.append(_item("Wiederholungen", "warn", "Letzte Wiederholung deutlich langsamer",
                             f"{_pace(paces[0])} auf {_pace(paces[-1])} /km: Die Belastung war zu hoch dosiert."))
    return out


def _baseline(act_id: int, start: str, speed: float, key: str, scale: float = 1.0) -> float | None:
    """Median eines Messwerts aus den letzten 150 Tagen bei aehnlichem Tempo (+-10 %)."""
    if not speed:
        return None
    day = date.fromisoformat(start[:10])
    past = db.activities_between((day - timedelta(days=150)).isoformat(), day.isoformat(), "running")
    vals = [a[key] * scale for a in past
            if a.get("activityId") != act_id and a.get("startTimeLocal", "") < start
            and a.get(key) and (a.get("averageSpeed") or 0) > 0
            and abs(a["averageSpeed"] / speed - 1) <= 0.10]
    return median(vals) if len(vals) >= 3 else None


def _dynamics(act_id: int, start: str, s: dict) -> list[dict]:
    """Laufdynamik: vertikale Oszillation, Vertikalverhaeltnis, Bodenkontakt, Kadenz."""
    speed = s.get("averageSpeed") or 0
    out = []
    vo, stride, gct = s.get("avgVerticalOscillation"), s.get("avgStrideLength"), s.get("avgGroundContactTime")
    if vo and stride:
        ratio = vo / stride * 100  # cm / cm
        base = _baseline(act_id, start, speed, "avgVerticalOscillation")
        base_stride = _baseline(act_id, start, speed, "avgStrideLength")
        base_ratio = base / base_stride * 100 if base and base_stride else None
        txt = f"Vertikale Oszillation {vo:.1f} cm bei {stride:.0f} cm Schrittlänge, Vertikalverhältnis {ratio:.1f} %."
        if base_ratio and ratio > base_ratio * 1.08:
            out.append(_item("Laufdynamik", "warn", "Mehr Auf-und-ab als sonst",
                             f"{txt} Dein Wert bei ähnlichem Tempo liegt bei {base_ratio:.1f} %. "
                             "Du springst mehr, als du nach vorne kommst; oft Ermüdung oder zu wenig Vorwärtsimpuls."))
        elif ratio > 10:
            out.append(_item("Laufdynamik", "info", "Hohes Vertikalverhältnis",
                             f"{txt} Werte über etwa 10 % gelten als hoch (viel Energie geht in die Höhe statt nach vorne)."))
        else:
            tail = f" Dein Vergleichswert: {base_ratio:.1f} %." if base_ratio else ""
            out.append(_item("Laufdynamik", "ok", "Vertikale Bewegung unauffällig", txt + tail))
    if gct:
        base = _baseline(act_id, start, speed, "avgGroundContactTime")
        if base and gct > base * 1.08:
            out.append(_item("Bodenkontakt", "warn", "Längerer Bodenkontakt",
                             f"{gct:.0f} ms gegenüber {base:.0f} ms bei ähnlichem Tempo. "
                             "Das passiert bei Ermüdung oder weichem Untergrund und kostet Tempo."))
        elif base:
            out.append(_item("Bodenkontakt", "ok", "Bodenkontakt normal", f"{gct:.0f} ms (Vergleich {base:.0f} ms)."))
    return out


def _cadence_level(act_id: int, start: str, s: dict) -> dict | None:
    cad = s.get("averageRunningCadenceInStepsPerMinute")
    base = _baseline(act_id, start, s.get("averageSpeed") or 0, "averageRunningCadenceInStepsPerMinute")
    if not cad or not base:
        return None
    dev = (cad - base) / base * 100
    if dev < -5:
        return _item("Kadenz", "info", "Niedrigere Kadenz als sonst",
                     f"{cad:.0f} spm gegenüber {base:.0f} spm bei ähnlichem Tempo. "
                     "Längere, seltenere Schritte erhöhen den Bremsimpuls (Overstriding).")
    return None


def analyze_run(act_id: int, summary: dict, detail: dict | None) -> dict | None:
    """Gibt {'summary', 'level', 'items'} zurueck oder None, wenn nichts zu bewerten ist."""
    if summary.get("_sport") != "running" or not detail or (summary.get("distance") or 0) < 2000:
        return None
    name = summary.get("activityName") or ""
    start = summary.get("startTimeLocal") or ""
    laps = detail.get("laps") or []
    kind = _kind(name, laps)
    t, d, hr, v, c = _series(detail)

    items: list[dict] = []
    if kind in ("steady", "structured"):
        items += _pacing(t, d, _intended_zone(name) is not None) if kind == "steady" else []
        drift = _drift(t, hr, v) if kind == "steady" else None
        if drift:
            items.append(drift)
        zone = _zone_check(name, detail)
        if zone:
            items.append(zone)
        fade = _cadence_fade(c) if kind == "steady" else None
        if fade:
            items.append(fade)
    items += _target_check(kind, name, start, laps)
    if kind in ("intervals", "threshold", "structured"):
        zone = _zone_check(name, detail)
        if zone and zone not in items:
            items.append(zone)
    cad = _cadence_level(act_id, start, summary)
    if cad:
        items.append(cad)
    items += _dynamics(act_id, start, summary)

    temp = summary.get("maxTemperature")
    if temp is not None and temp >= 25:
        items.append(_item("Bedingungen", "info", "Warm",
                           f"Bis {temp:.0f} °C. Höherer Puls und Pulsdrift sind bei Hitze zu erwarten."))
    if not items:
        return None

    order = {"warn": 0, "info": 1, "ok": 2}
    items.sort(key=lambda x: order[x["level"]])
    warns = sum(1 for i in items if i["level"] == "warn")
    infos = sum(1 for i in items if i["level"] == "info")
    if warns:
        level, text = "warn", f"{warns} Auffälligkeit{'en' if warns > 1 else ''}"
        text += f", {infos} Hinweis{'e' if infos > 1 else ''}" if infos else ""
    elif infos:
        level, text = "info", f"{infos} Hinweis{'e' if infos > 1 else ''}"
    else:
        level, text = "ok", "Keine Auffälligkeiten"
    return {"level": level, "summary": text, "items": items}


# --- Fortschritt ueber mehrere Laeufe ---------------------------------------------

def _ef(speed: float, hr: float) -> float:
    """Effizienzfaktor: Meter pro Herzschlag (hoeher = effizienter)."""
    return speed * 60 / hr


def progress(days: int = 365) -> dict[str, Any]:
    """Vergleichbare Einheiten im Zeitverlauf: Schwellenlaeufe und Zone-3-Laeufe."""
    today = date.today()
    acts = db.activities_between((today - timedelta(days=days)).isoformat(), today.isoformat(), "running")
    threshold, zone3 = [], []
    for a in reversed(acts):
        if (a.get("distance") or 0) < 5000 or not a.get("averageHR"):
            continue
        found = db.activity(a["activityId"])
        detail = found[1] if found else None
        if not detail:
            continue
        name = (a.get("activityName") or "").lower()
        laps = detail.get("laps") or []
        day = a["startTimeLocal"][:10]
        base = {"id": a["activityId"], "date": day, "temp": a.get("maxTemperature")}

        types = {l.get("intensityType") for l in laps}
        is_thr = ("schwelle" in name or ("tempo" in name and day >= "2026-08-01")) \
            and not (types & {"RECOVERY", "REST"})
        if is_thr:
            work = _work_laps(laps)
            if not work and "WARMUP" in types:  # aeltere Einheiten: Arbeitsabschnitte als INTERVAL
                work = [l for l in laps if l.get("intensityType") == "INTERVAL" and (l.get("distance") or 0) >= 150
                        and (l.get("averageSpeed") or 0) > 0]
            dist = sum(l["distance"] for l in work)
            dur = sum(l["duration"] for l in work)
            hrs = [(l["averageHR"], l["duration"]) for l in work if l.get("averageHR")]
            if dist >= 2000 and hrs:
                speed = dist / dur
                hr = sum(h * w for h, w in hrs) / sum(w for _, w in hrs)
                threshold.append({**base, "pace": 1000 / speed, "hr": hr, "ef": _ef(speed, hr),
                                  "minutes": dur / 60})
            continue

        zones = detail.get("hrZones") or []
        total = sum(z.get("secs") or 0 for z in zones)
        z3 = next((z.get("secs") or 0 for z in zones if z.get("zone") == 3), 0)
        if total and z3 / total >= 0.6 and not (types & STRUCTURED) and (a.get("duration") or 0) >= 1500:
            t, d, hr, v, _ = _series(detail)
            zone3.append({**base, "pace": 1000 / a["averageSpeed"], "hr": a["averageHR"],
                          "ef": _ef(a["averageSpeed"], a["averageHR"]),
                          "drift": drift_pct(t, hr, v), "share": z3 / total * 100})
    return {"threshold": threshold, "zone3": zone3}
