"""Eintraege, Wasser und die Aufbereitung pro Screen (Heute, Woche, Verlauf, Summary)."""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Any

from . import budget, db, foods, hydration
from .db import NUTRIENTS

MEALS = ("breakfast", "lunch", "dinner", "snack")
UNITS = ("g", "ml", "piece", "serving", "kcal")


def _round(v: float | None, digits: int = 1) -> float | None:
    return None if v is None else round(v, digits)


def _entry(r: Any) -> dict[str, Any]:
    e = dict(r)
    e.pop("deleted", None)
    for n in NUTRIENTS:
        e[n] = _round(e[n], 0 if n == "kcal" else 1)
    return e


def default_meal(t: datetime | None = None) -> str:
    h = (t or datetime.now()).hour
    return "breakfast" if 4 <= h < 11 else "lunch" if 11 <= h < 15 else "dinner" if 17 <= h < 22 else "snack"


# --- Eintraege ------------------------------------------------------------------------

def _check_day(day: str) -> str:
    date.fromisoformat(day)
    return day


def _grams(food: dict[str, Any], amount: float, unit: str) -> float:
    if unit in ("g", "ml"):
        return amount
    if unit == "piece" and food.get("piece"):
        return amount * food["piece"]["g"]
    if unit == "serving" and food.get("serving"):
        return amount * food["serving"]["g"]
    raise ValueError("Einheit passt nicht zum Lebensmittel")


def create_entry(data: dict[str, Any]) -> int:
    day = _check_day(str(data.get("day") or date.today().isoformat()))
    meal = data.get("meal") if data.get("meal") in MEALS else default_meal()
    tm = str(data.get("time") or datetime.now().strftime("%H:%M"))[:5]
    unit = data.get("unit") if data.get("unit") in UNITS else "g"
    amount = foods._num(data.get("amount"), 0.01, 100000)
    if amount is None:
        raise ValueError("Menge fehlt")
    vals: dict[str, Any] = {n: None for n in NUTRIENTS}
    if unit == "kcal":  # Schnelleintrag: nur kcal, Makros optional
        ref, brand, grams = None, None, None
        name = str(data.get("name") or "").strip()[:80] or "Schnelleintrag"
        vals["kcal"] = amount
        for n in ("protein", "carbs", "fat"):
            vals[n] = foods._num(data.get(n), 0, 1000)
    else:
        food = foods.get(str(data.get("ref") or ""))
        if not food:
            raise ValueError("Lebensmittel nicht gefunden")
        ref, name, brand = food["ref"], food["name"], food.get("brand")
        grams = _grams(food, amount, unit)
        for n in NUTRIENTS:
            v = food["per100"][n]
            vals[n] = None if v is None else v * grams / 100
    return db.execute(
        f"INSERT INTO entries(day, meal, time, ref, name, brand, amount, unit, grams, {', '.join(NUTRIENTS)}, created) "
        f"VALUES (?,?,?,?,?,?,?,?,?,{', '.join('?' * len(NUTRIENTS))},?)",
        (day, meal, tm, ref, name, brand, amount, unit, grams, *[vals[n] for n in NUTRIENTS], time.time()))


def update_entry(eid: int, data: dict[str, Any]) -> None:
    row = db.one("SELECT * FROM entries WHERE id=?", (eid,))
    if not row:
        raise KeyError(eid)
    e = dict(row)
    changes: dict[str, Any] = {}
    if "day" in data:
        changes["day"] = _check_day(str(data["day"]))
    if data.get("meal") in MEALS:
        changes["meal"] = data["meal"]
    if data.get("time"):
        changes["time"] = str(data["time"])[:5]
    if "amount" in data or "unit" in data:
        amount = foods._num(data.get("amount", e["amount"]), 0.01, 100000)
        unit = data.get("unit", e["unit"])
        if amount is None or unit not in UNITS:
            raise ValueError("Menge fehlt")
        if e["unit"] == "kcal":
            changes.update(amount=amount, kcal=amount)
            for n in ("protein", "carbs", "fat"):
                if n in data:
                    changes[n] = foods._num(data.get(n), 0, 1000)
        else:
            if unit == e["unit"] and e["grams"]:
                grams = e["grams"] * amount / e["amount"]
            else:
                food = foods.get(e["ref"] or "")
                if not food:
                    raise ValueError("Die Einheit kann nicht mehr geändert werden")
                grams = _grams(food, amount, unit)
            factor = grams / e["grams"] if e["grams"] else 0
            changes.update(amount=amount, unit=unit, grams=grams,
                           **{n: None if e[n] is None else e[n] * factor for n in NUTRIENTS})
    if changes:
        db.execute(f"UPDATE entries SET {', '.join(f'{k}=?' for k in changes)} WHERE id=?", (*changes.values(), eid))


def delete_entry(eid: int, undo: bool = False) -> None:
    db.execute("UPDATE entries SET deleted=? WHERE id=?", (None if undo else time.time(), eid))


def copy_entries(ids: list[int], day: str, meal: str | None) -> list[int]:
    """Eintraege (z. B. ein Fruehstueck von gestern) auf einen Tag kopieren. Gibt die neuen ids zurueck."""
    day = _check_day(day)
    new_ids = []
    now = time.time()
    with db.transaction() as c:
        for eid in ids[:100]:
            r = c.execute("SELECT * FROM entries WHERE id=? AND deleted IS NULL", (eid,)).fetchone()
            if not r:
                continue
            c.execute(
                f"INSERT INTO entries(day, meal, time, ref, name, brand, amount, unit, grams, {', '.join(NUTRIENTS)}, created) "
                f"SELECT ?, ?, time, ref, name, brand, amount, unit, grams, {', '.join(NUTRIENTS)}, ? FROM entries WHERE id=?",
                (day, meal if meal in MEALS else r["meal"], now, eid))
            new_ids.append(c.execute("SELECT last_insert_rowid()").fetchone()[0])
    return new_ids


def add_water(day: str, ml: float) -> int:
    ml = foods._num(ml, 1, 5000)
    if ml is None:
        raise ValueError("Menge fehlt")
    # synced_ml=0: neu, wird vom Hintergrund-Thread nach Garmin uebertragen
    wid = db.execute("INSERT INTO water(day, time, ml, created, synced_ml) VALUES (?,?,?,?,0)",
                     (_check_day(day), datetime.now().strftime("%H:%M"), ml, time.time()))
    hydration.kick()
    return wid


def delete_water(wid: int, undo: bool = False) -> None:
    db.execute("UPDATE water SET deleted=? WHERE id=?", (None if undo else time.time(), wid))
    hydration.kick()


# --- Aggregation ------------------------------------------------------------------------

def _totals(start: str, end: str) -> dict[str, dict[str, Any]]:
    cols = ", ".join(f"SUM({n}) {n}" for n in NUTRIENTS)
    out = {}
    for r in db.query(f"SELECT day, COUNT(*) entries, {cols} FROM entries WHERE deleted IS NULL "
                      "AND day BETWEEN ? AND ? GROUP BY day", (start, end)):
        out[r["day"]] = dict(r)
    for r in db.query("SELECT day, SUM(ml) ml FROM water WHERE deleted IS NULL AND day BETWEEN ? AND ? GROUP BY day",
                      (start, end)):
        out.setdefault(r["day"], {"day": r["day"], "entries": 0})["water"] = r["ml"]
    return out


def series(start: date, end: date, fetch: bool = True) -> list[dict[str, Any]]:
    tot = _totals(start.isoformat(), end.isoformat())
    bud = budget.days(start, end, fetch=fetch)
    out = []
    d = start
    while d <= end:
        k = d.isoformat()
        t = tot.get(k, {})
        b = bud[k]
        out.append({
            "date": k,
            "entries": t.get("entries", 0),
            **{n: _round(t.get(n), 0 if n == "kcal" else 1) for n in NUTRIENTS},
            "water": t.get("water"),
            "budget": b["budget"],
            "burned": b["burned"],
            "final": b["final"],
            "source": b["source"],
        })
        d += timedelta(days=1)
    return out


def streak() -> dict[str, Any]:
    days = {r["day"] for r in db.query("SELECT DISTINCT day FROM entries WHERE deleted IS NULL AND day >= ?",
                                        ((date.today() - timedelta(days=800)).isoformat(),))}
    d = date.today()
    if d.isoformat() not in days:
        d -= timedelta(days=1)
    n = 0
    while d.isoformat() in days:
        n += 1
        d -= timedelta(days=1)
    first = db.one("SELECT MIN(day) d FROM entries WHERE deleted IS NULL")["d"]
    return {"streak": n, "logged": len(days), "since": first}


def day_view(day: str) -> dict[str, Any]:
    d = date.fromisoformat(_check_day(day))
    s = db.settings()
    b = budget.days(d, d)[d.isoformat()]
    rows = [_entry(r) for r in db.query(
        "SELECT * FROM entries WHERE day=? AND deleted IS NULL ORDER BY time, id", (d.isoformat(),))]
    totals = {n: _round(sum(e[n] or 0 for e in rows), 0 if n == "kcal" else 1) for n in NUTRIENTS}
    water = [dict(r) for r in db.query("SELECT id, time, ml FROM water WHERE day=? AND deleted IS NULL ORDER BY id",
                                        (d.isoformat(),))]
    # Wasserziel: Grundwert + Trainingszeit aus Garmin (auf 50 ml gerundet)
    extra = round(b["trainingMin"] / 60 * float(s.get("waterPerTrainingHour") or 0) / 50) * 50
    targets = {k: round(v) for k, v in budget.targets(b["budget"], s).items()}
    return {
        "date": d.isoformat(),
        "isToday": d == date.today(),
        "budget": b,
        "targets": targets,
        "totals": totals,
        "meals": {m: [e for e in rows if e["meal"] == m] for m in MEALS},
        "water": {"ml": sum(w["ml"] for w in water), "goal": s["waterGoalMl"] + extra, "base": s["waterGoalMl"],
                  "training": extra, "trainingMin": b["trainingMin"], "items": water, "garmin": hydration.status()},
        "yesterday": _yesterday(d, rows),
        "evening": _evening(d, b["budget"], totals, targets, s),
        "defaultMeal": default_meal() if d == date.today() else "snack",
        "garmin": budget.status(),
        **streak(),
    }


def _yesterday(d: date, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """"Wie gestern": fuer jede noch leere Mahlzeit, was am Vortag dort stand."""
    empty = [m for m in MEALS if not any(e["meal"] == m for e in rows)]
    if not empty:
        return {}
    prev = (d - timedelta(days=1)).isoformat()
    out = {}
    for m in empty:
        es = db.query("SELECT id, name, kcal FROM entries WHERE day=? AND meal=? AND deleted IS NULL ORDER BY time, id",
                      (prev, m))
        if es:
            out[m] = {"ids": [e["id"] for e in es], "kcal": round(sum(e["kcal"] or 0 for e in es)),
                      "names": [e["name"].split(",")[0] for e in es]}
    return out


def _evening(d: date, budget_kcal: float, totals: dict[str, Any], targets: dict[str, Any],
             s: dict[str, Any]) -> dict[str, Any] | None:
    """Ab 17 Uhr: was heute noch offen ist und was aus den eigenen Sachen gut passt."""
    now = datetime.now()
    if d != date.today() or now.hour < 17 or not s.get("eveningHint", True):
        return None
    left = budget_kcal - (totals["kcal"] or 0)
    protein_left = max(0.0, targets["protein"] - (totals["protein"] or 0))
    out: dict[str, Any] = {"kcal": round(left), "protein": round(protein_left), "suggestions": []}
    if left < 120:
        return out
    from . import templates  # templates importiert views
    cands = []
    for t in templates.list_all():
        if t["meal"] == "breakfast":
            continue  # abends kein Fruehstueck vorschlagen
        cands.append({"type": "template", "id": t["id"], "name": t["name"],
                      "kcal": t["totals"]["kcal"], "protein": t["totals"]["protein"], "detail": f"{len(t['items'])} Teile"})
    seen = set()
    for f in foods.favorites() + foods.recent(40) + foods.recipes():
        if f["ref"] in seen or f.get("deleted"):
            continue
        seen.add(f["ref"])
        last = f.get("last") or {}
        if last.get("unit") in ("g", "ml", "piece", "serving") and last.get("amount"):
            amount, unit = last["amount"], last["unit"]
        elif f.get("serving"):
            amount, unit = 1, "serving"
        elif f.get("piece"):
            amount, unit = 1, "piece"
        else:
            continue  # ohne sinnvolle Menge kein Vorschlag
        try:
            g = _grams(f, amount, unit)
        except ValueError:
            continue
        p = f["per100"]
        if p["kcal"] is None:
            continue
        kcal, protein = p["kcal"] * g / 100, (p["protein"] or 0) * g / 100
        label = {"piece": (f.get("piece") or {}).get("label", "Stück"), "serving": "Portion"}.get(unit, unit)
        cands.append({"type": "food", "ref": f["ref"], "name": f["name"].split(",")[0], "kcal": kcal, "protein": protein,
                      "amount": amount, "unit": unit, "detail": f"{amount:g} {label}".replace(".", ",")})
    lo, hi = min(150, left * 0.25), left * 1.1

    def score(c: dict[str, Any]) -> float:
        fill = min(c["kcal"] / left, 1)                         # fuellt das Budget, ohne es zu sprengen
        prot = min(c["protein"] / protein_left, 1) if protein_left > 10 else 0
        return fill + 1.5 * prot
    fits = sorted((c for c in cands if lo <= c["kcal"] <= hi), key=score, reverse=True)
    for c in fits[:3]:
        c["kcal"], c["protein"] = round(c["kcal"]), round(c["protein"], 1)
        out["suggestions"].append(c)
    return out


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def week_view(start: str | None) -> dict[str, Any]:
    s = _monday(date.fromisoformat(start) if start else date.today())
    days = series(s, s + timedelta(days=6))
    return {"start": s.isoformat(), "end": (s + timedelta(days=6)).isoformat(), "days": days,
            "today": date.today().isoformat(), "garmin": budget.status(), **_averages(days)}


def history_view(n: int) -> dict[str, Any]:
    end = date.today()
    days = series(end - timedelta(days=n - 1), end)
    return {"days": days, "garmin": budget.status(), **_averages(days), **streak()}


def _averages(days: list[dict[str, Any]]) -> dict[str, Any]:
    """Mittelwerte nur ueber erfasste Tage; Bilanz nur, wo auch Verbrauch da ist."""
    logged = [d for d in days if d["entries"] and d["date"] <= date.today().isoformat()]
    avg = {n: (sum(d[n] or 0 for d in logged) / len(logged) if logged else None) for n in NUTRIENTS}
    closed = [d for d in logged if d["burned"] and d["date"] < date.today().isoformat()]
    return {
        "avg": {k: _round(v) for k, v in avg.items()},
        "loggedDays": len(logged),
        "balance": round(sum((d["kcal"] or 0) - d["burned"] for d in closed)) if closed else None,
        "balanceDays": len(closed),
        "inBudget": sum(1 for d in logged if d["date"] < date.today().isoformat() and (d["kcal"] or 0) <= d["budget"] * 1.05),
    }


def summary(start: date, end: date) -> list[dict[str, Any]]:
    """Fuer das Dashboard (Server zu Server). Nur Cache, keine Rueckfrage beim Dashboard."""
    return [{"date": d["date"], "kcal": d["kcal"], "protein": d["protein"], "carbs": d["carbs"], "fat": d["fat"],
             "budget": d["budget"], "entries": d["entries"]} for d in series(start, end, fetch=False)]
