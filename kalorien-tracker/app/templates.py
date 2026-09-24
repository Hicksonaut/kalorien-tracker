"""Gespeicherte Mahlzeiten: feste Kombinationen aus Lebensmitteln mit Mengen.

Anders als ein Rezept (ein gekochtes Gericht mit Naehrwerten pro 100 g) bleibt eine
Mahlzeit eine Liste einzelner Eintraege - "Mein Fruehstueck" = Haferflocken 80 g +
Apfel 1 Stueck + Milch 200 ml. Beim Eintragen entstehen daraus normale Eintraege,
die sich danach einzeln aendern lassen.
"""

from __future__ import annotations

import time
from typing import Any

from . import db, foods, views
from .db import NUTRIENTS


def _items(tid: int) -> list[dict[str, Any]]:
    out = []
    for r in db.query("SELECT ref, name, amount, unit FROM template_items WHERE template_id=? ORDER BY position", (tid,)):
        it = dict(r)
        food = foods.get(it["ref"])
        it["available"] = bool(food and not food.get("deleted"))
        it["kind"] = food["kind"] if food else None
        if food:
            base = "ml" if food.get("liquid") else "g"
            it["units"] = ([[base, base]] + ([["piece", food["piece"]["label"]]] if food.get("piece") else [])
                           + ([["serving", "Portion"]] if food.get("serving") else []))
            if it["unit"] in ("g", "ml"):
                it["unit"] = base
        vals = {n: None for n in NUTRIENTS}
        if it["available"]:
            try:
                g = views._grams(food, it["amount"], it["unit"])
                it["grams"] = g
                vals = {n: None if food["per100"][n] is None else food["per100"][n] * g / 100 for n in NUTRIENTS}
            except ValueError:
                it["available"] = False
        it.update(vals)
        out.append(it)
    return out


def _view(row: Any) -> dict[str, Any]:
    items = _items(row["id"])
    totals = {n: round(sum(i[n] or 0 for i in items), 1) for n in NUTRIENTS}
    return {"id": row["id"], "name": row["name"], "meal": row["meal"], "used": row["used"],
            "items": items, "totals": totals}


def list_all() -> list[dict[str, Any]]:
    rows = db.query("SELECT * FROM templates WHERE deleted IS NULL ORDER BY used IS NULL, used DESC, name COLLATE NOCASE")
    return [_view(r) for r in rows]


def get(tid: int) -> dict[str, Any] | None:
    row = db.one("SELECT * FROM templates WHERE id=?", (tid,))
    return _view(row) if row else None


def _clean(data: dict[str, Any]) -> tuple[str, str | None, list[tuple[str, str, float, str]]]:
    name = str(data.get("name") or "").strip()[:80]
    if not name:
        raise ValueError("Bitte einen Namen eingeben")
    meal = data.get("meal") if data.get("meal") in views.MEALS else None
    items = []
    for it in (data.get("items") or [])[:40]:
        food = foods.get(str(it.get("ref") or ""))
        amount = foods._num(it.get("amount"), 0.01, 100000)
        unit = it.get("unit") if it.get("unit") in ("g", "ml", "piece", "serving") else "g"
        if not food or amount is None:
            continue
        views._grams(food, amount, unit)  # prueft, ob die Einheit passt
        items.append((food["ref"], food["name"], amount, unit))
    if not items:
        raise ValueError("Mindestens ein Lebensmittel")
    return name, meal, items


def save(data: dict[str, Any], tid: int | None = None) -> int:
    name, meal, items = _clean(data)
    now = time.time()
    with db.transaction() as c:
        if tid is None:
            tid = c.execute("INSERT INTO templates(name, meal, created, updated) VALUES (?,?,?,?)",
                            (name, meal, now, now)).lastrowid
        else:
            c.execute("UPDATE templates SET name=?, meal=?, updated=? WHERE id=?", (name, meal, now, tid))
            c.execute("DELETE FROM template_items WHERE template_id=?", (tid,))
        c.executemany("INSERT INTO template_items(template_id, position, ref, name, amount, unit) VALUES (?,?,?,?,?,?)",
                      [(tid, k, *it) for k, it in enumerate(items)])
    return tid


def from_entries(day: str, meal: str, name: str) -> int:
    """"Als Mahlzeit speichern" direkt aus einer Mahlzeitenkarte des Tages."""
    rows = db.query("SELECT ref, amount, unit FROM entries WHERE day=? AND meal=? AND deleted IS NULL "
                    "AND ref IS NOT NULL ORDER BY time, id", (day, meal))
    if not rows:
        raise ValueError("Diese Mahlzeit hat keine Lebensmittel (Schnelleinträge zählen nicht)")
    return save({"name": name, "meal": meal,
                 "items": [{"ref": r["ref"], "amount": r["amount"], "unit": r["unit"]}
                           for r in rows]})


def delete(tid: int, undo: bool = False) -> None:
    db.execute("UPDATE templates SET deleted=? WHERE id=?", (None if undo else time.time(), tid))


def log(tid: int, data: dict[str, Any]) -> list[int]:
    """Traegt die Mahlzeit ein. `items` (optional) = angepasste Mengen/Auswahl aus dem Sheet."""
    t = get(tid)
    if not t:
        raise KeyError(tid)
    chosen = data.get("items")
    ids = []
    for k, it in enumerate(t["items"]):
        if isinstance(chosen, list):
            c = next((x for x in chosen if x.get("index") == k), None)
            if not c or not c.get("include", True):
                continue
            amount, unit = c.get("amount", it["amount"]), c.get("unit", it["unit"])
        else:
            amount, unit = it["amount"], it["unit"]
        if not it["available"]:
            continue
        ids.append(views.create_entry({"ref": it["ref"], "amount": amount, "unit": unit, "day": data.get("day"),
                                       "meal": data.get("meal") or t["meal"], "time": data.get("time")}))
    if not ids:
        raise ValueError("Nichts ausgewählt")
    db.execute("UPDATE templates SET used=? WHERE id=?", (time.time(), tid))
    return ids
