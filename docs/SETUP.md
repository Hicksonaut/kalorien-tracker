# Einrichtung

Diese Anleitung richtet den Kalorien-Tracker auf einem Raspberry Pi (oder einem anderen Linux-Server) im
Heimnetz ein – mit HTTPS, Login und optional dem Garmin-Dashboard. Dauer: etwa 30–45 Minuten.

**Beispielwerte in dieser Anleitung** – bitte durch deine eigenen ersetzen:

| | Beispiel |
|---|---|
| Server / Pi | `raspberrypi.local`, IP `192.168.1.50`, Benutzer `pi` |
| Repo auf dem Server | `~/kalorien` |

## 0. Voraussetzungen

**Server** (Raspberry Pi 4/5 mit 64-Bit-OS oder beliebiger Linux-Rechner)
- Docker und Docker Compose v2 (`curl -fsSL https://get.docker.com | sh`, danach `sudo usermod -aG docker $USER` und neu anmelden)
- ~300 MB Platz für Images und Datenbanken
- Feste IP im Heimnetz (im Router einstellen) und idealerweise ein Name, z. B. `raspberrypi.local`

**Rechner zum Einrichten** (Mac, Linux oder Windows mit WSL)
- `git`, Python 3.12
- [`mkcert`](https://github.com/FiloSottile/mkcert) für das HTTPS-Zertifikat (`brew install mkcert` bzw. Paketmanager)

**Unterwegs:** Die App ist bewusst nur im Heimnetz erreichbar. Von unterwegs geht es über ein VPN in dein
Heimnetz (z. B. WireGuard, das viele Router wie die Fritzbox eingebaut haben). **Kein Port-Forwarding einrichten.**

## 1. Repository auf den Server holen

```bash
ssh pi@raspberrypi.local
git clone https://github.com/<dein-name>/<repo>.git ~/kalorien
cd ~/kalorien
```

## 2. Gemeinsames Docker-Netz anlegen

Alle drei Container hängen in einem Netz mit festem Adressbereich. Der Proxy bekommt darin die feste
Adresse `172.30.0.10`; die Apps vertrauen weitergeleiteten Headern nur von dort.

```bash
docker network create --subnet 172.30.0.0/24 homelab-apps
```

Falls `172.30.0.0/24` bei dir schon belegt ist (`docker network ls` / `ip addr`), einen anderen Bereich wählen und
die Adresse `172.30.0.10` in `https-proxy/docker-compose.yml` sowie `FORWARDED_ALLOW_IPS`, `INTERNAL_NET` und
`PROXY_IP` in den beiden App-Compose-Dateien anpassen.

## 3. Geheimen Token erzeugen

Tracker und Dashboard sprechen über einen gemeinsamen Token miteinander. Auch ohne Dashboard muss die Datei existieren.

```bash
T=$(python3 -c "import secrets; print(secrets.token_hex(32))")
umask 077
printf "INTERNAL_TOKEN=%s\n" "$T" > kalorien-tracker/.env
printf "INTERNAL_TOKEN=%s\n" "$T" > garmin-dashboard/.env
```

**Ohne Garmin-Dashboard** zusätzlich in `kalorien-tracker/.env`:

```bash
echo "DASHBOARD_URL=" >> kalorien-tracker/.env
```

Dann gilt ein festes Ersatzbudget (in der App unter Einstellungen), und Wasser wird nur lokal gespeichert.

## 4. Lebensmitteldaten

### 4a. Grundnahrungsmittel (BLS) – auf dem Server

```bash
cd ~/kalorien/kalorien-tracker
docker compose --profile import build
docker compose --profile import run --rm import        # lädt BLS 4.0 und baut data/bls.db (~25 s)
```

### 4b. Markenprodukte (Open Food Facts) – auf dem Rechner, nicht auf dem Pi

Der OFF-Export ist ~8 GB groß und enthält 4,8 Mio. Produkte weltweit. Das Skript filtert auf Deutschland,
nimmt nur die benötigten Felder, sortiert unplausible Werte aus und baut eine kompakte `off.db` (~50 MB).
Das braucht einige GB RAM – deshalb auf dem Rechner:

```bash
# auf dem Rechner, im geklonten Repo
cd kalorien-tracker
python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt duckdb
DATA_DIR=./data ./.venv/bin/python scripts/build_off.py        # Download + Bau, ~10 min
scp data/off.db pi@raspberrypi.local:kalorien/kalorien-tracker/data/off.db
rm -rf data/import                                              # 8-GB-Export wieder löschen
```

Ohne diesen Schritt funktioniert die App auch – dann nur mit BLS, eigenen Produkten und dem Live-Abruf
einzelner Barcodes bei Open Food Facts.

## 5. Tracker starten und Passwort setzen

```bash
cd ~/kalorien/kalorien-tracker
docker compose up -d --build kalorien-tracker
docker compose run --rm kalorien-tracker python -m app.auth    # fragt ein Passwort (mind. 10 Zeichen)
```

Der Tracker hat absichtlich keinen eigenen Port – er ist nur über den HTTPS-Proxy erreichbar (Schritt 6).

## 6. HTTPS mit eigener Zertifizierungsstelle

iOS gibt die Kamera (Barcode-Scan) nur über HTTPS frei. Ein öffentliches Zertifikat geht im Heimnetz nicht,
deshalb erzeugt `mkcert` eine eigene kleine Zertifizierungsstelle (CA) auf deinem Rechner.

```bash
# auf dem Rechner
mkcert -install                    # CA anlegen und diesem Rechner vertrauen (fragt nach dem Passwort)
cd https-proxy && mkdir -p certs
mkcert -cert-file certs/server.pem -key-file certs/server-key.pem raspberrypi.local 192.168.1.50
scp -r certs pi@raspberrypi.local:kalorien/https-proxy/
cp "$(mkcert -CAROOT)/rootCA.pem" ~/Desktop/rootCA.pem       # fürs Handy, siehe unten
```

Trage bei `mkcert` alle Namen und IPs ein, unter denen du den Server aufrufst. Das Zertifikat gilt gut
zwei Jahre; danach denselben Befehl erneut ausführen.
**Wichtig:** `rootCA-key.pem` im mkcert-Ordner niemals weitergeben – wer ihn hat, kann Zertifikate ausstellen,
denen deine Geräte vertrauen.

```bash
# auf dem Server
cd ~/kalorien/https-proxy
docker compose up -d
```

Jetzt https://raspberrypi.local:4320 am Rechner öffnen und anmelden.

**iPhone / iPad**
1. `rootCA.pem` per AirDrop aufs iPhone schicken → „Profil geladen“.
2. *Einstellungen → Allgemein → VPN und Geräteverwaltung →* Profil *mkcert …* → *Installieren*.
3. *Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen →* *mkcert …* **einschalten** (wird oft vergessen).
4. In Safari https://raspberrypi.local:4320 öffnen, anmelden, *Teilen → Zum Home-Bildschirm*.

**Android:** *Einstellungen → Sicherheit → Verschlüsselung & Anmeldedaten → Zertifikat installieren → CA-Zertifikat*.

## 7. Optional: Garmin-Dashboard

Das Dashboard holt deine Garmin-Daten (inoffizielle API) und versorgt den Tracker mit dem Verbrauch.

```bash
cd ~/kalorien/garmin-dashboard
docker compose build
docker compose run --rm garmin-dashboard python -m app.login   # Garmin-E-Mail, Passwort, ggf. MFA (einmalig)
docker compose run --rm garmin-dashboard python -m app.auth    # Passwort fürs Dashboard
docker compose up -d
```

- Dashboard: http://raspberrypi.local:4310 oder https://raspberrypi.local:4311
- Der Link „Im Tracker öffnen“ zeigt standardmäßig auf `https://raspberrypi.local:4320`. Anderen Namen in
  `garmin-dashboard/.env` setzen: `TRACKER_PUBLIC_URL=https://mein-server:4320`.
- Das Garmin-Passwort wird nicht gespeichert, nur Tokens in `data/tokens` (Rechte 0600).
- Der erste Sync lädt die Historie langsam im Hintergrund (gedrosselt, damit Garmin nicht sperrt).

## 8. Prüfen

```bash
docker ps                                          # kalorien-tracker, https-proxy (und garmin-dashboard) laufen
docker compose -f ~/kalorien/kalorien-tracker/docker-compose.yml logs --tail 30 kalorien-tracker
curl -sk https://localhost:4320/login.html | grep -o "<h1>.*</h1>"      # <h1>Kalorien</h1>
```

In der App unter *Verlauf → Datenquellen & Info* stehen die Anzahl der Lebensmittel und der Garmin-Status.

## Betrieb

**Update**
```bash
cd ~/kalorien && git pull
cd kalorien-tracker && docker compose up -d --build kalorien-tracker
cd ../garmin-dashboard && docker compose up -d --build
```

**Backup** – wichtig sind `tracker.db`, `captured.db` und `auth.json` im Ordner `kalorien-tracker/data/`:
```bash
cd ~/kalorien/kalorien-tracker/data
for f in tracker captured; do sqlite3 $f.db ".backup $f-$(date +%F).db"; done
```
`bls.db` und `off.db` lassen sich jederzeit neu erzeugen.

**Passwort ändern** (meldet alle Geräte ab): Schritt 5 bzw. 7, Befehl `python -m app.auth` erneut ausführen.

## Häufige Probleme

| Problem | Lösung |
|---|---|
| Safari: „Verbindung nicht sicher“ | Schritt 6 auf dem Gerät vollständig machen, auch die Vertrauenseinstellung. Name/IP muss im Zertifikat stehen. |
| Kamera startet nicht | Nur über `https://` möglich. Kamerazugriff für Safari erlauben. Barcode lässt sich immer auch eintippen. |
| Budget zeigt „Ersatzbudget“ | Dashboard läuft nicht oder `DASHBOARD_URL` ist leer. Token in beiden `.env` gleich? `docker logs kalorien-tracker` |
| „Garmin-Anmeldung abgelaufen“ im Dashboard | `docker compose run --rm garmin-dashboard python -m app.login` |
| Seite wirkt auf dem iPhone gezoomt | Web-App vom Home-Bildschirm entfernen und neu hinzufügen (alte Version im Cache). |
| Netz `homelab-apps` fehlt | Schritt 2 |

## Entwickeln

```bash
cd kalorien-tracker
DATA_DIR=./data/demo ./.venv/bin/python -m app.import_bls
DATA_DIR=./data/demo ./.venv/bin/python scripts/demo_data.py
DATA_DIR=./data/demo AUTH_ENABLED=0 ./.venv/bin/python -m uvicorn app.main:app --port 4320 --reload
```

Aufbau, Budget-Logik und Schnittstellen: [kalorien-tracker/README.md](../kalorien-tracker/README.md).
Stilvorgaben (Farben, Komponenten, Diagramme): [garmin-dashboard/docs/DESIGN-SYSTEM.md](../garmin-dashboard/docs/DESIGN-SYSTEM.md).
