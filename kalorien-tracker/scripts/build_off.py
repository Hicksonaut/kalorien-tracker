"""Baut `data/off.db` aus dem Open-Food-Facts-Export - auf dem Mac, nicht auf dem Pi.

off.db ist ein fester Stand (bewusst kein regelmaessiges Update).
Neue Produkte kommen ueber "Neues Produkt hinzufuegen" in die eigene captured.db.

Ablauf:
1. Export (Parquet, ~8 GB, 4,8 Mio. Produkte) von Hugging Face laden (oder --file).
2. DuckDB filtert auf Deutschland und liest nur die benoetigten Felder (~2 min auf dem Mac).
3. Plausibilitaet: kcal muss zu 4*Eiweiss + 4*KH + 9*Fett (+ Ballaststoffe, Alkohol) passen,
   sonst fliegt das Produkt raus (typisch: kJ als kcal eingetragen).
4. Kompakte SQLite-Datei ueber app.fooddb.Builder (gleiches Format wie bls.db).
5. Deploy: scp auf den Pi als off.db.new, dann atomar umbenennen (siehe README).

    ./.venv/bin/pip install duckdb        # nur lokal, nicht im Container
    DATA_DIR=./data ./.venv/bin/python scripts/build_off.py [--file data/import/food.parquet]

Daten: (c) Open-Food-Facts-Mitwirkende, Open Database License (ODbL).
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import duckdb  # noqa: E402

from app import fooddb, off  # noqa: E402
from app.db import DATA_DIR  # noqa: E402

log = logging.getLogger("build_off")

URL = "https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet"
MAX_DEVIATION = 0.4   # kcal darf hoechstens 40 % von der Makro-Rechnung abweichen


def _nut(name: str) -> str:
    return f"""(SELECT max(u."100g") FROM unnest(nutriments) t(u) WHERE u.name='{name}')"""


QUERY = f"""
SELECT code,
  coalesce(list_filter(product_name, x -> x.lang = 'de')[1]."text",
           list_filter(product_name, x -> x.lang = 'main')[1]."text",
           product_name[1]."text") AS pname,
  brands, quantity, product_quantity_unit AS pqu, serving_size, serving_quantity,
  coalesce({_nut('energy-kcal')}, {_nut('energy-kj')} / 4.184, {_nut('energy')} / 4.184) AS kcal,
  {_nut('proteins')} AS protein, {_nut('carbohydrates')} AS carbs, {_nut('sugars')} AS sugar,
  {_nut('fat')} AS fat, {_nut('saturated-fat')} AS satfat, {_nut('fiber')} AS fiber,
  {_nut('salt')} AS salt, {_nut('alcohol')} AS alcohol,
  nutriscore_grade AS ns, coalesce(unique_scans_n, 0) AS pop, lang,
  list_filter(images, x -> x."key" IN ('front_de', 'front_' || lang, 'front_en'))[1] AS img
FROM read_parquet(?)
WHERE list_contains(countries_tags, 'en:germany') AND NOT coalesce(obsolete, false)
"""


def plausible(kcal: float, it: dict) -> bool:
    calc = (4 * (it["protein"] or 0) + 4 * (it["carbs"] or 0) + 9 * (it["fat"] or 0)
            + 2 * (it["fiber"] or 0) + 5.5 * (it.get("alcohol") or 0))
    if calc <= 20 and kcal <= 40:        # Wasser, Tee, Light-Getraenke: kaum Energie, nichts zu pruefen
        return True
    return calc > 0 and abs(kcal - calc) / calc <= MAX_DEVIATION


def build(src: str) -> None:
    con = duckdb.connect()
    con.execute(f"SET threads={os.cpu_count() or 4}")
    t0 = time.time()
    cur = con.execute(QUERY, [src])
    cols = [d[0] for d in cur.description]
    b = fooddb.Builder("off")
    stats = {"de": 0, "unbrauchbar": 0, "unplausibel": 0}
    try:
        while batch := cur.fetchmany(20000):
            items = []
            for row in batch:
                r = dict(zip(cols, row))
                stats["de"] += 1
                sg, sl = off._serving(r["serving_size"], r["serving_quantity"])
                img = r["img"]
                item = off._finish({
                    "code": str(r["code"] or "").strip(), "name": r["pname"], "brand": r["brands"],
                    "quantity": r["quantity"] or None, "serving_g": sg, "serving_label": sl,
                    "piece_g": None, "piece_label": None,
                    "kcal": r["kcal"], "protein": r["protein"], "carbs": r["carbs"], "sugar": r["sugar"],
                    "fat": r["fat"], "satfat": r["satfat"], "fiber": r["fiber"], "salt": r["salt"],
                    "nutriscore": r["ns"], "liquid": off._liquid(r["quantity"], r["pqu"]),
                    "popularity": int(r["pop"] or 0),
                    # nur der Schluessel ("de.123"), die URL baut fooddb.decode
                    "image": f"{img['key'][6:]}.{img['rev']}" if img and img["rev"] is not None else None,
                })
                if not item or not item["code"].isdigit():
                    stats["unbrauchbar"] += 1
                    continue
                if not plausible(item["kcal"], {**item, "alcohol": r["alcohol"]}):
                    stats["unplausibel"] += 1
                    continue
                items.append(item)
            b.add_many(items)
            log.info("  %d gelesen, %d uebernommen (%.0f s)", stats["de"], b.count, time.time() - t0)
        n = b.finish({"source": "Open Food Facts", "license": "ODbL", "built": "mac",
                      "rows_de": str(stats["de"]), "dropped_implausible": str(stats["unplausibel"])})
    except BaseException:
        b.abort()
        raise
    size = fooddb.path("off").stat().st_size / 1e6
    log.info("off.db: %d Produkte, %.0f MB (DE %d, ohne Naehrwerte %d, unplausibel %d) in %.0f s",
             n, size, stats["de"], stats["unbrauchbar"], stats["unplausibel"], time.time() - t0)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    ap = argparse.ArgumentParser(description="off.db auf dem Mac bauen")
    ap.add_argument("--file", default=str(DATA_DIR / "import" / "food.parquet"),
                    help="lokale food.parquet (wird geladen, falls sie fehlt)")
    args = ap.parse_args()
    src = Path(args.file)
    if not src.exists():
        src.parent.mkdir(parents=True, exist_ok=True)
        log.info("Lade Export nach %s (~8 GB)", src)
        subprocess.run(["curl", "-fL", "-A", off.USER_AGENT, "-o", f"{src}.part", URL], check=True)
        Path(f"{src}.part").rename(src)
    build(str(src))


if __name__ == "__main__":
    main()
