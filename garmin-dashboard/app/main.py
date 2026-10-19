"""Webserver: JSON-API + PWA-Frontend. Startet den Sync-Dienst im Hintergrund."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from . import auth, mywhoosh, nutrition, season, views
from .sync import Paused, syncer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
SYNC_ENABLED = os.getenv("SYNC_ENABLED", "1") == "1"
# Nur zum lokalen Entwickeln abschaltbar
AUTH_ENABLED = os.getenv("AUTH_ENABLED", "1") == "1"
# Ohne Login erreichbar: Login-Seite und was sie zum Rendern braucht
PUBLIC = {"/healthz", "/login.html", "/login.js", "/styles.css", "/manifest.webmanifest", "/api/login"}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path == "/healthz":
        return Response("ok", media_type="text/plain")
    if path.startswith("/internal/"):
        # Server zu Server (Kalorien-Tracker): Token + Docker-Netz statt Login
        if not nutrition.internal_allowed(request.headers.get("authorization", ""),
                                          request.client.host if request.client else None):
            return JSONResponse({"error": "forbidden"}, status_code=403)
    elif AUTH_ENABLED and path not in PUBLIC and not path.startswith("/icons/"):
        if not auth.valid_session(request.cookies.get(auth.COOKIE)):
            if path.startswith("/api/"):
                return JSONResponse({"error": "login"}, status_code=401)
            return RedirectResponse("/login.html", status_code=303)
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'"
    )
    if path.startswith(("/api/", "/internal/")):
        response.headers["Cache-Control"] = "no-store"
    elif "cache-control" not in response.headers:
        # Statische Dateien immer per ETag pruefen, sonst bleiben alte app.js/styles.css haengen
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.post("/api/login")
async def api_login(request: Request):
    ip = request.client.host if request.client else "?"
    if not auth.configured():
        return JSONResponse({"error": "Noch kein Passwort gesetzt (python -m app.auth)."}, status_code=503)
    if auth.blocked(ip):
        return JSONResponse({"error": "Zu viele Fehlversuche. Bitte 15 Minuten warten."}, status_code=429)
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not auth.check_password(str(body.get("password", ""))[:256], ip):
        await asyncio.sleep(1)  # Raten bremsen
        return JSONResponse({"error": "Passwort falsch."}, status_code=401)
    res = JSONResponse({"ok": True})
    res.set_cookie(auth.COOKIE, auth.new_session(), max_age=auth.SESSION_DAYS * 86400,
                   httponly=True, samesite="strict", secure=request.url.scheme == "https")
    return res


@app.post("/api/logout")
def api_logout():
    res = JSONResponse({"ok": True})
    res.delete_cookie(auth.COOKIE)
    return res


@app.on_event("startup")
def _start() -> None:
    if SYNC_ENABLED:
        syncer.start()
        mywhoosh.start()


def _parse_date(value: str | None) -> date:
    if not value:
        return date.today()
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, "Datum im Format YYYY-MM-DD")


@app.get("/api/today")
def api_today():
    return {**views.today_view(), "sync": syncer.status()}


@app.get("/api/week")
def api_week(start: str | None = None):
    return views.week(_parse_date(start))


@app.get("/api/sport/{sport}")
def api_sport(sport: str, weeks: int = 12):
    if sport not in ("running", "cycling", "strength"):
        raise HTTPException(404)
    return views.sport_view(sport, max(4, min(weeks, 52)))


@app.get("/api/overview")
def api_overview(year: int | None = None, weeks: int = 12):
    return views.overview_view(year, max(4, min(weeks, 52)))


@app.post("/api/events")
async def api_event_add(request: Request):
    try:
        body = await request.json()
        return season.add_event(str(body.get("name") or ""), str(body.get("date") or ""),
                                str(body.get("kind") or "other"), str(body.get("detail") or ""))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, "Name, Datum (JJJJ-MM-TT) und Art noetig")


@app.delete("/api/events/{event_id}")
def api_event_delete(event_id: int):
    if not season.delete_event(event_id):
        raise HTTPException(404)
    return {"ok": True}


@app.get("/api/health")
def api_health(days: int = 30):
    return views.health_view(max(7, min(days, 365)))


@app.get("/api/activity/{act_id}")
def api_activity(act_id: int):
    data = views.activity_view(act_id)
    if not data:
        raise HTTPException(404)
    return data


@app.get("/api/status")
def api_status():
    return syncer.status()


@app.post("/api/sync")
def api_sync():
    return {"started": syncer.trigger(), **syncer.status()}


# --- Einstellungen: MyWhoosh -> Garmin, Garmin-Login ---------------------------------

async def _json(request: Request) -> dict:
    try:
        body = await request.json()
        return body if isinstance(body, dict) else {}
    except Exception:
        return {}


@app.get("/api/settings")
def api_settings():
    return {"garmin": mywhoosh.garmin_status(), "mywhoosh": mywhoosh.status(), "sync": syncer.status()}


@app.put("/api/settings/mywhoosh")
async def api_settings_mywhoosh(request: Request):
    try:
        mywhoosh.set_settings(await _json(request))
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e))
    return api_settings()


@app.put("/api/settings/mywhoosh/credentials")
async def api_settings_mw_credentials(request: Request):
    body = await _json(request)
    try:
        mywhoosh.set_credentials(str(body.get("email", "")), str(body.get("password", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return api_settings()


@app.put("/api/settings/mywhoosh/token")
async def api_settings_mw_token(request: Request):
    body = await _json(request)
    try:
        return await asyncio.to_thread(mywhoosh.set_web_token, str(body.get("token", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.put("/api/settings/intervals")
async def api_settings_icu(request: Request):
    body = await _json(request)
    try:
        await asyncio.to_thread(mywhoosh.set_icu_key, str(body.get("apiKey", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return api_settings()


@app.delete("/api/settings/intervals")
def api_settings_icu_delete():
    mywhoosh.clear_icu_key()
    return api_settings()


@app.delete("/api/settings/mywhoosh/credentials")
def api_settings_mw_credentials_delete():
    mywhoosh.clear_credentials()
    return api_settings()


@app.post("/api/mywhoosh/run")
async def api_mywhoosh_run(request: Request):
    body = await _json(request)
    res = await asyncio.to_thread(mywhoosh.run, bool(body.get("dry")))
    return {**res, "settings": api_settings()}


@app.post("/api/garmin/login")
async def api_garmin_login(request: Request):
    ip = request.client.host if request.client else "?"
    body = await _json(request)
    try:
        return await asyncio.to_thread(mywhoosh.garmin_login, str(body.get("email", "")), str(body.get("password", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logging.getLogger("garmin-login").warning("Garmin-Login fehlgeschlagen (%s): %s", ip, e.__class__.__name__)
        return JSONResponse({"error": "Anmeldung bei Garmin fehlgeschlagen: " + str(e)[:140]}, status_code=502)


@app.post("/api/garmin/mfa")
async def api_garmin_mfa(request: Request):
    body = await _json(request)
    try:
        return await asyncio.to_thread(mywhoosh.garmin_mfa, str(body.get("code", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        return JSONResponse({"error": "Code nicht akzeptiert: " + str(e)[:140]}, status_code=502)


@app.get("/internal/v1/energy")
def internal_energy(request: Request):
    """Garmin-Verbrauch fuer den Kalorien-Tracker: ?date=YYYY-MM-DD oder ?from=&to=."""
    q = request.query_params
    if q.get("date"):
        d = _parse_date(q["date"])
        e = nutrition.energy(d, d)
        return {**e["days"][0], "weightKg": e["weightKg"]}
    end = _parse_date(q.get("to"))
    start = _parse_date(q.get("from") or end.isoformat())
    if start > end or (end - start).days > 400:
        raise HTTPException(400, "Zeitraum ungueltig")
    return nutrition.energy(start, end)


@app.post("/internal/v1/hydration")
async def internal_hydration(request: Request):
    """Wasser aus dem Kalorien-Tracker nach Garmin: {date, time, ml}. 503 = spaeter erneut versuchen."""
    try:
        body = await request.json()
        day = _parse_date(str(body.get("date"))).isoformat()
        ml = float(body.get("ml"))
    except (ValueError, TypeError):
        raise HTTPException(400, "date und ml noetig")
    if not -5000 <= ml <= 5000 or ml == 0:
        raise HTTPException(400, "ml ausserhalb des Bereichs")
    try:
        await asyncio.to_thread(syncer.add_hydration, day, body.get("time"), ml)
    except Paused:
        return JSONResponse({"error": "garmin_paused", **syncer.status()}, status_code=503)
    except Exception as e:
        logging.getLogger("hydration").warning("Garmin-Hydration fehlgeschlagen: %s", e)
        return JSONResponse({"error": str(e)[:160]}, status_code=502)
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/sw.js")
def service_worker():
    return FileResponse(WEB_DIR / "sw.js", media_type="text/javascript",
                        headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
