"""Fuellt eine leere Datenbank mit Beispieldaten (14 Tage), z. B. zum Ausprobieren oder fuer Screenshots.

Nutzt nur den BLS (data/bls.db muss existieren), dazu simulierten Garmin-Verbrauch.
Nie auf eine echte Datenbank anwenden - das Skript bricht ab, wenn schon Eintraege da sind.

    DATA_DIR=./data/demo ./.venv/bin/python -m app.import_bls        # einmalig
    DATA_DIR=./data/demo ./.venv/bin/python scripts/demo_data.py
    DATA_DIR=./data/demo AUTH_ENABLED=0 ./.venv/bin/python -m uvicorn app.main:app --port 4320
"""

from __future__ import annotations

import random
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import captured, db, foods, templates, views  # noqa: E402

random.seed(7)


def ref(q: str) -> str:
    r = foods.search(q)
    if not r:
        raise SystemExit(f"Nicht im BLS gefunden: {q} (bls.db importiert?)")
    return r[0]["ref"]


def main() -> None:
    if db.one("SELECT COUNT(*) n FROM entries")["n"]:
        raise SystemExit("Datenbank enthaelt schon Eintraege - Demo-Daten nur in ein leeres DATA_DIR schreiben.")
    R = {k: ref(q) for k, q in {
        "oats": "haferflocken", "milk": "vollmilch", "banana": "banane", "apple": "apfel", "egg": "ei",
        "bread": "vollkornbrot", "quark": "magerquark", "rice": "reis gekocht", "chicken": "hähnchenbrustfilet gebraten",
        "broccoli": "broccoli gedünstet", "pasta": "teigwaren eifrei gekocht", "salmon": "lachssteaks gebraten",
        "potato": "kartoffel geschält gekocht", "yogurt": "joghurt", "nuts": "walnuss", "cheese": "gouda 48",
    }.items()}
    week = [
        {"breakfast": [("oats", 80, "g"), ("milk", 250, "ml"), ("banana", 1, "piece")],
         "lunch": [("rice", 250, "g"), ("chicken", 150, "g"), ("broccoli", 200, "g")],
         "dinner": [("bread", 2, "piece"), ("cheese", 40, "g"), ("quark", 250, "g")],
         "snack": [("apple", 1, "piece"), ("nuts", 25, "g")]},
        {"breakfast": [("yogurt", 250, "g"), ("oats", 50, "g"), ("apple", 1, "piece")],
         "lunch": [("pasta", 300, "g"), ("salmon", 125, "g")],
         "dinner": [("potato", 300, "g"), ("egg", 2, "piece"), ("broccoli", 150, "g")],
         "snack": [("banana", 1, "piece"), ("quark", 150, "g")]},
    ]
    today = date.today()
    for k in range(13, -1, -1):
        d = today - timedelta(days=k)
        if k == 9:
            continue  # ein Tag ohne Eintraege
        plan = week[k % 2]
        for meal, items in plan.items():
            if k == 0 and meal in ("dinner", "snack"):
                continue  # heute ist noch nicht vorbei
            tm = {"breakfast": "07:15", "lunch": "12:40", "dinner": "19:00", "snack": "16:10"}[meal]
            for key, amount, unit in items:
                a = round(amount * random.uniform(0.85, 1.2)) if unit in ("g", "ml") else amount
                views.create_entry({"day": d.isoformat(), "meal": meal, "ref": R[key], "amount": a, "unit": unit, "time": tm})
        for _ in range(random.randint(5, 10)):
            db.execute("INSERT INTO water(day, time, ml, created) VALUES (?,?,?,?)", (d.isoformat(), "12:00", 250, time.time()))
    # Simulierter Garmin-Verbrauch (Ruheumsatz ~2.050 + Training)
    with db.transaction() as c:
        for k in range(1, 30):
            d = today - timedelta(days=k)
            active = random.choice([30, 60, 420, 80, 610, 40, 350])
            c.execute("INSERT OR REPLACE INTO energy(day, total, active, final, fetched_at, training_min) VALUES (?,?,?,?,?,?)",
                      (d.isoformat(), 2050 + active, active, 1, time.time(), active / 8 if active > 200 else 0))
        c.execute("INSERT OR REPLACE INTO energy(day, total, active, final, fetched_at, training_min) VALUES (?,?,?,?,?,?)",
                  (today.isoformat(), 1500, 480, 0, time.time(), 60))
    foods.set_favorite(R["quark"], True)
    foods.set_favorite(R["oats"], True)
    templates.save({"name": "Haferflocken-Frühstück", "meal": "breakfast",
                    "items": [{"ref": R["oats"], "amount": 80, "unit": "g"}, {"ref": R["milk"], "amount": 250, "unit": "ml"},
                              {"ref": R["banana"], "amount": 1, "unit": "piece"}]})
    templates.save({"name": "Reis mit Hähnchen", "meal": "lunch",
                    "items": [{"ref": R["rice"], "amount": 250, "unit": "g"}, {"ref": R["chicken"], "amount": 150, "unit": "g"},
                              {"ref": R["broccoli"], "amount": 200, "unit": "g"}]})
    templates.save({"name": "Quark-Snack", "meal": "snack",
                    "items": [{"ref": R["quark"], "amount": 250, "unit": "g"}, {"ref": R["banana"], "amount": 1, "unit": "piece"}]})
    foods.save_recipe({"name": "Linsen-Bolognese", "portions": 4, "total_g": 1600,
                       "items": [{"ref": R["pasta"], "grams": 500}, {"ref": ref("linse reif gekocht"), "grams": 400},
                                 {"ref": ref("tomate roh"), "grams": 600}]})
    captured.save({**foods.clean_food({"name": "Proteinriegel Schoko", "brand": "Beispielmarke", "code": "4000000000017",
                                       "per100": {"kcal": 362, "protein": 33, "carbs": 30, "sugar": 3, "fat": 11, "satfat": 6,
                                                  "fiber": 12, "salt": 0.4}, "serving_g": 45, "serving_label": "1 Riegel"})})
    print("Demo-Daten angelegt:", db.one("SELECT COUNT(*) n FROM entries")["n"], "Eintraege,", datetime.now().strftime("%H:%M"))


if __name__ == "__main__":
    main()
