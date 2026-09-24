"""Lebensmittel-Datenbanken aus Importen: `bls.db` (BLS 4.0) und `off.db` (Open Food Facts).

Jede Datei wird komplett neu gebaut (`*.db.tmp`) und dann atomar ersetzt. Die App
merkt das am geaenderten Inode/mtime und oeffnet neu.

Kompaktes Format (halbiert off.db von 82 auf ~45 MB):
- Naehrwerte als Ganzzahl in Hundertstel-Gramm (13,2 g -> 1320, 1-2 Byte statt 8), kcal ganzzahlig.
- Bild nur als Schluessel ("de.123"), die URL wird beim Lesen aus Barcode + Schluessel gebaut.
- Suchtext = Name zusammengeschrieben + Marke (Trigram findet auch Wortteile).
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

from .db import DATA_DIR, NUTRIENTS

SOURCES = ("bls", "off")

SCHEMA = f"""
CREATE TABLE foods (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    brand TEXT,
    quantity TEXT,
    serving_g REAL,
    serving_label TEXT,
    piece_g REAL,
    piece_label TEXT,
    {", ".join(f"{n} INTEGER" for n in NUTRIENTS)},   -- kcal ganz, Rest in 1/100 g
    nutriscore TEXT,
    image TEXT,                                          -- OFF-Bildschluessel, z. B. "de.123"
    liquid INTEGER NOT NULL DEFAULT 0,
    popularity INTEGER NOT NULL DEFAULT 0
);
CREATE VIRTUAL TABLE foods_fts USING fts5(
    search, content='', tokenize="trigram remove_diacritics 1"
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""

FOOD_COLS = ("code", "name", "brand", "quantity", "serving_g", "serving_label", "piece_g",
             "piece_label", *NUTRIENTS, "nutriscore", "image", "liquid", "popularity")


def path(source: str) -> Path:
    return DATA_DIR / f"{source}.db"


def search_text(name: str, brand: str | None = None) -> str:
    """Suchtext fuer den Trigram-Index: Name zusammengeschrieben (findet "haferflocken"
    auch bei "Hafer Flocken" und jedes Einzelwort als Teilstring) plus Marke."""
    joined = re.sub(r"[\s\-/,]+", "", name)
    return f"{joined} {brand}" if brand else joined


def encode(item: dict[str, Any]) -> dict[str, Any]:
    """Naehrwerte pro 100 g -> kompakte Ganzzahlen."""
    out = dict(item)
    for n in NUTRIENTS:
        v = item.get(n)
        out[n] = None if v is None else int(round(v)) if n == "kcal" else int(round(v * 100))
    return out


def decode(row: sqlite3.Row) -> dict[str, Any]:
    """Zeile aus bls.db/off.db -> Naehrwerte in g, Bild-URL."""
    r = dict(row)
    for n in NUTRIENTS:
        if r.get(n) is not None and n != "kcal":
            r[n] = r[n] / 100
    if r.get("image"):
        from .off import image_url  # spaet importieren, off.py importiert nichts von hier
        key, _, rev = r["image"].rpartition(".")
        r["image"] = image_url(r["code"], f"front_{key}", rev)
    return r


# --- Import-Seite -------------------------------------------------------------

class Builder:
    """Baut eine neue Datenbank in `<source>.db.tmp` und ersetzt am Ende atomar."""

    def __init__(self, source: str):
        self.source = source
        self.final = path(source)
        self.tmp = self.final.with_suffix(".db.tmp")
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        for p in (self.tmp, Path(f"{self.tmp}-wal"), Path(f"{self.tmp}-shm")):
            p.unlink(missing_ok=True)
        self.c = sqlite3.connect(self.tmp)
        self.c.execute("PRAGMA journal_mode=OFF")
        self.c.execute("PRAGMA synchronous=OFF")
        self.c.execute("PRAGMA cache_size=-32000")  # 32 MB, schont den RAM des Pi
        self.c.executescript(SCHEMA)
        self.count = 0
        self._seen: set[str] = set()

    def add_many(self, rows: Iterable[dict[str, Any]]) -> None:
        batch = []
        for r in rows:
            if r["code"] in self._seen:
                continue
            self._seen.add(r["code"])
            r = encode(r)
            batch.append(tuple(r.get(k) for k in FOOD_COLS))
        if not batch:
            return
        self.c.executemany(
            f"INSERT INTO foods({', '.join(FOOD_COLS)}) VALUES ({', '.join('?' * len(FOOD_COLS))})", batch
        )
        self.count += len(batch)

    def finish(self, meta: dict[str, str]) -> int:
        # FTS erst am Ende befuellen: schneller und ohne Fragmentierung
        rows = self.c.cursor().execute("SELECT id, name, brand FROM foods")
        self.c.executemany("INSERT INTO foods_fts(rowid, search) VALUES (?, ?)",
                           ((rowid, search_text(name, brand)) for rowid, name, brand in rows))
        self.c.execute("INSERT INTO foods_fts(foods_fts) VALUES ('optimize')")
        meta = {**meta, "count": str(self.count), "imported_at": str(int(time.time()))}
        self.c.executemany("INSERT INTO meta(key, value) VALUES (?, ?)", meta.items())
        self.c.commit()
        self.c.execute("VACUUM")
        self.c.close()
        os.replace(self.tmp, self.final)
        return self.count

    def abort(self) -> None:
        self.c.close()
        self.tmp.unlink(missing_ok=True)


# --- Lese-Seite -----------------------------------------------------------------

_lock = threading.Lock()
_open: dict[str, tuple[tuple[int, float], sqlite3.Connection]] = {}


def _conn(source: str) -> sqlite3.Connection | None:
    p = path(source)
    try:
        st = p.stat()
    except FileNotFoundError:
        return None
    key = (st.st_ino, st.st_mtime)
    with _lock:
        cur = _open.get(source)
        if cur and cur[0] == key:
            return cur[1]
        if cur:
            cur[1].close()
        c = sqlite3.connect(f"file:{p}?mode=ro", uri=True, check_same_thread=False)
        c.row_factory = sqlite3.Row
        _open[source] = (key, c)
        return c


def meta(source: str) -> dict[str, str] | None:
    c = _conn(source)
    if not c:
        return None
    return {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM meta")}


def get(source: str, code: str) -> dict[str, Any] | None:
    c = _conn(source)
    if not c:
        return None
    with _lock:
        row = c.execute("SELECT * FROM foods WHERE code=?", (code,)).fetchone()
    return decode(row) if row else None


def fts_query(tokens: list[str]) -> str | None:
    """FTS5-Ausdruck aus Suchwoertern; Trigram braucht mind. 3 Zeichen."""
    long = [t for t in tokens if len(t) >= 3]
    if not long:
        return None
    return " AND ".join('"' + t.replace('"', "") + '"' for t in long)


def candidates(source: str, tokens: list[str], limit: int = 250) -> list[dict[str, Any]]:
    return [decode(r) for r in _candidates(source, tokens, limit)]


def _candidates(source: str, tokens: list[str], limit: int) -> list[sqlite3.Row]:
    c = _conn(source)
    if not c:
        return []
    q = fts_query(tokens)
    with _lock:
        if q:
            return c.execute(
                "SELECT f.* FROM foods_fts JOIN foods f ON f.id = foods_fts.rowid "
                "WHERE foods_fts MATCH ? ORDER BY foods_fts.rank LIMIT ?", (q, limit)
            ).fetchall()
        if source == "bls" and tokens:
            # Sehr kurze Eingaben (z. B. "Ei"): Wortanfang, nur im kleinen BLS
            return c.execute(
                "SELECT * FROM foods WHERE name LIKE ? OR name LIKE ? LIMIT ?",
                (f"{tokens[0]}%", f"% {tokens[0]}%", limit),
            ).fetchall()
    return []
