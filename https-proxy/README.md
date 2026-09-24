# https-proxy

HTTPS fuer die eigenen Apps auf dem Raspberry Pi: Caddy als Reverse-Proxy mit einem Zertifikat aus einer
lokalen Zertifizierungsstelle (mkcert). Nur im Heimnetz bzw. ueber den WireGuard-VPN der Fritzbox,
**kein** Port-Forwarding, kein Let's Encrypt, keine Verbindung nach aussen.

| URL | Ziel |
|---|---|
| https://raspberrypi.local:4320 | Kalorien-Tracker (`kalorien-tracker:8000`) |
| https://raspberrypi.local:4311 | Training-Dashboard (`garmin-dashboard:8000`); HTTP auf 4310 bleibt parallel |

Warum: iOS Safari erlaubt Kamera (Barcode-Scan) und zuverlaessigen Offline-Cache nur ueber HTTPS.

- Caddy haengt im Docker-Netz `homelab-apps` mit fester IP `172.30.0.10`. Die Apps vertrauen
  `X-Forwarded-*` nur von dieser IP (`FORWARDED_ALLOW_IPS`).
- `/internal/*` beantwortet der Proxy immer mit 404.
- Bewusst **kein HSTS**: Es gilt fuer den ganzen Host und wuerde HTTP-Dienste auf anderen Ports
  (Mealie, Dashboard auf 4310 …) im Browser sperren.

## Zertifikat

Die CA liegt nur auf dem Mac: `~/Library/Application Support/mkcert/` (`rootCA-key.pem` nie weitergeben).
Das Server-Zertifikat gilt fuer `raspberrypi.local`, `raspberrypi.local`, dem Raspberry Pi, `192.168.1.50`
und laeuft am **24.12.2028** ab.

```bash
# Neu ausstellen (z. B. vor Ablauf oder bei neuer IP), dann deployen
cd https-proxy
mkcert -cert-file certs/server.pem -key-file certs/server-key.pem raspberrypi.local raspberrypi.local raspberrypi 192.168.1.50
rsync -a ./ pi@raspberrypi.local:https-proxy/ && ssh pi@raspberrypi.local 'cd ~/https-proxy && docker compose restart'
```

### Root-Zertifikat einmalig vertrauen

**Mac:** `mkcert -install` (fragt nach dem Mac-Passwort; traegt die CA in den Schluesselbund ein).

**iPhone:**
1. `rootCA.pem` (nur das oeffentliche Zertifikat) per AirDrop aufs iPhone schicken → "Profil geladen".
2. Einstellungen → Allgemein → VPN und Geraeteverwaltung → Profil *mkcert …* → Installieren.
3. Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen → *mkcert …* einschalten.

Danach https://raspberrypi.local:4320 in Safari oeffnen → Teilen → *Zum Home-Bildschirm*.
Eine bereits installierte Web-App mit `http://…` muss dafuer neu hinzugefuegt werden.

## Betrieb

```bash
rsync -a ./ pi@raspberrypi.local:https-proxy/
ssh pi@raspberrypi.local 'cd ~/https-proxy && docker compose up -d'
ssh pi@raspberrypi.local 'cd ~/https-proxy && docker compose logs --tail 50'
```
