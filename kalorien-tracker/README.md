# Kalorien-Tracker

Persoenlicher Kalorien-Tracker im Liquid-Glass-Stil des Training-Dashboards
(`../garmin-dashboard/docs/DESIGN-SYSTEM.md`). Laeuft als installierbare Web-App
auf dem Raspberry Pi im Heimnetz, von unterwegs ueber den WireGuard-VPN der Fritzbox.

**URL:** https://raspberrypi.local:4320 (Zertifikat aus der lokalen CA, siehe `../https-proxy`)

## Aufbau

```
BLS 4.0 (Excel) ────► import_bls (Pi) ─────► data/bls.db ──────┐
OFF-Export (8 GB) ──► build_off.py (Mac) ──► data/off.db ──────┤  fester Stand, per scp hochgeladen
"Neues Produkt" / Barcode-Live ───────────► data/captured.db ──┼─► FastAPI ──► PWA (Heute · Woche · Mahlzeiten · Verlauf)
Eintraege, Rezepte, Einstellungen ────────► data/tracker.db ───┘      ▲  │
                                                         │  └─ /internal/v1/summary ──► Training-Dashboard
          Training-Dashboard /internal/v1/energy (Garmin-Verbrauch) ──┘

iPhone / Mac ──HTTPS──► https-proxy (Caddy, :4320) ──► kalorien-tracker:8000  (Docker-Netz homelab-apps)
```

| Pfad | Inhalt |
|---|---|
| `app/db.py` | `tracker.db`: Eintraege, Rezepte, Wasser, Einstellungen, Garmin-Cache |
| `app/captured.py` | `captured.db`: selbst erfasste Produkte (mit/ohne Barcode), Korrekturen, live von OFF geholte Produkte |
| `app/fooddb.py` | `bls.db`/`off.db`: kompaktes Schema, atomarer Neuaufbau, Trigram-Volltextsuche (FTS5) |
| `app/foods.py` | Suche + Ranking ueber alle Quellen, Rezepte, Favoriten, Barcode-Lookup |
| `app/off.py` | Open-Food-Facts-Normalisierung, Live-Barcode-Fallback (15/min, eigener User-Agent) |
| `app/budget.py` | Tagesbudget aus dem Garmin-Verbrauch, Makroziele |
| `app/templates.py` | Gespeicherte Mahlzeiten (Kombinationen mit Mengen, ein Tipp = mehrere Eintraege) |
| `app/hydration.py` | Wasser nach Garmin Connect (ueber das Dashboard, mit Nachholen) |
| `app/views.py` | Eintraege, Wasser, Heute/Woche/Verlauf, Summary fuers Dashboard |
| `app/main.py` | API, Login-Pruefung, Security-Header, `/internal` |
| `app/auth.py` | Passwort (scrypt), signiertes Session-Cookie, Sperre bei Fehlversuchen (wie Dashboard) |
| `app/import_bls.py` | BLS-Import (im Container, idempotent) |
| `scripts/build_off.py` | baut `off.db` auf dem Mac (DuckDB), siehe unten |
| `web/` | Frontend ohne Build-Schritt; `vendor/` = zxing-wasm 3.1.4 (MIT) fuer den Barcode-Scan |

## Bedienung

- **Eintragen:** Das Sheet bleibt nach "Hinzufuegen" offen; oben stehen die schon hinzugefuegten Teile
  (einzeln entfernbar) und "Fertig". Kopf mit Suchfeld bleibt fixiert, auch bei offener Tastatur (visualViewport).
- **Mahlzeiten (Tab):** gespeicherte Mahlzeiten, Rezepte, eigene Produkte. Schnellster Weg zu einer Mahlzeit:
  in "Heute" bei einer Mahlzeitenkarte "Als Mahlzeit speichern". Beim Eintragen lassen sich Teile abwaehlen und
  Mengen fuer diesen einen Eintrag aendern. Im Eintragen-Sheet unter "Mahlzeiten" ebenfalls verfuegbar.
- **Wasser:** wird zusaetzlich in Garmin Connect eingetragen (`add_hydration_data` ueber das Dashboard).
  Rueckgaengig zieht die Menge in Garmin wieder ab. Faellt Garmin aus, holt der Tracker bis 7 Tage nach.
  Die Wasserkarte zeigt den Stand ("In Garmin gespeichert" / "Wird an Garmin uebertragen").

- **Wie gestern:** Leere Mahlzeiten bieten an, die gleiche Mahlzeit vom Vortag zu uebernehmen (ein Tipp, Rueckgaengig moeglich).
- **Wasserziel mit Training:** Grundziel + 500 ml je Trainingsstunde (Trainingszeit aus Garmin, Einstellung "Wasser extra pro Trainingsstunde", 0 = aus).
- **Hinweis ab 17 Uhr:** "Noch X kcal und Y g Eiweiss" plus bis zu drei Vorschlaege aus Favoriten, zuletzt Gegessenem,
  Rezepten und gespeicherten Mahlzeiten (passend zum Rest-Budget, eiweissreich bevorzugt, kein Fruehstueck). Abschaltbar.
- **iOS:** Eingabefelder haben mindestens 16 px, sonst zoomt Safari beim Tippen hinein und bleibt in der Web-App gezoomt.

## Budget-Logik

- **Heute:** Ruheumsatz (Mittel der letzten 7 abgeschlossenen Garmin-Tage, total − aktiv)
  + heutige Aktivkalorien bisher ± Ziel. Das Budget waechst nach dem Training.
- **Abgeschlossene Tage:** Garmin-Gesamtverbrauch ± Ziel.
- **Ohne Garmin-Daten:** Ersatzbudget aus den Einstellungen (Standard 2.400 kcal). Verbrauch wird als `–` angezeigt.
- **Makros:** Eiweiss 1,8 g/kg, Fett 1,0 g/kg, Kohlenhydrate = Rest. Gewicht aus dem Garmin-Profil,
  in den Einstellungen ueberschreibbar. Ziel "Halten" (0), "Abnehmen" (−300), "Aufbauen" (+250) - Werte aenderbar.

## Datenquellen und Lizenzen

| Quelle | Umfang | Lizenz / Namensnennung |
|---|---|---|
| **Bundeslebensmittelschluessel (BLS) 4.0** | 7.140 Lebensmittel, Grundnahrungsmittel | Max Rubner-Institut (2025): Bundeslebensmittelschluessel (BLS), Version 4.0 – Deutsche Naehrstoffdatenbank. Karlsruhe. **CC BY 4.0**, https://www.blsdb.de |
| **Open Food Facts** | 233.900 Markenprodukte aus Deutschland (Stand 24.09.2026, fester Stand) | Datenbank **ODbL**, Inhalte DbCL, Bilder CC BY-SA. © Open-Food-Facts-Mitwirkende, https://world.openfoodfacts.org |
| Eigene Produkte (`captured.db`), Rezepte | selbst erfasst | – |

Die Namensnennung steht in der App unter *Verlauf → Datenquellen & Info* und *Lebensmittel → Datenquellen*.
Die Suche laeuft immer lokal. Die OFF-API wird nur fuer einzelne unbekannte Barcodes gefragt
(`GET /api/v2/product/{code}`, max. 15/min, User-Agent `kalorien-tracker/1.0 (privat)`); Treffer werden lokal gespeichert.
BLS-Stueckgewichte (Apfel 150 g, Ei 60 g, Brötchen 60 g …) sind eigene Richtwerte in `import_bls.py`.

## Betrieb auf dem Pi

Einmalig (ist erledigt):

```bash
docker network create --subnet 172.30.0.0/24 homelab-apps      # gemeinsames Netz mit Dashboard + Proxy
# .env mit INTERNAL_TOKEN (gleicher Wert in ~/garmin-dashboard/.env), Rechte 0600
```

```bash
# Deploy vom Mac
rsync -a --exclude .venv --exclude data --exclude __pycache__ --exclude .claude --exclude .env --exclude PROMPT.md ./ pi@raspberrypi.local:kalorien-tracker/
ssh pi@raspberrypi.local 'cd ~/kalorien-tracker && docker compose up -d --build kalorien-tracker'

# Logs
ssh pi@raspberrypi.local 'cd ~/kalorien-tracker && docker compose logs -f --tail 50 kalorien-tracker'

# Passwort setzen/aendern (meldet alle Geraete ab)
ssh -t pi@raspberrypi.local 'cd ~/kalorien-tracker && docker compose run --rm kalorien-tracker python -m app.auth'
```

Der Tracker hat keinen eigenen Port. Er ist nur ueber den HTTPS-Proxy erreichbar (`../https-proxy`),
weil die Kamera fuer den Barcode-Scan auf dem iPhone HTTPS braucht.

## Produktdaten

Suchreihenfolge und Vorrang: **eigene Produkte** (`captured.db`) → Rezepte → BLS → Open Food Facts.
Beim Barcode-Scan: `captured.db` → `off.db` → einmal live bei OFF (Treffer wird in `captured.db` gespeichert)
→ sonst "Neues Produkt hinzufuegen".

### off.db: fester Stand, auf dem Mac gebaut

Bewusst kein regelmaessiges Update. Neue Produkte kommen ueber
**"Neues Produkt hinzufuegen"** (in der Suche, wenn nichts passt, und nach einem unbekannten Barcode).
Falsche OFF-Werte lassen sich in der Detailansicht mit **"Werte korrigieren"** ueberschreiben:
Die Korrektur landet mit demselben Barcode in `captured.db` und hat Vorrang.

Analyse des Exports (Hugging Face `openfoodfacts/product-database`, 7,8 GB, 4,76 Mio. Produkte, 111 Spalten):

| Befund | Folge fuer off.db |
|---|---|
| 53 % der Datei sind Umweltdaten, 15 % Zutatenlisten | nicht gelesen |
| 426.081 Produkte mit `en:germany`, davon 187.813 ohne brauchbare Naehrwerte | nur Produkte mit kcal + mind. einem Makro |
| 167 Naehrwert-Parameter, relevant 8 (kcal, Eiweiss, KH, Zucker, Fett, ges. FS, Ballaststoffe, Salz; 45–93 % befuellt) | nur diese 8 |
| 4.368 Produkte, bei denen kcal um > 40 % von 4·E + 4·KH + 9·F (+ Ballaststoffe, Alkohol) abweichen (oft kJ als kcal) | aussortiert |
| Bild-URLs ~84 Zeichen | nur Schluessel ("de.1128"), URL wird beim Lesen gebaut |
| Naehrwerte als 8-Byte-Gleitkomma | Ganzzahl in 1/100 g (1–2 Byte) |

Ergebnis: 233.900 Produkte, **49 MB** (vorher 82 MB, Tabelle 20 MB, Suchindex 20 MB), Bau ~4 min auf dem Mac.
Der Pi braucht fuer off.db weder den 8-GB-Export noch viel RAM.

```bash
# Nur falls off.db doch einmal neu gebaut werden soll (laedt den Export bei Bedarf nach data/import/)
./.venv/bin/pip install duckdb
DATA_DIR=./data ./.venv/bin/python scripts/build_off.py
scp data/off.db pi@raspberrypi.local:kalorien-tracker/data/off.db.new
ssh pi@raspberrypi.local 'mv ~/kalorien-tracker/data/off.db.new ~/kalorien-tracker/data/off.db'   # atomar, kein Neustart noetig
rm -rf data/import
```

### BLS

```bash
ssh pi@raspberrypi.local 'cd ~/kalorien-tracker && docker compose --profile import run --rm import'   # ~25 s, idempotent
```

## Backup

Wichtig sind `data/tracker.db` (Eintraege, Rezepte, Einstellungen), **`data/captured.db`**
(selbst erfasste Produkte) und `data/auth.json`. `bls.db` und `off.db` lassen sich neu bauen.

```bash
# Konsistente Kopie im laufenden Betrieb (SQLite-Online-Backup), dann auf den Mac holen
ssh pi@raspberrypi.local 'cd ~/kalorien-tracker/data && for f in tracker captured; do sqlite3 $f.db ".backup $f-$(date +%F).db"; done'
scp "pi@raspberrypi.local:kalorien-tracker/data/*-$(date +%F).db" ~/Backups/

# Wiederherstellen
ssh pi@raspberrypi.local 'cd ~/kalorien-tracker && docker compose stop kalorien-tracker && cp data/tracker-YYYY-MM-DD.db data/tracker.db && rm -f data/tracker.db-wal data/tracker.db-shm && docker compose start kalorien-tracker'
```

## Verbindung zum Training-Dashboard

Server zu Server im Docker-Netz `homelab-apps`, Token `INTERNAL_TOKEN` aus `.env`, nie ueber den Browser.

| Richtung | Endpunkt | Antwort |
|---|---|---|
| Dashboard → Tracker | `GET /internal/v1/summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | pro Tag `{date, kcal, protein, carbs, fat, budget, entries}` |
| Tracker → Dashboard | `GET /internal/v1/energy?date=YYYY-MM-DD` (oder `from`/`to`) | `{totalKcal, activeKcal, bmrKcal, final}` aus `daily.summary` |
| Tracker → Dashboard | `POST /internal/v1/hydration` `{date, time, ml}` | traegt Wasser in Garmin ein (ml negativ = abziehen); 503 = Garmin pausiert, spaeter erneut |

`/internal/*` braucht den Token **und** eine Absender-IP im Docker-Netz (nicht Gateway, nicht Proxy).
Der Proxy antwortet auf `/internal/*` immer mit 404. Faellt eine Seite aus, laeuft die andere allein
weiter und zeigt `–`. Der Tracker holt den Verbrauch alle 10 min im Hintergrund.

## Lokal entwickeln

```bash
/usr/local/bin/python3.12 -m venv --copies .venv && ./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m app.import_bls                                            # data/bls.db
# off.db: scripts/build_off.py (siehe oben) oder vom Pi holen: scp pi@raspberrypi.local:kalorien-tracker/data/off.db data/
DATA_DIR=./data AUTH_ENABLED=0 ./.venv/bin/python -m uvicorn app.main:app --port 4320
./.venv/bin/python scripts/make_icons.py                                        # App-Icons neu erzeugen
```

## Farben

Makros nutzen die validierten Tokens aus dem Design-System: `--protein` (Violett), `--carbs` (Bernstein),
`--fat` (Rosa); gegessen = `--accent`, Verbrauch/Budget = `--ink-3`. Statusfarben nur mit Icon + Text.
