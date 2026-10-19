"""Fruehwarnung und Zusammenhaenge: Auswertungen ueber mehrere Tage, nur aus dem Cache.

Fruehwarnung: Ruhepuls, HRV, Schlaf und Belastungsanstieg gegen die eigenen letzten Wochen.
Zusammenhaenge: wie Schlaf, HRV, Last und Energiebilanz mit Erholung und Laufeffizienz
zusammenhaengen. Das sind Korrelationen aus wenigen Wochen, keine Ursachen.
"""

from __future__ import annotations

from datetime import date, timedelta
from statistics import mean, median
from typing import Any, Callable

from . import db, nutrition

MIN_PAIRS = 14


def _item(area: str, level: str, title: str, text: str) -> dict:
    return {"area": area, "level": level, "title": title, "text": text}


def _days(today: date, n: int) -> dict[str, dict[str, Any]]:
    """Tageswerte der letzten n Tage (inklusive heute), Schluessel = ISO-Datum."""
    start, end = (today - timedelta(days=n - 1)).isoformat(), today.isoformat()
    summary = db.daily_range("summary", start, end)
    sleep = db.daily_range("sleep", start, end)
    sleep_daily = db.daily_range("sleep_daily", start, end)
    hrv = db.daily_range("hrv", start, end)
    rhr = db.daily_range("rhr", start, end)
    ready = db.daily_range("readiness", start, end)
    out: dict[str, dict[str, Any]] = {}
    for i in range(n):
        ds = (today - timedelta(days=n - 1 - i)).isoformat()
        s, sl, sd, h = summary.get(ds) or {}, sleep.get(ds) or {}, sleep_daily.get(ds) or {}, hrv.get(ds) or {}
        out[ds] = {
            "sleep": sl.get("sleepSeconds") or sd.get("totalSleepTimeInSeconds"),
            "sleepScore": sl.get("score") or sd.get("sleepScore"),
            "hrv": h.get("lastNightAvg") or sd.get("avgOvernightHrv"),
            "hrvLow": (h.get("baseline") or {}).get("balancedLow"),
            "rhr": rhr.get(ds) or s.get("restingHeartRate") or sd.get("restingHeartRate"),
            "readiness": (ready.get(ds) or {}).get("score"),
            "burned": s.get("totalKilocalories"),
            "load": 0.0, "count": 0, "ef": [],
        }
    for a in db.activities_between(start, end):
        d = out.get(a["startTimeLocal"][:10])
        if d is None:
            continue
        d["load"] += a.get("activityTrainingLoad") or 0
        d["count"] += 1
        if a["_sport"] == "running" and (a.get("distance") or 0) >= 4000 and a.get("averageHR") and a.get("averageSpeed"):
            d["ef"].append(a["averageSpeed"] * 60 / a["averageHR"])
    return out


def _vals(rows: list[dict], key: str) -> list[float]:
    return [r[key] for r in rows if r.get(key) is not None]


def _hm(seconds: float) -> str:
    m = int(round(seconds / 60))
    return f"{m // 60}:{m % 60:02d} h"


# --- Fruehwarnung ---------------------------------------------------------------------

def warnings(today: date | None = None) -> dict[str, Any]:
    today = today or date.today()
    days = _days(today, 42)
    rows = list(days.values())
    # Heute fehlen morgens oft noch Werte: die letzten Tage mit Messung zaehlen
    recent, base = rows[-3:], rows[:-3][-28:]
    items: list[dict] = []
    checked: list[str] = []

    rhr_now, rhr_base = _vals(recent, "rhr"), _vals(base, "rhr")
    rhr_up = None
    if len(rhr_now) >= 2 and len(rhr_base) >= 10:
        rhr_up = mean(rhr_now) - mean(rhr_base)
        checked.append(f"Ruhepuls {mean(rhr_now):.0f} bpm (4 Wochen: {mean(rhr_base):.0f})")

    hrv_now, hrv_base = _vals(recent, "hrv"), _vals(base, "hrv")
    hrv_down = None
    below = 0
    if len(hrv_now) >= 2 and len(hrv_base) >= 10:
        hrv_down = (1 - mean(hrv_now) / mean(hrv_base)) * 100
        for r in reversed(rows):
            if r.get("hrv") is None:
                continue
            if r.get("hrvLow") and r["hrv"] < r["hrvLow"]:
                below += 1
            else:
                break
        checked.append(f"HRV {mean(hrv_now):.0f} ms (4 Wochen: {mean(hrv_base):.0f})")

    rhr_flag = rhr_up is not None and rhr_up >= 4
    hrv_flag = hrv_down is not None and (hrv_down >= 12 or below >= 3)
    if rhr_flag and hrv_flag:
        items.append(_item("Erholung", "warn", "Ruhepuls hoch, HRV niedrig",
                           f"Ruhepuls der letzten Tage {rhr_up:+.0f} bpm über deinem 4-Wochen-Schnitt, HRV {hrv_down:.0f} % darunter. "
                           "Diese Kombination zeigt sich oft vor einem Infekt oder bei Überlastung. Harte Einheiten besser verschieben."))
    elif rhr_flag:
        items.append(_item("Ruhepuls", "warn" if rhr_up >= 7 else "info", "Ruhepuls erhöht",
                           f"Im Schnitt {mean(rhr_now):.0f} bpm in den letzten Tagen, {rhr_up:+.0f} bpm über deinem 4-Wochen-Schnitt."))
    elif hrv_flag:
        text = f"Im Schnitt {mean(hrv_now):.0f} ms, {hrv_down:.0f} % unter deinem 4-Wochen-Schnitt."
        if below >= 3:
            text += f" Seit {below} Nächten unter deinem Normalbereich."
        items.append(_item("HRV", "warn" if below >= 5 or hrv_down >= 20 else "info", "HRV niedrig", text))

    sleep_now, sleep_base = _vals(recent, "sleep"), _vals(base, "sleep")
    if len(sleep_now) >= 2:
        checked.append(f"Schlaf {_hm(mean(sleep_now))} pro Nacht")
        short = mean(sleep_now) < 6 * 3600
        less = len(sleep_base) >= 10 and mean(sleep_now) < mean(sleep_base) - 3600
        if short or less:
            tail = f", sonst {_hm(mean(sleep_base))}" if len(sleep_base) >= 10 else ""
            items.append(_item("Schlaf", "info", "Wenig Schlaf",
                               f"Im Schnitt {_hm(mean(sleep_now))} in den letzten Nächten{tail}. "
                               "Erholung und Anpassung an harte Einheiten leiden darunter."))

    load7 = sum(r["load"] for r in rows[-7:])
    prev = [sum(r["load"] for r in rows[-7 * (k + 1):-7 * k]) for k in range(1, 5)]
    prev = [p for p in prev if p > 0]
    if len(prev) >= 3 and load7 > 0:
        ratio = load7 / mean(prev)
        checked.append(f"Trainingslast 7 Tage {load7:.0f} (Vorwochen: {mean(prev):.0f})")
        if ratio >= 1.3:
            items.append(_item("Belastung", "warn" if ratio >= 1.5 else "info", "Belastung steigt schnell",
                               f"Trainingslast der letzten 7 Tage {load7:.0f}, das sind {(ratio - 1) * 100:.0f} % mehr als im "
                               f"Schnitt der Wochen davor ({mean(prev):.0f}). Sprünge über 30 % erhöhen das Verletzungsrisiko."))

    streak = 0
    for r in reversed(rows[:-1] if not rows[-1]["count"] else rows):
        if not r["count"]:
            break
        streak += 1
    checked.append(f"{streak} Trainingstage in Folge")
    if streak >= 8:
        items.append(_item("Ruhetage", "info", "Lange ohne Ruhetag",
                           f"{streak} Tage in Folge mit Training. Ein Tag ohne Belastung hilft, die Arbeit umzusetzen."))

    order = {"warn": 0, "info": 1}
    items.sort(key=lambda x: order[x["level"]])
    level = items[0]["level"] if items else "ok"
    return {"level": level, "items": items, "checked": checked}


# --- Zusammenhaenge -------------------------------------------------------------------

def _pearson(xs: list[float], ys: list[float]) -> float | None:
    mx, my = mean(xs), mean(ys)
    sx = sum((x - mx) ** 2 for x in xs) ** 0.5
    sy = sum((y - my) ** 2 for y in ys) ** 0.5
    if not sx or not sy:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def _relation(key: str, title: str, pairs: list[tuple[float, float]], xfmt: Callable[[float], str],
              yfmt: Callable[[float], str], high: str, low: str, what: str, cut: float | None = None) -> dict:
    """Teilt die Tage am Median des Einflusswerts und vergleicht den Mittelwert der Zielgroesse."""
    out: dict[str, Any] = {"key": key, "title": title, "n": len(pairs), "strength": "none", "r": None}
    if len(pairs) < MIN_PAIRS:
        out["text"] = f"Noch zu wenige gemeinsame Tage ({len(pairs)} von {MIN_PAIRS})."
        return out
    xs, ys = [p[0] for p in pairs], [p[1] for p in pairs]
    if cut is None:
        cut = median(xs)
        hi, lo = [y for x, y in pairs if x >= cut], [y for x, y in pairs if x < cut]
    else:  # feste Grenze: alles darueber gegen den Rest
        hi, lo = [y for x, y in pairs if x > cut], [y for x, y in pairs if x <= cut]
    r = _pearson(xs, ys)
    if r is None or not hi or not lo:
        out["text"] = "Die Werte schwanken zu wenig für eine Aussage."
        return out
    size = abs(r)
    out["r"] = round(r, 2)
    out["strength"] = "strong" if size >= 0.5 else "medium" if size >= 0.3 else "weak" if size >= 0.15 else "flat"
    out["text"] = (f"{high.format(cut=xfmt(cut))} liegt {what} im Schnitt bei {yfmt(mean(hi))}, "
                   f"{low.format(cut=xfmt(cut))} bei {yfmt(mean(lo))}.")
    out["high"], out["low"] = {"n": len(hi), "value": mean(hi)}, {"n": len(lo), "value": mean(lo)}
    return out


def relations(today: date | None = None, days: int = 120) -> list[dict]:
    today = today or date.today()
    data = _days(today, days)
    keys = list(data)
    all_ef = [e for d in data.values() for e in d["ef"]]
    ef_ref = median(all_ef) if all_ef else None
    food = nutrition.summary(today - timedelta(days=days - 1), today) if nutrition.enabled() else None

    def pairs(x: Callable[[dict, dict | None, str], float | None], y: Callable[[dict], float | None]) -> list[tuple[float, float]]:
        out = []
        for i, ds in enumerate(keys):
            prev = data[keys[i - 1]] if i else None
            a, b = x(data[ds], prev, ds), y(data[ds])
            if a is not None and b is not None:
                out.append((a, b))
        return out

    def ef_dev(d: dict) -> float | None:
        return (mean(d["ef"]) / ef_ref - 1) * 100 if d["ef"] and ef_ref else None

    def balance_prev(d: dict, prev: dict | None, ds: str) -> float | None:
        day = (date.fromisoformat(ds) - timedelta(days=1)).isoformat()
        f = (food or {}).get(day) or {}
        if not prev or not f.get("entries") or not f.get("kcal") or not prev.get("burned"):
            return None
        return f["kcal"] - prev["burned"]

    num = lambda unit: (lambda v: f"{v:.0f} {unit}")  # noqa: E731
    pct = lambda v: f"{v:+.1f} %".replace(".", ",").replace("-", "−")  # noqa: E731
    kcal = lambda v: f"{v:+.0f} kcal".replace("-", "−")  # noqa: E731
    sleep_x = lambda d, p, ds: d["sleep"]  # noqa: E731
    out = [
        _relation("sleep-hrv", "Schlafdauer und HRV", pairs(sleep_x, lambda d: d["hrv"]), _hm, num("ms"),
                  "Nach Nächten ab {cut}", "nach kürzeren", "die HRV"),
        _relation("sleep-ready", "Schlafdauer und Trainingsbereitschaft", pairs(sleep_x, lambda d: d["readiness"]), _hm, num("Punkten"),
                  "Nach Nächten ab {cut}", "nach kürzeren", "die Bereitschaft"),
        _relation("load-hrv", "Trainingslast am Vortag und HRV",
                  pairs(lambda d, p, ds: p["load"] if p else None, lambda d: d["hrv"]), lambda v: f"{v:.0f}", num("ms"),
                  "Nach Trainingstagen", "nach Ruhetagen", "die HRV der folgenden Nacht", cut=0),
        _relation("sleep-ef", "Schlafdauer und Laufeffizienz", pairs(sleep_x, ef_dev), _hm, pct,
                  "Nach Nächten ab {cut}", "nach kürzeren", "die Effizienz deiner Läufe gegenüber deinem Mittel"),
        _relation("hrv-ef", "HRV und Laufeffizienz", pairs(lambda d, p, ds: d["hrv"], ef_dev), num("ms"), pct,
                  "An Tagen mit HRV ab {cut}", "bei niedrigerer HRV", "die Effizienz deiner Läufe gegenüber deinem Mittel"),
    ]
    if food is not None:
        out.append(_relation("energy-ready", "Energiebilanz am Vortag und Trainingsbereitschaft",
                             pairs(balance_prev, lambda d: d["readiness"]), kcal, num("Punkten"),
                             "Nach Tagen mit einer Bilanz ab {cut}", "nach Tagen mit größerem Defizit", "die Bereitschaft"))
    return out
