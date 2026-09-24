"""SQLite-Cache fuer alle Garmin-Daten.

Das Dashboard liest ausschliesslich hieraus - Garmin wird nur vom Sync-Dienst
angefasst. Rohdaten werden als JSON abgelegt, damit neue Auswertungen ohne
erneuten Abruf moeglich sind.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = DATA_DIR / "garmin.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS daily (
    kind TEXT NOT NULL,
    day TEXT NOT NULL,
    fetched_at REAL NOT NULL,
    final INTEGER NOT NULL DEFAULT 0,
    data TEXT,
    PRIMARY KEY (kind, day)
);
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY,
    start_local TEXT NOT NULL,
    day TEXT NOT NULL,
    sport TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT,
    detail_fetched_at REAL
);
CREATE INDEX IF NOT EXISTS idx_act_day ON activities(day);
CREATE TABLE IF NOT EXISTS blobs (
    key TEXT PRIMARY KEY,
    fetched_at REAL NOT NULL,
    data TEXT
);
CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(SCHEMA)
    return _conn


def _dumps(data: Any) -> str:
    return json.dumps(data, separators=(",", ":"), default=str)


def _loads(text: str | None) -> Any:
    return json.loads(text) if text else None


# --- daily ------------------------------------------------------------------

def put_daily(kind: str, day: str, data: Any, final: bool) -> None:
    with _lock:
        conn().execute(
            "INSERT OR REPLACE INTO daily(kind, day, fetched_at, final, data) VALUES (?,?,?,?,?)",
            (kind, day, time.time(), int(final), _dumps(data)),
        )
        conn().commit()


def get_daily(kind: str, day: str) -> Any:
    row = conn().execute("SELECT data FROM daily WHERE kind=? AND day=?", (kind, day)).fetchone()
    return _loads(row["data"]) if row else None


def daily_meta(kind: str, day: str) -> sqlite3.Row | None:
    return conn().execute(
        "SELECT fetched_at, final FROM daily WHERE kind=? AND day=?", (kind, day)
    ).fetchone()


def daily_range(kind: str, start: str, end: str) -> dict[str, Any]:
    rows = conn().execute(
        "SELECT day, data FROM daily WHERE kind=? AND day BETWEEN ? AND ? ORDER BY day",
        (kind, start, end),
    ).fetchall()
    return {r["day"]: _loads(r["data"]) for r in rows}


# --- activities -------------------------------------------------------------

def upsert_activity(act_id: int, start_local: str, sport: str, summary: dict) -> bool:
    """Legt eine Aktivitaet an oder aktualisiert die Zusammenfassung.
    Gibt True zurueck, wenn sie neu war."""
    with _lock:
        c = conn()
        exists = c.execute("SELECT 1 FROM activities WHERE id=?", (act_id,)).fetchone()
        if exists:
            c.execute(
                "UPDATE activities SET start_local=?, day=?, sport=?, summary=? WHERE id=?",
                (start_local, start_local[:10], sport, _dumps(summary), act_id),
            )
        else:
            c.execute(
                "INSERT INTO activities(id, start_local, day, sport, summary) VALUES (?,?,?,?,?)",
                (act_id, start_local, start_local[:10], sport, _dumps(summary)),
            )
        c.commit()
        return not exists


def set_activity_detail(act_id: int, detail: dict) -> None:
    with _lock:
        conn().execute(
            "UPDATE activities SET detail=?, detail_fetched_at=? WHERE id=?",
            (_dumps(detail), time.time(), act_id),
        )
        conn().commit()


def activities_without_detail(limit: int) -> list[int]:
    rows = conn().execute(
        "SELECT id FROM activities WHERE detail IS NULL ORDER BY start_local DESC LIMIT ?",
        (limit,),
    ).fetchall()
    return [r["id"] for r in rows]


def activities_between(start: str, end: str, sport: str | None = None) -> list[dict]:
    q = "SELECT id, sport, summary FROM activities WHERE day BETWEEN ? AND ?"
    args: list[Any] = [start, end]
    if sport:
        q += " AND sport=?"
        args.append(sport)
    q += " ORDER BY start_local DESC"
    out = []
    for r in conn().execute(q, args).fetchall():
        s = _loads(r["summary"])
        s["_sport"] = r["sport"]
        out.append(s)
    return out


def activity(act_id: int) -> tuple[dict, dict | None] | None:
    row = conn().execute(
        "SELECT sport, summary, detail FROM activities WHERE id=?", (act_id,)
    ).fetchone()
    if not row:
        return None
    s = _loads(row["summary"])
    s["_sport"] = row["sport"]
    return s, _loads(row["detail"])


def activity_count() -> int:
    return conn().execute("SELECT COUNT(*) FROM activities").fetchone()[0]


# --- blobs & state ------------------------------------------------------------

def put_blob(key: str, data: Any) -> None:
    with _lock:
        conn().execute(
            "INSERT OR REPLACE INTO blobs(key, fetched_at, data) VALUES (?,?,?)",
            (key, time.time(), _dumps(data)),
        )
        conn().commit()


def get_blob(key: str) -> Any:
    row = conn().execute("SELECT data FROM blobs WHERE key=?", (key,)).fetchone()
    return _loads(row["data"]) if row else None


def get_state(key: str, default: Any = None) -> Any:
    row = conn().execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
    return _loads(row["value"]) if row else default


def set_state(key: str, value: Any) -> None:
    with _lock:
        conn().execute(
            "INSERT OR REPLACE INTO state(key, value) VALUES (?,?)", (key, _dumps(value))
        )
        conn().commit()
