"""Passwort-Login fuer den Kalorien-Tracker (Muster aus dem Training-Dashboard).

Gespeichert wird nur ein scrypt-Hash plus ein zufaelliges Session-Secret in
`data/auth.json`. Die Session ist ein signiertes Cookie (HMAC), gueltig fuer
ein Jahr. Ein neues Passwort erzeugt ein neues Secret und meldet damit alle
Geraete ab.

Passwort setzen (interaktiv, auf dem Pi):
    docker compose run --rm kalorien-tracker python -m app.auth
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from getpass import getpass

from . import db

AUTH_FILE = db.DATA_DIR / "auth.json"
COOKIE = "kt_session"
SESSION_DAYS = 365
MAX_FAILS = 5          # Fehlversuche pro IP ...
FAIL_WINDOW = 15 * 60  # ... innerhalb dieses Zeitfensters

_fails: dict[str, list[float]] = {}


def _load() -> dict | None:
    try:
        return json.loads(AUTH_FILE.read_text())
    except FileNotFoundError:
        return None


def configured() -> bool:
    return _load() is not None


def _hash(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)


def set_password(password: str) -> None:
    salt = secrets.token_bytes(16)
    data = {
        "salt": salt.hex(),
        "hash": _hash(password, salt).hex(),
        "secret": secrets.token_hex(32),
    }
    db.DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = AUTH_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    os.chmod(tmp, 0o600)
    tmp.replace(AUTH_FILE)


def blocked(ip: str) -> bool:
    now = time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < FAIL_WINDOW]
    _fails[ip] = recent
    return len(recent) >= MAX_FAILS


def check_password(password: str, ip: str) -> bool:
    data = _load()
    if not data or blocked(ip):
        return False
    ok = hmac.compare_digest(_hash(password, bytes.fromhex(data["salt"])).hex(), data["hash"])
    if not ok:
        _fails.setdefault(ip, []).append(time.time())
    else:
        _fails.pop(ip, None)
    return ok


def _sign(secret: str, payload: str) -> str:
    return hmac.new(bytes.fromhex(secret), payload.encode(), hashlib.sha256).hexdigest()


def new_session() -> str:
    data = _load()
    payload = f"{int(time.time())}.{secrets.token_hex(8)}"
    return f"{payload}.{_sign(data['secret'], payload)}"


def valid_session(token: str | None) -> bool:
    data = _load()
    if not data or not token or token.count(".") != 2:
        return False
    issued, nonce, sig = token.split(".")
    if not hmac.compare_digest(sig, _sign(data["secret"], f"{issued}.{nonce}")):
        return False
    try:
        return time.time() - int(issued) < SESSION_DAYS * 86400
    except ValueError:
        return False


def main() -> None:
    pw = getpass("Neues Tracker-Passwort: ")
    if len(pw) < 10:
        raise SystemExit("Bitte mindestens 10 Zeichen.")
    if getpass("Wiederholen: ") != pw:
        raise SystemExit("Passwoerter stimmen nicht ueberein.")
    set_password(pw)
    print("Passwort gesetzt. Alle bisherigen Sitzungen sind abgemeldet.")


if __name__ == "__main__":
    main()
