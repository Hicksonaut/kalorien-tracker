"""MyWhoosh -> Garmin Connect, gesteuert aus den Dashboard-Einstellungen.

- Holt neue Fahrten ueber die MyWhoosh-App-API (gleicher Login wie in der App),
  laedt die FIT-Datei und laedt sie ueber den bestehenden Garmin-Client hoch.
  Garmin leitet an Strava weiter.
- Zeitplan (wie oft / wann am Tag) und Optionen liegen im SQLite-State, die
  MyWhoosh-Zugangsdaten in `data/mywhoosh_credentials.json` (0600, werden nie
  an den Browser zurueckgegeben).
- Garmin-Login inkl. MFA laeuft ueber die Einstellungen: das Passwort wird nur
  fuer den Login benutzt, gespeichert werden ausschliesslich die Tokens.
"""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from garminconnect import Garmin

from . import db
from .sync import TOKENSTORE, Paused, syncer

log = logging.getLogger("mywhoosh")

LOGIN_URL = "https://services.mywhoosh.com/http-service/api/login"
ACTIVITIES_URL = "https://service14.mywhoosh.com/v2/rider/profile/activities"
DOWNLOAD_URL = "https://service14.mywhoosh.com/v2/rider/profile/download-activity-file"
WEB_PASSPHRASE = "D9436E508087E863"  # steckt im oeffentlichen JS der MyWhoosh-Webseite

CRED_FILE = db.DATA_DIR / "mywhoosh_credentials.json"
FIT_DIR = db.DATA_DIR / "mywhoosh_fit"
SESSION_FILE = db.DATA_DIR / "mywhoosh_session.json"
DEFAULTS = {"enabled": False, "times": ["21:30"], "lookbackDays": 3, "fakeDevice": False,
            "activityType": "indoor_cycling", "source": "mywhoosh"}
SOURCES = ("mywhoosh", "intervals")
ICU_BASE = "https://intervals.icu/api/v1"
ICU_CRED_FILE = db.DATA_DIR / "intervals_credentials.json"
# Garmin-Aktivitaetstypen fuer Indoor-Fahrten: (typeId, typeKey, parentTypeId)
ACTIVITY_TYPES = {"indoor_cycling": (25, "indoor_cycling", 2), "virtual_ride": (152, "virtual_ride", 2)}
MAX_TIMES = 8
RETRY_AFTER = 15 * 60
MAX_RETRIES = 8          # ca. 2 Stunden Geduld, falls MyWhoosh gerade auf einem anderen Geraet angemeldet ist
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


# ---------------------------------------------------------------- Einstellungen

def get_settings() -> dict:
    s = {**DEFAULTS, **(db.get_state("mw_settings") or {})}
    return s


def set_settings(body: dict) -> dict:
    s = get_settings()
    if "enabled" in body:
        s["enabled"] = bool(body["enabled"])
    if "fakeDevice" in body:
        s["fakeDevice"] = bool(body["fakeDevice"])
    if "source" in body:
        if body["source"] not in SOURCES:
            raise ValueError("Unbekannte Quelle")
        s["source"] = body["source"]
    if "activityType" in body:
        if body["activityType"] not in (*ACTIVITY_TYPES, "keep"):
            raise ValueError("Unbekannter Aktivitaetstyp")
        s["activityType"] = body["activityType"]
    if "lookbackDays" in body:
        s["lookbackDays"] = max(1, min(int(body["lookbackDays"]), 30))
    if "times" in body:
        times = sorted({str(t) for t in body["times"]})
        if not times or len(times) > MAX_TIMES or not all(TIME_RE.match(t) for t in times):
            raise ValueError("Uhrzeiten im Format HH:MM, 1 bis %d Stueck" % MAX_TIMES)
        s["times"] = times
    db.set_state("mw_settings", s)
    syncer_wake()
    return s


def has_credentials() -> bool:
    return CRED_FILE.exists()


def set_credentials(email: str, password: str) -> None:
    email, password = email.strip(), password
    if not email or not password or len(email) > 200 or len(password) > 200:
        raise ValueError("E-Mail und Passwort noetig")
    CRED_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = CRED_FILE.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"email": email, "password": password}, f)
    tmp.replace(CRED_FILE)
    SESSION_FILE.unlink(missing_ok=True)
    db.set_state("mw_email", email)


def clear_credentials() -> None:
    CRED_FILE.unlink(missing_ok=True)
    SESSION_FILE.unlink(missing_ok=True)
    db.set_state("mw_email", None)


def _credentials() -> tuple[str, str]:
    try:
        c = json.loads(CRED_FILE.read_text())
        return c["email"], c["password"]
    except (OSError, ValueError, KeyError):
        raise RuntimeError("Keine MyWhoosh-Zugangsdaten hinterlegt")


# ---------------------------------------------------------------- MyWhoosh-API

def _device_id() -> str:
    did = db.get_state("mw_device_id")
    if not did:
        did = str(uuid.uuid4())
        db.set_state("mw_device_id", did)
    return did


def _mw_login(email: str, password: str) -> tuple[str, str | None]:
    r = requests.post(LOGIN_URL, timeout=30, json={
        "Username": email, "Password": password, "Platform": "Android", "Action": 1001,
        "CorrelationId": str(uuid.uuid4()), "DeviceId": _device_id(), "Authorization": "",
    })
    r.raise_for_status()
    data = r.json()
    if not data.get("Success"):
        if "already logged in" in str(data.get("Message", "")).lower():
            raise RuntimeError("MyWhoosh ist gerade auf einem anderen Geraet angemeldet (App offen oder Fahrt), spaeter erneut oder Token von mywhoosh.com uebernehmen")
        raise RuntimeError(f"MyWhoosh-Login fehlgeschlagen: {str(data.get('Message', 'unbekannt'))[:120]}")
    return data["AccessToken"], data.get("WhooshId")


class Unauthorized(Exception):
    """Gespeichertes Token abgelehnt."""


def _jwt_exp(token: str) -> float | None:
    try:
        b = token.split(".")[1]
        return float(json.loads(base64.urlsafe_b64decode(b + "=" * (-len(b) % 4))).get("exp"))
    except (IndexError, ValueError, TypeError):
        return None


def _save_session(token: str, whoosh_id: str | None, source: str = "login") -> None:
    exp = _jwt_exp(token) or time.time() + 3600
    fd = os.open(SESSION_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"token": token, "exp": exp, "whooshId": whoosh_id, "source": source}, f)


def set_web_token(raw: str) -> dict:
    """Token von mywhoosh.com (Web-Login mit reCAPTCHA) uebernehmen. Umgeht die Ein-Geraet-Sperre der App-Anmeldung."""
    token = raw.strip().strip('"').removeprefix("Bearer ").strip()
    if token.count(".") != 2 or len(token) > 4000 or any(c.isspace() for c in token):
        raise ValueError("Das sieht nicht wie ein MyWhoosh-Token aus")
    exp = _jwt_exp(token)
    if exp and exp < time.time():
        raise ValueError("Das Token ist bereits abgelaufen, bitte neu anmelden und kopieren")
    try:
        _mw_activities(token)
    except Unauthorized:
        raise ValueError("MyWhoosh lehnt dieses Token ab")
    except requests.RequestException:
        raise ValueError("MyWhoosh nicht erreichbar, bitte spaeter erneut")
    _save_session(token, None, "web")
    return _session_info()


def _session_info() -> dict:
    try:
        c = json.loads(SESSION_FILE.read_text())
        return {"until": datetime.fromtimestamp(c["exp"]).isoformat(timespec="minutes"),
                "valid": c["exp"] > time.time(), "source": c.get("source", "login")}
    except (OSError, ValueError, KeyError):
        return {}


def _cached_session() -> tuple[str, str | None] | None:
    """Gespeichertes Token, solange es noch mindestens 5 Minuten gueltig ist. Spart den Login."""
    try:
        c = json.loads(SESSION_FILE.read_text())
        if c["exp"] - time.time() > 300:
            return c["token"], c.get("whooshId")
    except (OSError, ValueError, KeyError):
        pass
    return None


def _session(force_login: bool = False) -> tuple[str, str | None]:
    if not force_login and (c := _cached_session()):
        return c
    email, password = _credentials()
    token, wid = _mw_login(email, password)
    _save_session(token, wid)
    return token, wid


def _mw_activities(token: str) -> list[dict]:
    r = requests.post(ACTIVITIES_URL, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                      json={"page": 1, "limit": 20, "sortDate": "DESC"}, timeout=30)
    if r.status_code == 401:
        raise Unauthorized()
    if r.status_code != 200:
        raise RuntimeError(f"MyWhoosh-Aktivitaetsliste nicht abrufbar (HTTP {r.status_code}: {r.text[:120]})")
    results = (r.json().get("data") or {}).get("results")
    if not isinstance(results, list):
        raise RuntimeError("Unbekannte Antwortstruktur der MyWhoosh-Aktivitaetsliste")
    return results


def _act_id(a: dict) -> str:
    return str(a.get("activityFileId") or a.get("id") or "")


def _act_time(a: dict) -> datetime | None:
    """Startzeit als timezone-aware Datum (UTC)."""
    v = a.get("startDatetime") or a.get("createdAt")
    if v:
        try:
            return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except ValueError:
            pass
    if isinstance(a.get("date"), (int, float)):
        return datetime.fromtimestamp(a["date"], tz=timezone.utc)
    return None


def _evp_bytes_to_key(password: bytes, salt: bytes) -> tuple[bytes, bytes]:
    d = prev = b""
    while len(d) < 48:
        prev = hashlib.md5(prev + password + salt).digest()
        d += prev
    return d[:32], d[32:48]


def _encrypt_body(obj: dict) -> str:
    """Die MyWhoosh-Webseite verschluesselt die Download-Anfrage (CryptoJS AES, Passphrase im Seiten-JS)."""
    from Crypto.Cipher import AES
    salt = os.urandom(8)
    key, iv = _evp_bytes_to_key(WEB_PASSPHRASE.encode(), salt)
    raw = json.dumps(obj, separators=(",", ":")).encode()
    raw += bytes([16 - len(raw) % 16]) * (16 - len(raw) % 16)
    return base64.b64encode(b"Salted__" + salt + AES.new(key, AES.MODE_CBC, iv).encrypt(raw)).decode()


class NotFit(Exception):
    """MyWhoosh hat fuer die Fahrt keine FIT-Datei (z. B. nur GPX bei sehr kurzen Fahrten)."""


def _mw_download(act: dict, token: str, dest: Path) -> Path:
    r = requests.post(DOWNLOAD_URL, timeout=60, data=_encrypt_body({"fileId": act["activityFileId"]}),
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"})
    if r.status_code != 200:
        raise RuntimeError(f"MyWhoosh-Download-Link nicht abrufbar (HTTP {r.status_code}: {r.text[:120]})")
    url = r.json().get("data")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise RuntimeError("MyWhoosh lieferte keinen Download-Link")
    f = requests.get(url, timeout=120)
    f.raise_for_status()
    if f.content[8:12] != b".FIT":
        kind = "GPX" if b"<gpx" in f.content[:400].lower() else "unbekanntes Format"
        raise NotFit(f"MyWhoosh liefert hierfuer nur {kind} statt FIT")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(f.content)
    return dest


def _fake_edge_840(src: Path) -> Path:
    """Markiert die FIT-Datei als Garmin Edge 840, damit Garmin Training Effect/Load berechnet."""
    from fit_tool.fit_file import FitFile
    from fit_tool.fit_file_builder import FitFileBuilder
    from fit_tool.profile.messages.device_info_message import DeviceInfoMessage
    from fit_tool.profile.messages.file_id_message import FileIdMessage

    builder = FitFileBuilder(auto_define=True, min_string_size=50)
    for rec in FitFile.from_file(str(src)).records:
        m = rec.message
        if isinstance(m, (FileIdMessage, DeviceInfoMessage)):
            m.manufacturer, m.product = 1, 4024
            if isinstance(m, DeviceInfoMessage):
                m.software_version = 20.19
        builder.add(m)
    out = src.with_name(src.stem + "_edge840.fit")
    builder.build().to_file(str(out))
    return out


# ---------------------------------------------------------------- intervals.icu
# MyWhoosh schickt fertige Fahrten selbst an intervals.icu (Verbindung in MyWhoosh einrichten).
# Von dort holen wir die Originaldatei ueber die offizielle API mit persoenlichem API-Schlüssel:
# keine Ein-Geraet-Sperre, kein reCAPTCHA.

def _write_private(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f)
    tmp.replace(path)


def _icu_key() -> str:
    try:
        return json.loads(ICU_CRED_FILE.read_text())["apiKey"]
    except (OSError, ValueError, KeyError):
        raise RuntimeError("Kein intervals.icu-API-Schluessel hinterlegt")


def _icu_get(path: str, key: str, **params: Any) -> requests.Response:
    r = requests.get(ICU_BASE + path, auth=("API_KEY", key), params=params, timeout=60)
    if r.status_code in (401, 403):
        raise RuntimeError("intervals.icu lehnt den API-Schluessel ab")
    r.raise_for_status()
    return r


def set_icu_key(raw: str) -> dict:
    key = raw.strip()
    if not key or len(key) > 200 or any(c.isspace() for c in key):
        raise ValueError("Das sieht nicht wie ein API-Schluessel aus")
    try:
        _icu_get("/athlete/0", key)
    except RuntimeError as e:
        raise ValueError(str(e))
    except requests.RequestException:
        raise ValueError("intervals.icu nicht erreichbar, bitte spaeter erneut")
    _write_private(ICU_CRED_FILE, {"apiKey": key})
    return {"ok": True}


def clear_icu_key() -> None:
    ICU_CRED_FILE.unlink(missing_ok=True)


def _is_mywhoosh(a: dict) -> bool:
    if a.get("source") in ("GARMIN_CONNECT", "STRAVA"):
        return False   # Garmin-Uploads (auch unsere eigenen) und Strava-Kopien nie zurueckspielen
    text = " ".join(str(a.get(k) or "") for k in ("name", "device_name", "external_id")).lower()
    return "mywhoosh" in text or "whoosh" in text


def _icu_items(lookback_days: int) -> list[dict]:
    key = _icu_key()
    oldest = (datetime.now() - timedelta(days=lookback_days + 1)).date().isoformat()
    acts = _icu_get("/athlete/0/activities", key, oldest=oldest, limit=50).json()
    items = []
    for a in acts if isinstance(acts, list) else []:
        if not _is_mywhoosh(a) or not a.get("id"):
            continue
        try:
            start = datetime.fromisoformat(str(a.get("start_date")).replace("Z", "+00:00"))
        except ValueError:
            start = None
        aid = str(a["id"])
        items.append({"key": f"icu:{aid}", "start": start, "name": str(a.get("name") or ""),
                      "fetch": lambda dest, aid=aid: _icu_download(aid, key, dest)})
    return items


def _icu_download(aid: str, key: str, dest: Path) -> Path:
    data = _icu_get(f"/activity/{aid}/file", key).content
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    if data[8:12] != b".FIT":
        kind = "GPX" if b"<gpx" in data[:400].lower() else "unbekanntes Format"
        raise NotFit(f"intervals.icu hat hierfuer nur {kind} statt FIT")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest


def _mw_items() -> list[dict]:
    token, _ = _session()
    try:
        raw = _mw_activities(token)
    except Unauthorized:           # Token abgelaufen -> einmal neu anmelden
        token, _ = _session(force_login=True)
        raw = _mw_activities(token)
    return [{"key": _act_id(a), "start": _act_time(a), "name": str(a.get("title") or a.get("routeName") or ""),
             "fetch": lambda dest, a=a, token=token: _mw_download(a, token, dest)}
            for a in raw if _act_id(a)]


def source_ready() -> bool:
    return ICU_CRED_FILE.exists() if get_settings()["source"] == "intervals" else has_credentials()


# ---------------------------------------------------------------- Titel

def _title(name: str) -> str:
    """MyWhoosh-Name der Fahrt; 'MyWhoosh' steht immer im Titel."""
    name = name.strip()
    if not name:
        return "MyWhoosh"
    return name if "mywhoosh" in name.lower() else f"MyWhoosh - {name}"


def _garmin_activity_id(res: Any, start: datetime | None) -> int | None:
    """Garmin-Aktivitaets-ID aus der Upload-Antwort, sonst ueber die Startzeit in der Aktivitaetsliste."""
    try:
        ok = (res or {}).get("detailedImportResult", {}).get("successes") or []
        if ok and ok[0].get("internalId"):
            return int(ok[0]["internalId"])
    except (AttributeError, TypeError, ValueError):
        pass
    if not start:
        return None
    for _ in range(4):  # Garmin verarbeitet den Upload asynchron
        time.sleep(5)
        for a in syncer._call("get_activities", 0, 8) or []:
            try:
                g = datetime.strptime(a["startTimeGMT"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            except (KeyError, ValueError):
                continue
            if abs((g - start).total_seconds()) < 180:
                return int(a["activityId"])
    return None


def _finalize(res: Any, it: dict, activity_type: str) -> str | None:
    """Titel und Aktivitaetstyp in Garmin setzen. Gibt eine Warnung zurueck, wenn etwas nicht klappt
    (der Upload bleibt gueltig)."""
    try:
        gid = _garmin_activity_id(res, it["start"])
        if not gid:
            return "Titel/Typ nicht gesetzt (Aktivitaet bei Garmin noch nicht gefunden)"
        problems = []
        try:
            syncer._call("set_activity_name", gid, _title(it["name"]))
        except Paused:
            raise
        except Exception as e:
            problems.append(f"Titel ({str(e)[:50]})")
        if activity_type in ACTIVITY_TYPES:
            try:
                syncer._call("set_activity_type", gid, *ACTIVITY_TYPES[activity_type])
            except Paused:
                raise
            except Exception as e:
                problems.append(f"Typ ({str(e)[:50]})")
        return ("nicht gesetzt: " + ", ".join(problems)) if problems else None
    except Paused:
        raise


# ---------------------------------------------------------------- Lauf

_run_lock = threading.Lock()


def _log(entry: dict) -> None:
    hist = (db.get_state("mw_log") or [])[-19:]
    hist.append({"at": datetime.now().isoformat(timespec="seconds"), **entry})
    db.set_state("mw_log", hist)


def _same_start(start: datetime | None, starts: list[str]) -> bool:
    if not start:
        return False
    for iso in starts:
        try:
            if abs((datetime.fromisoformat(iso) - start).total_seconds()) < 180:
                return True
        except ValueError:
            continue
    return False


def run(dry: bool = False) -> dict:
    """Einmal pruefen und neue Fahrten hochladen. Gibt eine Zusammenfassung zurueck."""
    if not _run_lock.acquire(blocking=False):
        return {"ok": False, "message": "Laeuft bereits"}
    try:
        s = get_settings()
        items = _icu_items(s["lookbackDays"]) if s["source"] == "intervals" else _mw_items()
        items.sort(key=lambda i: i["start"] or datetime.min.replace(tzinfo=timezone.utc))
        done = db.get_state("mw_done") or {}
        starts = db.get_state("mw_done_starts") or []   # Startzeiten bereits uebertragener Fahrten (UTC)
        since = datetime.now(timezone.utc) - timedelta(days=s["lookbackDays"])
        found: list[dict] = []
        uploaded = dupes = 0
        errors: list[str] = []
        for it in items:
            t, key = it["start"], it["key"]
            item = {"id": key, "time": t.astimezone().isoformat(timespec="minutes") if t else None,
                    "name": it["name"][:60]}
            if key in done:
                item["status"] = "bereits uebertragen"
            elif t and t < since:
                item["status"] = "zu alt"
            elif _same_start(t, starts):
                item["status"] = "bereits uebertragen (gleiche Startzeit)"   # z. B. Doppel-Import in intervals.icu
            elif dry:
                item["status"] = "neu"
            else:
                safe = re.sub(r"[^A-Za-z0-9_-]", "_", key)
                try:
                    fit = it["fetch"](FIT_DIR / f"mywhoosh_{safe}.fit")
                    path = _fake_edge_840(fit) if s["fakeDevice"] else fit
                    try:
                        res = syncer._call("upload_activity", str(path))
                        item["status"] = "hochgeladen"
                        uploaded += 1
                        warn = _finalize(res, it, s["activityType"])
                        if warn:
                            item["status"] += f" ({warn})"
                    except Paused:
                        raise
                    except Exception as e:
                        if "409" in str(e) or "uplicate" in str(e):
                            item["status"] = "bei Garmin schon vorhanden"
                            dupes += 1
                        else:
                            raise
                    done[key] = datetime.now().isoformat(timespec="seconds")
                    if t:
                        starts = (starts + [t.isoformat()])[-200:]
                        db.set_state("mw_done_starts", starts)
                except NotFit as e:
                    item["status"] = "uebersprungen: " + str(e)
                    done[key] = "skipped"      # nicht bei jedem Lauf erneut versuchen
                except Paused:
                    raise
                except Exception as e:
                    item["status"] = "Fehler: " + (str(e)[:100] or e.__class__.__name__)
                    errors.append(item["status"])
                db.set_state("mw_done", done)
            found.append(item)
        if uploaded:
            syncer.trigger()  # neue Aktivitaet ins Dashboard holen
        msg = ("Pruefung: %d neu" % sum(i["status"] == "neu" for i in found)) if dry else (
            f"{uploaded} hochgeladen" + (f", {dupes} schon vorhanden" if dupes else "") if (uploaded or dupes) else "Nichts Neues")
        if errors:
            msg += f" - {len(errors)} Fehler: {errors[0]}"
        res = {"ok": not errors, "message": msg, "uploaded": uploaded, "items": found[-10:]}
        if not dry:
            _log({"ok": not errors, "message": msg})
        return res
    except Paused:
        msg = "Garmin pausiert oder nicht angemeldet - in den Einstellungen neu anmelden"
        if not dry:
            _log({"ok": False, "message": msg})
        return {"ok": False, "message": msg}
    except Exception as e:
        msg = str(e)[:200] or e.__class__.__name__
        log.warning("MyWhoosh-Lauf fehlgeschlagen: %s", msg)
        if not dry:
            _log({"ok": False, "message": msg})
        return {"ok": False, "message": msg}
    finally:
        _run_lock.release()


def _last_slot(times: list[str], now: datetime) -> datetime:
    """Letzter geplanter Zeitpunkt, der nicht in der Zukunft liegt."""
    slots = []
    for t in times:
        h, m = map(int, t.split(":"))
        d = now.replace(hour=h, minute=m, second=0, microsecond=0)
        slots.append(d if d <= now else d - timedelta(days=1))
    return max(slots)


def next_run() -> str | None:
    s = get_settings()
    if not s["enabled"] or not source_ready():
        return None
    now = datetime.now()
    cands = []
    for t in s["times"]:
        h, m = map(int, t.split(":"))
        d = now.replace(hour=h, minute=m, second=0, microsecond=0)
        cands.append(d if d > now else d + timedelta(days=1))
    return min(cands).isoformat(timespec="minutes")


def _scheduler() -> None:
    time.sleep(10)
    while True:
        try:
            s = get_settings()
            if s["enabled"] and source_ready():
                now = datetime.now()
                slot = _last_slot(s["times"], now).timestamp()
                handled = db.get_state("mw_slot_done", 0) or 0
                retry_at = db.get_state("mw_retry_at", 0) or 0
                if slot > handled and time.time() >= retry_at:
                    res = run()
                    if res["ok"] or res["message"] == "Laeuft bereits":
                        db.set_state("mw_slot_done", slot)
                        db.set_state("mw_retries", 0)
                    else:
                        n = (db.get_state("mw_retries", 0) or 0) + 1
                        db.set_state("mw_retries", n)
                        if n >= MAX_RETRIES:
                            db.set_state("mw_slot_done", slot)  # aufgeben bis zum naechsten Slot
                            db.set_state("mw_retries", 0)
                        else:
                            db.set_state("mw_retry_at", time.time() + RETRY_AFTER)
        except Exception:
            log.exception("Scheduler-Fehler")
        _wake.wait(timeout=30)
        _wake.clear()


_wake = threading.Event()
_thread: threading.Thread | None = None


def syncer_wake() -> None:
    _wake.set()


def start() -> None:
    global _thread
    if _thread:
        return
    # Beim ersten Aktivieren nicht sofort einen verpassten Slot nachholen
    if db.get_state("mw_slot_done") is None:
        db.set_state("mw_slot_done", time.time())
    _thread = threading.Thread(target=_scheduler, name="mywhoosh", daemon=True)
    _thread.start()


def status() -> dict[str, Any]:
    s = get_settings()
    return {
        **s,
        "hasCredentials": has_credentials(),
        "hasIcuKey": ICU_CRED_FILE.exists(),
        "ready": source_ready(),
        "session": _session_info(),
        "email": db.get_state("mw_email"),
        "nextRun": next_run(),
        "log": list(reversed(db.get_state("mw_log") or []))[:8],
    }


# ---------------------------------------------------------------- Garmin-Login (mit MFA)

_pending: dict[str, Any] = {}


def garmin_status() -> dict:
    tp = Path(TOKENSTORE)
    tokens = any(tp.iterdir()) if tp.is_dir() else tp.exists()
    err = db.get_state("error") or {}
    return {"hasTokens": bool(tokens), "authError": err.get("kind") == "auth",
            "mfaPending": bool(_pending) and time.time() - _pending.get("ts", 0) < 600}


def garmin_login(email: str, password: str) -> dict:
    if not email or not password:
        raise ValueError("E-Mail und Passwort noetig")
    api = Garmin(email.strip(), password, return_on_mfa=True)
    status, _ = api.client.login(email.strip(), password, return_on_mfa=True)
    if status == "needs_mfa":
        _pending.clear()
        _pending.update(api=api, ts=time.time())
        return {"mfa": True}
    api._load_profile_and_settings()
    _store(api)
    return {"mfa": False, "name": api.get_full_name()}


def garmin_mfa(code: str) -> dict:
    api = _pending.get("api")
    if not api or time.time() - _pending.get("ts", 0) > 600:
        _pending.clear()
        raise ValueError("Login abgelaufen, bitte erneut mit E-Mail und Passwort anmelden")
    api.resume_login(None, code.strip())
    _store(api)
    _pending.clear()
    return {"mfa": False, "name": api.get_full_name()}


def _store(api: Garmin) -> None:
    Path(TOKENSTORE).parent.mkdir(parents=True, exist_ok=True)
    api.client.dump(TOKENSTORE)
    with syncer._call_lock:
        syncer.api = None          # naechster Aufruf nutzt die neuen Tokens
    syncer.backoff_until = 0
    db.set_state("error", None)
    syncer.trigger()
