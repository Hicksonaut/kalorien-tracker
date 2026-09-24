"""Zweite Produkt-Datenbank: selbst erfasste Produkte (`data/captured.db`).

off.db ist ein fester Stand. Alles, was dort fehlt oder falsch ist, wird hier erfasst:
- "Neues Produkt hinzufuegen" (mit oder ohne Barcode, Naehrwerte wie auf der Verpackung),
- Produkte, die per Barcode live von Open Food Facts geholt wurden (source 'off-live'),
- Korrekturen: ein Barcode, der auch in off.db steht, hat hier Vorrang.

Referenz im Rest der App: `cap:<id>`. Die Datei gehoert zum Backup (wie tracker.db).
"""

from __future__ import annotations

import sqlite3
import threading
import time
from typing import Any

from . import db
from .db import DATA_DIR, NUTRIENTS

DB_PATH = DATA_DIR / "captured.db"
SOURCES = ("own", "off-live")

COLS = ("code", "name", "brand", "quantity", "serving_g", "serving_label", "piece_g", "piece_label",
        *NUTRIENTS, "nutriscore", "image", "liquid", "source")

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    code TEXT,                          -- Barcode, optional (selbstgemachtes hat keinen)
    name TEXT NOT NULL,
    brand TEXT,
    quantity TEXT,                      -- Packungsgroesse, z. B. "500 g"
    serving_g REAL,
    serving_label TEXT,
    piece_g REAL,
    piece_label TEXT,
    {", ".join(f"{n} REAL" for n in NUTRIENTS)},   -- pro 100 g bzw. 100 ml
    nutriscore TEXT,
    image TEXT,
    liquid INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'own', -- own | off-live
    created REAL NOT NULL,
    updated REAL NOT NULL,
    deleted REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code ON products(code) WHERE code IS NOT NULL AND deleted IS NULL;
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
    search, content='', contentless_delete=1, tokenize="trigram remove_diacritics 1"
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
        c.executescript(SCHEMA)
        _conn = c
        _migrate_from_tracker()
    return _conn


def query(sql: str, args: tuple | list = ()) -> list[sqlite3.Row]:
    with _lock:
        return conn().execute(sql, args).fetchall()


def one(sql: str, args: tuple | list = ()) -> sqlite3.Row | None:
    with _lock:
        return conn().execute(sql, args).fetchone()


def _index(c: sqlite3.Connection, pid: int, name: str, brand: str | None) -> None:
    from .fooddb import search_text
    c.execute("DELETE FROM products_fts WHERE rowid=?", (pid,))
    c.execute("INSERT INTO products_fts(rowid, search) VALUES (?, ?)", (pid, search_text(name, brand)))


def by_code(code: str) -> sqlite3.Row | None:
    return one("SELECT * FROM products WHERE code=? AND deleted IS NULL", (code,))


def save(item: dict[str, Any], pid: int | None = None) -> int:
    """Legt ein Produkt an oder aendert es. `item` ist bereits geprueft (foods.clean_food)."""
    item = {**item, "source": item.get("source") if item.get("source") in SOURCES else "own"}
    now = time.time()
    with _lock:
        c = conn()
        if item.get("code"):
            other = c.execute("SELECT id, name FROM products WHERE code=? AND deleted IS NULL", (item["code"],)).fetchone()
            if other and other["id"] != pid:
                raise ValueError(f"Barcode {item['code']} ist schon erfasst: {other['name']}")
        c.execute("BEGIN")
        try:
            if pid is None:
                cur = c.execute(
                    f"INSERT INTO products({', '.join(COLS)}, created, updated) VALUES ({', '.join('?' * len(COLS))}, ?, ?)",
                    (*[item.get(k) for k in COLS], now, now))
                pid = cur.lastrowid
            else:
                c.execute(f"UPDATE products SET {', '.join(f'{k}=?' for k in COLS)}, updated=? WHERE id=?",
                          (*[item.get(k) for k in COLS], now, pid))
            _index(c, pid, item["name"], item.get("brand"))
            c.execute("COMMIT")
        except BaseException:
            c.execute("ROLLBACK")
            raise
    return pid


def delete(pid: int, undo: bool = False) -> None:
    with _lock:
        c = conn()
        if undo:
            row = c.execute("SELECT code FROM products WHERE id=?", (pid,)).fetchone()
            if row and row["code"] and c.execute("SELECT 1 FROM products WHERE code=? AND deleted IS NULL AND id<>?",
                                                 (row["code"], pid)).fetchone():
                raise ValueError("Der Barcode wurde inzwischen neu erfasst")
        c.execute("UPDATE products SET deleted=? WHERE id=?", (None if undo else time.time(), pid))


def search(fts: str | None, like: str, limit: int = 60) -> list[sqlite3.Row]:
    if fts:
        return query("SELECT p.* FROM products_fts JOIN products p ON p.id = products_fts.rowid "
                     "WHERE products_fts MATCH ? AND p.deleted IS NULL LIMIT ?", (fts, limit))
    return query("SELECT * FROM products WHERE deleted IS NULL AND name LIKE ? LIMIT ?", (f"%{like}%", limit))


def all_products() -> list[sqlite3.Row]:
    return query("SELECT * FROM products WHERE deleted IS NULL ORDER BY source='off-live', name COLLATE NOCASE")


def count() -> dict[str, int]:
    return {r["source"]: r["n"] for r in query("SELECT source, COUNT(*) n FROM products WHERE deleted IS NULL GROUP BY source")}


# --- Einmalige Uebernahme aus tracker.db (bis 24.09.2026 lagen eigene Produkte dort) ---------------

def _migrate_from_tracker() -> None:
    """Eigene und live geholte Produkte aus tracker.db.my_foods hierher verschieben
    und alle Referenzen own:<alt> -> cap:<neu> umschreiben. Idempotent."""
    old = db.query("SELECT * FROM my_foods WHERE kind IN ('own', 'off') AND deleted IS NULL")
    if not old:
        return
    mapping = {}
    for r in old:
        item = {k: r[k] for k in COLS if k in r.keys()}
        item["source"] = "off-live" if r["kind"] == "off" else "own"
        if item.get("code") and by_code(item["code"]):
            item["code"] = None  # Dublette: Barcode bleibt beim schon erfassten Produkt
        mapping[f"own:{r['id']}"] = f"cap:{save(item)}"
    with db.transaction() as c:
        for old_ref, new_ref in mapping.items():
            c.execute("UPDATE entries SET ref=? WHERE ref=?", (new_ref, old_ref))
            c.execute("UPDATE recipe_items SET ref=? WHERE ref=?", (new_ref, old_ref))
            c.execute("UPDATE OR REPLACE favorites SET ref=? WHERE ref=?", (new_ref, old_ref))
            c.execute("UPDATE my_foods SET deleted=?, kind=kind || '-migrated' WHERE id=?",
                      (time.time(), int(old_ref.split(":")[1])))
