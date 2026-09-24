"""Lebensmittel: Suche ueber alle Quellen, Details, eigene Produkte, Rezepte, Barcode.

Quellen und stabile Referenzen:
    cap:<id>         captured.db - selbst erfasste und live von OFF geholte Produkte (Vorrang)
    own:<id>         tracker.db  - Rezepte
    bls:<BLS-Code>   bls.db      - Grundnahrungsmittel
    off:<Barcode>    off.db      - Markenprodukte (fester Stand)
"""

from __future__ import annotations

import math
import re
import time
from typing import Any

from . import captured, db, fooddb, off
from .db import NUTRIENTS

KIND_LABEL = {"cap": "Eigenes Produkt", "recipe": "Rezept", "off": "Open Food Facts"}


def tokens(q: str) -> list[str]:
    return re.findall(r"[0-9a-zäöüß]+", q.lower())


def to_food(row: Any, source: str) -> dict[str, Any]:
    """Einheitliches Format fuer das Frontend."""
    r = dict(row)
    if source == "cap":
        # live von OFF geholte Produkte behalten das OFF-Symbol, sind aber hier gespeichert
        ref, kind = f"cap:{r['id']}", "off" if r.get("source") == "off-live" else "cap"
    elif source == "own":
        ref, kind = f"own:{r['id']}", r["kind"]
    else:
        ref, kind = f"{source}:{r['code']}", source
    return {
        "ref": ref,
        "kind": kind,
        "name": r["name"],
        "brand": r.get("brand"),
        "code": r.get("code"),
        "quantity": r.get("quantity"),
        "liquid": bool(r.get("liquid")),
        "per100": {n: r.get(n) for n in NUTRIENTS},
        "serving": {"g": r["serving_g"], "label": r.get("serving_label") or "Portion"} if r.get("serving_g") else None,
        "piece": {"g": r["piece_g"], "label": r.get("piece_label") or "Stück"} if r.get("piece_g") else None,
        "nutriscore": r.get("nutriscore"),
        "image": r.get("image"),
        "totalG": r.get("total_g"),
        "portions": r.get("portions"),
        "_pop": r.get("popularity") or 0,
    }


# --- Suche ------------------------------------------------------------------------

# Kurze Alltagswoerter, die im BLS anders heissen
SYNONYMS = {"ei": "hühnerei", "eier": "hühnerei", "kaffee": "kaffee getränk", "wasser": "trinkwasser",
            "haferflocken": "hafer flocken", "quark": "speisequark", "magerquark": "speisequark magerstufe"}


def _score(f: dict[str, Any], toks: list[str], boost: dict[str, float]) -> float:
    name = f["name"].lower()
    joined = re.sub(r"[\s\-/,]+", "", name)
    brand = (f.get("brand") or "").lower()
    s = boost.get(f["ref"], 0.0)
    first = toks[0]
    words = re.split(r"[\s,(/]+", name)
    # Ganzes erstes Wort oder genau die ersten zwei Woerter zusammengeschrieben ("Hähnchen Brust")
    if words[0] == first or "".join(words[:2]) == first:
        s += 44                      # "Milch fettarm" vor "Milchschokolade", "Hähnchen Brust" fuer "hähnchenbrust"
    elif name.startswith(first) or joined.startswith(first):
        s += 30
    elif re.search(r"(^|[\s,(/-])" + re.escape(first), name):
        s += 16
    for t in toks:
        if t in name or t in joined:
            s += 6
        elif t in brand:
            s += 3
    # Laengenstrafe nur fuer den Kern des Namens (BLS haengt Details nach dem Komma an)
    s -= min(len(name.split(",")[0]), 80) * 0.25
    if f["kind"] == "bls":
        s += 20                      # Grundnahrungsmittel vor gleichnamigen Markenprodukten
        if re.search(r"\broh\b|\bgekocht\b|\bnatur\b", name):
            s += 3
    elif f["ref"].startswith("off:"):
        s += min(14, math.log2(f["_pop"] + 1) * 2.2)
    else:  # eigene Produkte und Rezepte zuerst
        s += 28
    return s


def _my_candidates(toks: list[str], limit: int = 60) -> list[dict[str, Any]]:
    """Eigene Produkte (captured.db) und Rezepte (tracker.db)."""
    q = fooddb.fts_query(toks)
    if q:
        rows = db.query(
            "SELECT m.* FROM my_foods_fts JOIN my_foods m ON m.id = my_foods_fts.rowid "
            "WHERE my_foods_fts MATCH ? AND m.deleted IS NULL AND m.kind='recipe' LIMIT ?", (q, limit))
    else:
        rows = db.query("SELECT * FROM my_foods WHERE deleted IS NULL AND kind='recipe' AND name LIKE ? LIMIT ?",
                        (f"%{toks[0]}%", limit))
    return [to_food(r, "own") for r in rows] + [to_food(r, "cap") for r in captured.search(q, toks[0], limit)]


def usage_boost() -> dict[str, float]:
    """Favoriten und oft Gegessenes steigen in der Suche nach oben."""
    boost: dict[str, float] = {}
    for r in db.query("SELECT ref, COUNT(*) n FROM entries WHERE ref IS NOT NULL AND deleted IS NULL "
                      "AND created > ? GROUP BY ref", (time.time() - 120 * 86400,)):
        boost[r["ref"]] = min(24, 8 + 4 * math.log2(r["n"]))
    for r in db.query("SELECT ref FROM favorites"):
        boost[r["ref"]] = boost.get(r["ref"], 0) + 18
    return boost


def search(q: str, limit: int = 30) -> list[dict[str, Any]]:
    toks = tokens(q)
    if not toks:
        return []
    variants = [toks]
    syn = SYNONYMS.get(" ".join(toks))
    if syn and tokens(syn) != toks:
        variants.append(tokens(syn))
    seen: dict[str, dict[str, Any]] = {}
    for v in variants:
        for f in _my_candidates(v) + [to_food(r, src) for src in fooddb.SOURCES for r in fooddb.candidates(src, v)]:
            seen.setdefault(f["ref"], f)
    boost = usage_boost()
    ranked = sorted(seen.values(), key=lambda f: max(_score(f, v, boost) for v in variants), reverse=True)
    # Gleiches Produkt (Name + Marke) aus OFF nur einmal - das beliebteste steht schon vorne
    out, dupes = [], set()
    for f in ranked:
        key = (f["name"].lower(), (f.get("brand") or "").lower())
        if f["kind"] == "off" and key in dupes:
            continue
        dupes.add(key)
        out.append(_public(f))
        if len(out) >= limit:
            break
    return out


def _public(f: dict[str, Any]) -> dict[str, Any]:
    f = dict(f)
    f.pop("_pop", None)
    return f


# --- Einzelabruf ---------------------------------------------------------------------

def get(ref: str) -> dict[str, Any] | None:
    src, _, key = ref.partition(":")
    if src == "cap":
        row = captured.one("SELECT * FROM products WHERE id=?", (int(key) if key.isdigit() else -1,))
        if not row:
            return None
        food = _public(to_food(row, "cap"))
        food["deleted"] = bool(row["deleted"])
        food["overridesOff"] = bool(row["code"] and fooddb.get("off", row["code"]))
        return food
    if src == "own":
        row = db.one("SELECT * FROM my_foods WHERE id=?", (int(key) if key.isdigit() else -1,))
        if not row:
            return None
        food = _public(to_food(row, "own"))
        food["deleted"] = bool(row["deleted"])
        if row["kind"] == "recipe":
            food["items"] = [dict(r) for r in db.query(
                "SELECT ref, name, grams FROM recipe_items WHERE recipe_id=? ORDER BY position", (row["id"],))]
        return food
    if src in fooddb.SOURCES:
        row = fooddb.get(src, key)
        return _public(to_food(row, src)) if row else None
    return None


def by_barcode(code: str, live: bool = True) -> dict[str, Any]:
    """Reihenfolge: eigene Produkte (captured.db) -> off.db -> einmal live bei OFF."""
    variants = off.code_variants(code)
    if not variants:
        return {"status": "invalid"}
    for c in variants:
        row = captured.by_code(c)
        if row:
            return {"status": "ok", "food": get(f"cap:{row['id']}")}
    for c in variants:
        row = fooddb.get("off", c)
        if row:
            return {"status": "ok", "food": _public(to_food(row, "off"))}
    if not live:
        return {"status": "unknown", "code": variants[0]}
    try:
        item = off.fetch_live(variants[0])
        if item is None and len(variants) > 1:
            item = off.fetch_live(variants[1])
    except off.RateLimited:
        return {"status": "rate_limited", "code": variants[0]}
    except Exception as e:  # Netzwerk, OFF gestoert
        return {"status": "offline", "code": variants[0], "detail": str(e)[:120]}
    if item is None:
        return {"status": "unknown", "code": variants[0]}
    pid = captured.save({**clean_food(item), "source": "off-live"})
    return {"status": "ok", "food": get(f"cap:{pid}"), "live": True}


# --- Eigene Produkte & Rezepte ---------------------------------------------------------------

MY_COLS = ("kind", "code", "name", "brand", "quantity", "serving_g", "serving_label", "piece_g", "piece_label",
           *NUTRIENTS, "nutriscore", "image", "liquid", "total_g", "portions")


def _num(v: Any, lo: float = 0, hi: float = 100000) -> float | None:
    if v in (None, ""):
        return None
    try:
        f = float(str(v).replace(",", "."))
    except ValueError:
        return None
    return f if lo <= f <= hi else None


def clean_food(data: dict[str, Any]) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()[:160]
    if not name:
        raise ValueError("Name fehlt")
    per100 = data.get("per100") or data
    out: dict[str, Any] = {
        "kind": data.get("kind") if data.get("kind") in ("own", "recipe", "off") else "own",
        "code": re.sub(r"\D", "", str(data.get("code") or "")) or None,
        "name": name,
        "brand": (str(data.get("brand") or "").strip()[:80] or None),
        "quantity": (str(data.get("quantity") or "").strip()[:40] or None),
        "nutriscore": data.get("nutriscore") if data.get("nutriscore") in ("a", "b", "c", "d", "e") else None,
        "image": data.get("image") if str(data.get("image") or "").startswith(off.IMG_BASE[:36]) else None,
        "liquid": 1 if data.get("liquid") else 0,
        "total_g": _num(data.get("total_g"), 1, 100000),
        "portions": _num(data.get("portions"), 0.1, 1000),
    }
    for n in NUTRIENTS:
        out[n] = _num(per100.get(n), 0, 950 if n == "kcal" else 100)
    if out["kcal"] is None:
        raise ValueError("kcal pro 100 g fehlt")
    sv = data.get("serving") or {}
    out["serving_g"] = _num(data.get("serving_g", sv.get("g")), 0.1, 5000)
    out["serving_label"] = (str(data.get("serving_label", sv.get("label")) or "").strip()[:40] or None) if out["serving_g"] else None
    pc = data.get("piece") or {}
    out["piece_g"] = _num(data.get("piece_g", pc.get("g")), 0.1, 5000)
    out["piece_label"] = (str(data.get("piece_label", pc.get("label")) or "").strip()[:40] or None) if out["piece_g"] else None
    return out


def _index(c, fid: int, name: str, brand: str | None) -> None:
    c.execute("DELETE FROM my_foods_fts WHERE rowid=?", (fid,))
    c.execute("INSERT INTO my_foods_fts(rowid, search) VALUES (?, ?)", (fid, fooddb.search_text(name, brand)))


def save_product(data: dict[str, Any], pid: int | None = None) -> str:
    """Neues oder geaendertes eigenes Produkt in captured.db. Gibt die Referenz zurueck."""
    item = clean_food(data)
    if pid is not None:
        old = captured.one("SELECT source FROM products WHERE id=?", (pid,))
        if not old:
            raise ValueError("Produkt nicht gefunden")
        item["source"] = "own"   # einmal bearbeitet = eigene Angabe
    return f"cap:{captured.save(item, pid)}"


def delete_ref(ref: str, undo: bool = False) -> None:
    src, _, key = ref.partition(":")
    if not key.isdigit():
        raise ValueError("Unbekannte Referenz")
    if src == "cap":
        captured.delete(int(key), undo)
    elif src == "own":
        db.execute("UPDATE my_foods SET deleted=? WHERE id=? AND kind='recipe'", (None if undo else time.time(), int(key)))
    else:
        raise ValueError("Nur eigene Produkte und Rezepte lassen sich löschen")


def _save_recipe_row(data: dict[str, Any], fid: int | None = None) -> int:
    f = clean_food(data)
    now = time.time()
    with db.transaction() as c:
        if fid is None:
            cur = c.execute(
                f"INSERT INTO my_foods({', '.join(MY_COLS)}, created, updated) VALUES ({', '.join('?' * len(MY_COLS))}, ?, ?)",
                (*[f[k] for k in MY_COLS], now, now))
            fid = cur.lastrowid
        else:
            c.execute(f"UPDATE my_foods SET {', '.join(f'{k}=?' for k in MY_COLS)}, updated=? WHERE id=?",
                      (*[f[k] for k in MY_COLS], now, fid))
        _index(c, fid, f["name"], f["brand"])
    return fid


def save_recipe(data: dict[str, Any], fid: int | None = None) -> int:
    """Rezept aus Zutaten: Naehrwerte pro 100 g = Summe / Gesamtgewicht."""
    items = []
    for it in (data.get("items") or [])[:60]:
        food = get(str(it.get("ref") or ""))
        grams = _num(it.get("grams"), 0.1, 20000)
        if not food or not grams:
            continue
        items.append({"ref": food["ref"], "name": food["name"], "grams": grams,
                      **{n: (food["per100"][n] or 0) * grams / 100 if food["per100"][n] is not None else None for n in NUTRIENTS}})
    if not items:
        raise ValueError("Mindestens eine Zutat")
    raw = sum(i["grams"] for i in items)
    total = _num(data.get("total_g"), 1, 100000) or raw  # Gewicht nach dem Kochen
    portions = _num(data.get("portions"), 0.1, 1000)
    per100 = {}
    for n in NUTRIENTS:
        vals = [i[n] for i in items if i[n] is not None]
        per100[n] = sum(vals) / total * 100 if vals else None
    fid = _save_recipe_row({
        "kind": "recipe", "name": data.get("name"), "per100": per100, "total_g": total, "portions": portions,
        "serving_g": total / portions if portions else None, "serving_label": "Portion" if portions else None,
        "liquid": data.get("liquid"),
    }, fid)
    with db.transaction() as c:
        c.execute("DELETE FROM recipe_items WHERE recipe_id=?", (fid,))
        c.executemany(
            f"INSERT INTO recipe_items(recipe_id, position, ref, name, grams, {', '.join(NUTRIENTS)}) "
            f"VALUES (?,?,?,?,?,{', '.join('?' * len(NUTRIENTS))})",
            [(fid, k, i["ref"], i["name"], i["grams"], *[i[n] for n in NUTRIENTS]) for k, i in enumerate(items)])
    return fid


def recipes() -> list[dict[str, Any]]:
    return [_public(to_food(r, "own")) for r in db.query(
        "SELECT * FROM my_foods WHERE deleted IS NULL AND kind='recipe' ORDER BY name COLLATE NOCASE")]


def products() -> list[dict[str, Any]]:
    return [_public(to_food(r, "cap")) for r in captured.all_products()]


# --- Favoriten & zuletzt verwendet ------------------------------------------------------

def set_favorite(ref: str, on: bool) -> None:
    if on:
        db.execute("INSERT OR IGNORE INTO favorites(ref, created) VALUES (?, ?)", (ref, time.time()))
    else:
        db.execute("DELETE FROM favorites WHERE ref=?", (ref,))


def is_favorite(ref: str) -> bool:
    return db.one("SELECT 1 FROM favorites WHERE ref=?", (ref,)) is not None


def favorites() -> list[dict[str, Any]]:
    out = []
    for r in db.query("SELECT ref FROM favorites ORDER BY created DESC"):
        f = get(r["ref"])
        if f and not f.get("deleted"):
            out.append(f)
    return out


def recent(limit: int = 25) -> list[dict[str, Any]]:
    """Zuletzt gegessen, mit der zuletzt verwendeten Menge als Vorschlag."""
    rows = db.query(
        "SELECT ref, amount, unit, MAX(created) last FROM entries WHERE ref IS NOT NULL AND deleted IS NULL "
        "GROUP BY ref ORDER BY last DESC LIMIT ?", (limit,))
    out = []
    for r in rows:
        f = get(r["ref"])
        if f and not f.get("deleted"):
            f["last"] = {"amount": r["amount"], "unit": r["unit"]}
            out.append(f)
    return out
