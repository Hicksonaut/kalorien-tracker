# Design-System „Liquid Glass“

Verbindliche Stilvorgabe für persönliche Web-Apps auf dem Raspberry Pi: das
Training-Dashboard und alle Apps, die sich daran anlehnen (z. B. der Kalorien-Tracker).
Ziel: Die Apps sollen sich anfühlen wie **eine** App, im Stil von iOS 26 „Liquid Glass“.

**Referenz-Implementierung:** `garmin-dashboard/web/styles.css` und `web/app.js`.
Bei Abweichungen gilt der Code. Neue Apps **kopieren `styles.css`** und ergänzen
nur, statt die Tokens neu zu erfinden.

---

## 1. Prinzipien

1. **Ruhig statt vollgepackt.** Wenige, große Zahlen, darunter eine Zeile Kontext.
   Weniger Kennzahlen als Garmin Connect, dafür die richtigen.
2. **Glas über Farbe.** Der Hintergrund besteht aus weichen, langsam driftenden
   Farbfeldern. Alle Flächen sind halbtransparentes Glas darüber.
3. **Sachlicher Ton.** Deutsch, knapp, **keine Emojis**. Icons nur als Linien-SVGs.
4. **Mobile first, am Mac genauso gut.** Eine Spalte am Handy, Raster ab 760 px
   und ab 1040 px.
5. **Hell und dunkel sind beide gestaltet.** Beide Modi folgen dem System
   (`prefers-color-scheme`), und jeder Modus hat seine eigenen Farbstufen.
6. **Zahlen zuerst.** Überall gilt: Wert groß, Einheit klein und grau (`<span class="unit">`).

## 2. Tokens (CSS Custom Properties)

### Neutrale Farben & Material

| Token | Hell | Dunkel | Verwendung |
|---|---|---|---|
| `--page` | `#eef0f5` | `#07080c` | Seitenhintergrund |
| `--ink` | `#0b0b0f` | `#f5f5f7` | Primärtext, große Zahlen |
| `--ink-2` | `#4a4b55` | `#c1c2cc` | Sekundärtext |
| `--ink-3` | `#8a8b94` | `#8a8b96` | Labels, Achsen, Einheiten |
| `--hair` | `rgba(15,18,30,.08)` | `rgba(255,255,255,.08)` | Trennlinien |
| `--grid` | `rgba(15,18,30,.07)` | `rgba(255,255,255,.07)` | Chart-Gitter |
| `--glass` | `rgba(255,255,255,.55)` | `rgba(30,32,40,.48)` | Karten |
| `--glass-strong` | `rgba(255,255,255,.72)` | `rgba(36,38,48,.72)` | Tab-Leiste, aktive Segmente, Tooltip |
| `--sheet` | `rgba(246,247,251,.86)` | `rgba(22,23,30,.86)` | Bottom-Sheet / Modal |
| `--glass-stroke` | `rgba(255,255,255,.75)` | `rgba(255,255,255,.14)` | 1px-Rand |
| `--glass-shine` | `rgba(255,255,255,.9)` | `rgba(255,255,255,.22)` | Lichtkante oben |
| `--glass-edge` | `rgba(15,18,30,.06)` | `rgba(0,0,0,.35)` | Schattenkante unten |
| `--chip` | `rgba(15,18,30,.05)` | `rgba(255,255,255,.07)` | Listenzeilen, Badges, Leerspuren |
| `--accent` | `#2a78d6` | `#3f8cea` | Links, aktiver Tab, Fokus, primärer Button |

### Kategorische Farben (Identität)

Feste Reihenfolge, nie zyklisch. Validiert mit dem Palette-Validator: Abstand bei
Farbfehlsichtigkeit ≥ 9 für alle Paare, in beiden Modi. Im hellen Modus haben
einige Farben weniger als 3:1 Kontrast. Deshalb **steht immer ein Text-Label
daneben** (nie Farbe allein).

| Token | Bedeutung | Hell | Dunkel |
|---|---|---|---|
| `--run` | Laufen | `#eb6834` | `#e8683a` |
| `--bike` | Rad | `#2a78d6` | `#3f8cea` |
| `--gym` | Kraft | `#1baf7a` | `#1faa78` |
| `--other` | Sonstiges | `#8a8b94` | `#8a8b94` |

**Makronährstoffe** (für den Kalorien-Tracker, ebenfalls validiert: CVD all-pairs ≥ 13):

| Token | Bedeutung | Hell | Dunkel |
|---|---|---|---|
| `--protein` | Eiweiß | `#4a3aa7` | `#9085e9` |
| `--carbs` | Kohlenhydrate | `#eda100` | `#c98500` |
| `--fat` | Fett | `#e87ba4` | `#d55181` |

Weitere feste Zuordnungen:
- **Schlafphasen:** `--deep` (`#184f95` / `#2a78d6`), `--light` (`#6da7ec` / `#86b6ef`), `--rem` (`#e87ba4` / `#d55181`), `--awake` (`#c3c2b7` / `#6b6a66`)
- **HF-Zonen:** eine Blau-Rampe `--z1` bis `--z5` (hell: `#86b6ef`, `#5598e7`, `#2a78d6`, `#1c5cab`, `#104281`)

### Statusfarben (reserviert)

| Token | Hex | Bedeutung |
|---|---|---|
| `--good` | `#0ca30c` | erledigt, im Ziel, optimal |
| `--warn` | `#fab219` | Achtung |
| `--serious` | `#ec835a` | deutlich daneben |
| `--critical` | `#d03b3b` | verpasst, Fehler |

Statusfarben werden **nie** für Kategorien verwendet. Sie erscheinen immer mit
**Icon + Text** (Komponente `.badge`).

### Form, Maße, Schrift

- Radien: `--r-lg: 28px` (Karten), `--r-md: 20px` (Kacheln, Tage), `--r-sm: 14px` (Zeilen), Pillen `999px`
- Abstände: Seitenrand 16px, Raster-Gap 14px, Karten-Padding 18px, Kachel-Padding 14/16px
- Schrift: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", sans-serif`. **Keine** Webfonts.
  - Seitentitel 34px/700, Letter-Spacing −0.02em
  - Kartentitel 13px/600, UPPERCASE, Letter-Spacing 0.04em, Farbe `--ink-3`, Icon 16px davor
  - Hero-Zahl 34–38px/700, Kachel-Zahl 26px/700, `.mid` 22px/650
  - Fließtext 15px, klein 13px, winzig 11px
  - `font-variant-numeric: tabular-nums` nur für Tabellen, Achsen und Tooltips

## 3. Material & Hintergrund

```css
.glass {
  background: var(--glass);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--glass-stroke);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow), inset 0 1px 0 var(--glass-shine), inset 0 -1px 0 var(--glass-edge);
}
.glass::before { /* Spiegelkante */
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: linear-gradient(140deg, var(--glass-shine) 0%, transparent 28%, transparent 72%, rgba(255,255,255,.04) 100%);
  opacity: .35;
}
```

Hintergrund: `<div class="backdrop"><i></i><i></i><i></i><i></i></div>`. Das sind vier
radiale Farbfelder (Orange, Blau, Grün, Rosa mit 20–30 % Deckkraft), die mit 60px
weichgezeichnet sind. Sie driften in 38–52 s Schleifen (`@keyframes drift`). Bei
`prefers-reduced-motion` sind sie statisch.

## 4. Layout

- `.app`: max. 1180px breit, zentriert. Padding berücksichtigt `safe-area-inset-*`, unten
  ist Platz für die schwebende Tab-Leiste gelassen.
- **Topbar:** großer Titel + Untertitel (Datum/Kontext) links, eine Glas-Pille rechts
  (Sync-Status bzw. Primäraktion).
- **Raster:** `.grid` mit 12 Spalten. `.col-12/8/6/4/3`, am Handy alles volle Breite (`.col-3` halbe).
- **Kachel-Reihe:** `.tiles`, am Handy 2 Spalten, ab 760px 4 Spalten.
- **Tab-Leiste:** unten mittig schwebend (`.tabbar.glass`), Pillenform, 4 Einträge
  mit Icon (24px) + Label (10.5px/600). Aktiv: Farbe `--accent` + `--chip`-Hintergrund.
- **Detailansicht:** `.sheet` fährt am Handy als Bottom-Sheet von unten hoch (Griff
  oben, Wischen nach unten schließt). Ab 900px ist es ein zentriertes Modal. Dahinter
  liegt `.sheet-bg` mit 35 % Schwarz.

## 5. Komponenten

| Klasse | Aussehen / Regel |
|---|---|
| `.card.glass` | Standardfläche. Kopf: `.card-h` mit `.card-t` (Titel mit Icon) links, `.card-link` oder ein grauer Zusatz rechts |
| `.tile.glass` | Kennzahl: `.t` (Icon + Label), `.v` (Zahl + `.unit`), 1–2 `.s`-Zeilen Kontext |
| `.row` | Listenzeile auf `--chip`: 40px Icon-Kachel in Kategoriefarbe (weißes Icon), Titel + `.meta`-Zeile, rechts Datum/Badge. Klickbar mit `data-*`, `:active` skaliert auf 0.985 |
| `.row.planned` | Geplant, aber nicht erledigt: Icon-Kachel gestrichelt umrandet in der Kategoriefarbe |
| `.badge` | Pille mit Status-Icon + Text, z. B. „Erledigt“, „Verpasst“, „Heute“ |
| `.segment.glass` | Umschalter (Sportart, Zeitraum 7 T / 30 T / 90 T / 1 J). Aktiv: `--glass-strong` + Schatten |
| `.ring` | Fortschrittsring (SVG, Strichstärke 12, abgerundet), Wert mittig groß, Label darunter in UPPERCASE |
| `.meter` | 6px-Balken für Faktoren, Farbe nach Score |
| `.loadbar` | Zielkorridor als grünes Band (28 %), aktueller Wert als Strich in `--ink` |
| `.stagebar` | Gestapelter Anteilsbalken, 2px Lücken, Enden gerundet |
| `.banner.glass` | Hinweiszeile mit Icon (Sync läuft, Login abgelaufen, offline) |
| `.login.glass` | Zentrierte Karte: App-Icon, Titel, ein Feld, ein primärer Button (`--accent`) |
| `.skeleton` | Pulsierende Glasfläche als Lade-Platzhalter |
| `.empty-state` | Zentrierter grauer Satz, z. B. „Noch keine Daten“ |

Leere Werte werden als `–` angezeigt, nie als `0` oder `null`.

## 6. Diagramme

Eigene kleine SVG-Engine in `app.js` (`chart(el, spec)`), keine Chart-Bibliothek.
Regeln:

- **Linien** 2px (Zeitreihen im Detail 1.4–1.6px), runde Enden. Optional eine Fläche mit
  Verlauf von 35 % auf 2 % Deckkraft. Letzter Wert als Punkt mit Ring in `--page`.
- **Balken** max. 28px breit, **4px Rundung nur am oberen Ende**, gestapelt mit 2px Lücke.
- **Zielkorridore** als Band mit 14 % Deckkraft in `--good`.
- **Eine y-Achse.** Nie zwei Skalen in einem Diagramm, sondern zwei Diagramme.
  Pace-Achsen sind umgedreht (schneller = oben).
- Achsen/Gitter zurückhaltend: Beschriftung 10.5px in `--ink-3`, Gitterlinien `--grid`.
  Bei nicht-negativen Daten beginnt die Achse bei 0.
- **Hover/Touch ist Pflicht:** Fadenkreuz + Glas-Tooltip (`.tip`). Titel oben, darunter
  Zeilen „Farbstrich · Label · **Wert**“. Balken, Punkte und Zeitleisten haben eigene Tooltips.
  Tooltip-Inhalte nur per `textContent`.
- **Legende** ab 2 Reihen (`.legend`). Gestrichelte Reihen werden im Legendentext benannt.
- Farben immer aus Tokens lesen (`css("--run")`), nie Hex im JS.

## 7. Icons

Eigene Inline-SVGs, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
`stroke-width` 1.8 (in farbigen Kacheln 2), runde Enden und Ecken. Stil wie
SF Symbols „regular“. Vorhandenes Set in `app.js` → `ICONS` (Sportarten, Mond,
Blitz, Welle, Herz, Schritte, Tacho, Flamme, Kalender, Uhr, Check, X, Pfeile, Waage).
Neue Icons im selben Stil ergänzen.

## 8. Bewegung

- Neue Ansicht: `rise` in 0.45s `cubic-bezier(.2,.8,.2,1)` (10px hoch, Opacity)
- Sheet: 0.45s `cubic-bezier(.2,.9,.2,1)`, Ringe füllen sich in 1s
- Drücken: `transform: scale(.94–.985)`
- Alles in `@media (prefers-reduced-motion: reduce)` abschalten

## 9. Technik-Konventionen

- Frontend **ohne Build-Schritt**: `index.html` + `styles.css` + `app.js` (ES-Module),
  Hash-Router (`#/heute`, `#/woche` …), gerendert per Template-Strings mit `esc()`.
- Backend: Python + FastAPI + SQLite, in Docker auf dem Raspberry Pi, eine Datei pro Aufgabe
  (`db.py`, `views.py`, `main.py`, `auth.py`).
- Strenge CSP: `default-src 'self'`, `script-src 'self'` (keine Inline-Skripte, keine CDNs
  zur Laufzeit – Bibliotheken werden lokal in `web/vendor/` abgelegt).
- PWA: `manifest.webmanifest`, `apple-mobile-web-app-*`-Metas, `viewport-fit=cover`,
  App-Icon im gleichen Stil (Farbfelder + Glas-Rechteck + weißes Linien-Symbol).
- Zugriff: im Heimnetz + WireGuard-VPN der Fritzbox, Passwort-Login mit
  signiertem Session-Cookie (siehe `garmin-dashboard/app/auth.py`).
- Datums- und Zahlenformat deutsch (`toLocaleString("de-DE")`, „Do, 24. Sep“, „1:02 h“).
