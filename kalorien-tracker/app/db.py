"""SQLite fuer die eigenen Daten: Eintraege, eigene Lebensmittel, Rezepte, Einstellungen.

Die grossen Lebensmittel-Datenbanken (BLS, Open Food Facts) liegen getrennt in
`bls.db` und `off.db` (siehe fooddb.py), damit ein Import sie komplett ersetzen
kann, ohne die eigenen Daten anzufassen. Backup = nur `tracker.db`.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = DATA_DIR / "tracker.db"

# Naehrwerte, die pro 100 g und pro Eintrag gespeichert werden
NUTRIENTS = ("kcal", "protein", "carbs", "sugar", "fat", "satfat", "fiber", "salt")
_N_COLS = ", ".join(f"{n} REAL" for n in NUTRIENTS)

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
-- Eigene Lebensmittel, Rezepte und per Barcode live nachgeladene OFF-Produkte
CREATE TABLE IF NOT EXISTS my_foods (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,              -- own | recipe | off
    code TEXT,                       -- Barcode (optional)
    name TEXT NOT NULL,
    brand TEXT,
    quantity TEXT,
    serving_g REAL,
    serving_label TEXT,
    piece_g REAL,
    piece_label TEXT,
    {_N_COLS},
    nutriscore TEXT,
    image TEXT,
    liquid INTEGER NOT NULL DEFAULT 0,
    total_g REAL,                    -- Rezept: Gesamtgewicht nach dem Kochen
    portions REAL,                   -- Rezept: Anzahl Portionen
    created REAL NOT NULL,
    updated REAL NOT NULL,
    deleted REAL
);
CREATE INDEX IF NOT EXISTS idx_my_code ON my_foods(code);
CREATE VIRTUAL TABLE IF NOT EXISTS my_foods_fts USING fts5(
    search, content='', contentless_delete=1, tokenize="trigram remove_diacritics 1"
);
CREATE TABLE IF NOT EXISTS recipe_items (
    id INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    ref TEXT NOT NULL,
    name TEXT NOT NULL,
    grams REAL NOT NULL,
    {_N_COLS}                        -- absolut fuer `grams`
);
CREATE INDEX IF NOT EXISTS idx_recipe_items ON recipe_items(recipe_id);
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    day TEXT NOT NULL,
    meal TEXT NOT NULL,              -- breakfast | lunch | dinner | snack
    time TEXT,                       -- HH:MM
    ref TEXT,                        -- bls:CODE | off:BARCODE | own:ID | NULL (Schnelleintrag)
    name TEXT NOT NULL,
    brand TEXT,
    amount REAL,
    unit TEXT NOT NULL,              -- g | ml | piece | serving | kcal
    grams REAL,
    {_N_COLS},                       -- absolut fuer den Eintrag
    created REAL NOT NULL,
    deleted REAL
);
CREATE INDEX IF NOT EXISTS idx_entries_day ON entries(day);
CREATE INDEX IF NOT EXISTS idx_entries_ref ON entries(ref, created);
CREATE TABLE IF NOT EXISTS favorites (
    ref TEXT PRIMARY KEY,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS water (
    id INTEGER PRIMARY KEY,
    day TEXT NOT NULL,
    time TEXT,
    ml REAL NOT NULL,
    created REAL NOT NULL,
    deleted REAL
);
CREATE INDEX IF NOT EXISTS idx_water_day ON water(day);
-- Gespeicherte Mahlzeiten: feste Kombinationen, die mit einem Tipp eingetragen werden
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    meal TEXT,                       -- vorgeschlagene Mahlzeit (breakfast | lunch | dinner | snack)
    created REAL NOT NULL,
    updated REAL NOT NULL,
    used REAL,                       -- zuletzt eingetragen (Sortierung)
    deleted REAL
);
CREATE TABLE IF NOT EXISTS template_items (
    id INTEGER PRIMARY KEY,
    template_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    ref TEXT NOT NULL,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    unit TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_template_items ON template_items(template_id);
-- Verbrauch aus dem Training-Dashboard (Garmin), lokal gecacht
CREATE TABLE IF NOT EXISTS energy (
    day TEXT PRIMARY KEY,
    total REAL,
    active REAL,
    final INTEGER NOT NULL DEFAULT 0,
    fetched_at REAL NOT NULL
);
"""

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=ON")
        c.executescript(SCHEMA)
        _migrate(c)
        _conn = c
    return _conn


def _migrate(c: sqlite3.Connection) -> None:
    """Spalten, die nach dem ersten Deploy dazukamen."""
    cols = {r[1] for r in c.execute("PRAGMA table_info(water)")}
    if "synced_ml" not in cols:
        # Menge, die bereits in Garmin steht. NULL = aelter als die Garmin-Uebertragung, nie senden.
        c.execute("ALTER TABLE water ADD COLUMN synced_ml REAL")
        c.execute("ALTER TABLE water ADD COLUMN sync_error TEXT")
    if "training_min" not in {r[1] for r in c.execute("PRAGMA table_info(energy)")}:
        c.execute("ALTER TABLE energy ADD COLUMN training_min REAL")


def query(sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
    with _lock:
        return conn().execute(sql, args).fetchall()


def one(sql: str, args: tuple | list = ()) -> sqlite3.Row | None:
    with _lock:
        return conn().execute(sql, args).fetchone()


def execute(sql: str, args: tuple | list = ()) -> int:
    """Fuehrt eine Aenderung aus und gibt die neue rowid zurueck."""
    with _lock:
        cur = conn().execute(sql, args)
        return cur.lastrowid


class transaction:
    """`with db.transaction() as c:` - alles oder nichts."""

    def __enter__(self) -> sqlite3.Connection:
        _lock.acquire()
        conn().execute("BEGIN")
        return conn()

    def __exit__(self, exc_type, exc, tb) -> None:
        try:
            conn().execute("ROLLBACK" if exc_type else "COMMIT")
        finally:
            _lock.release()


# --- Einstellungen -------------------------------------------------------------

DEFAULT_SETTINGS: dict[str, Any] = {
    "goal": "maintain",          # maintain | lose | gain
    "goalOffset": {"maintain": 0, "lose": -300, "gain": 250},
    "weightKg": None,            # None = Garmin-Profilgewicht, sonst 75
    "proteinPerKg": 1.8,
    "fatPerKg": 1.0,
    "fiberGoal": 30,
    "sugarMax": 50,
    "saltMax": 6,
    "waterGoalMl": 2500,
    "waterPerTrainingHour": 500, # ml zusaetzlich pro Stunde Training (Garmin), 0 = aus
    "eveningHint": True,         # ab 17 Uhr: was heute noch offen ist + Vorschlaege
    "fallbackBudget": 2400,      # wenn keine Garmin-Daten da sind
}


def settings() -> dict[str, Any]:
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    for r in query("SELECT key, value FROM settings"):
        out[r["key"]] = json.loads(r["value"])
    return out


def set_settings(values: dict[str, Any]) -> None:
    with transaction() as c:
        for k, v in values.items():
            if k in DEFAULT_SETTINGS:
                c.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?,?)", (k, json.dumps(v)))
