"""Webserver: JSON-API, PWA-Frontend und die interne Schnittstelle fuers Dashboard."""

from __future__ import annotations

import asyncio
import hmac
import ipaddress
import logging
import os
import threading
import time
from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from . import auth, budget, captured, db, fooddb, foods, hydration, templates, views

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
# Nur zum lokalen Entwickeln abschaltbar
AUTH_ENABLED = os.getenv("AUTH_ENABLED", "1") == "1"
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")
# /internal nur aus dem Docker-Netz homelab-apps (nicht ueber den HTTPS-Proxy)
INTERNAL_NET = ipaddress.ip_network(os.getenv("INTERNAL_NET", "172.30.0.0/24"))
PROXY_IP = os.getenv("PROXY_IP", "172.30.0.10")
# Ohne Login erreichbar: Login-Seite und was sie zum Rendern braucht
PUBLIC = {"/healthz", "/login.html", "/login.js", "/styles.css", "/manifest.webmanifest", "/api/login"}

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def _energy_refresher() -> None:
    """Haelt den Garmin-Cache warm, damit auch /internal/v1/summary aktuelle Budgets hat."""
    while True:
        try:
            today = date.today()
            budget.refresh(today - timedelta(days=7), today)
        except Exception as e:  # nie den Thread verlieren
            logging.getLogger("budget").warning("Hintergrund-Abruf fehlgeschlagen: %s", e)
        time.sleep(10 * 60)


@app.on_event("startup")
def _start() -> None:
    if budget.enabled():
        threading.Thread(target=_energy_refresher, name="energy", daemon=True).start()
        hydration.start()


def _internal_allowed(request: Request) -> bool:
    if not INTERNAL_TOKEN:
        return False
    sent = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(sent.encode(), INTERNAL_TOKEN.encode()):
        return False
    try:
        ip = ipaddress.ip_address(request.client.host if request.client else "")
    except ValueError:
        return False
    gateway = INTERNAL_NET.network_address + 1
    return ip in INTERNAL_NET and str(ip) not in (PROXY_IP, str(gateway))


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path == "/healthz":
        return Response("ok", media_type="text/plain")
    if path.startswith("/internal/"):
        if not _internal_allowed(request):
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
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob: https://images.openfoodfacts.org; "
        "style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; "
        "media-src 'self' blob:; frame-ancestors 'none'; form-action 'self'"
    )
    if path.startswith(("/api/", "/internal/")):
        response.headers["Cache-Control"] = "no-store"
    elif "Cache-Control" not in response.headers:
        # Immer per ETag nachfragen, damit ein Deploy sofort ankommt (ohne Build-Hashes)
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(ValueError)
async def value_error(_: Request, exc: ValueError):
    return JSONResponse({"error": str(exc)}, status_code=400)


async def _body(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _date(value: str | None, default: date | None = None) -> date:
    if not value:
        return default or date.today()
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(400, "Datum im Format YYYY-MM-DD")


# --- Login -------------------------------------------------------------------------

@app.post("/api/login")
async def api_login(request: Request):
    ip = request.client.host if request.client else "?"
    if not auth.configured():
        return JSONResponse({"error": "Noch kein Passwort gesetzt (python -m app.auth)."}, status_code=503)
    if auth.blocked(ip):
        return JSONResponse({"error": "Zu viele Fehlversuche. Bitte 15 Minuten warten."}, status_code=429)
    body = await _body(request)
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


# --- Ansichten ------------------------------------------------------------------------

@app.get("/api/day")
def api_day(date: str | None = None):
    return views.day_view(_date(date).isoformat())


@app.get("/api/week")
def api_week(start: str | None = None):
    return views.week_view(_date(start).isoformat())


@app.get("/api/history")
def api_history(days: int = 30):
    return views.history_view(max(7, min(days, 400)))


# --- Lebensmittel ----------------------------------------------------------------------

@app.get("/api/search")
def api_search(q: str = ""):
    return {"q": q, "results": foods.search(q[:80])}


@app.get("/api/lists")
def api_lists():
    return {"recent": foods.recent(), "favorites": foods.favorites(),
            "recipes": foods.recipes(), "own": foods.products()}


@app.get("/api/food/{ref}")
def api_food(ref: str):
    f = foods.get(ref)
    if not f:
        raise HTTPException(404)
    f["favorite"] = foods.is_favorite(f["ref"])
    return f


@app.get("/api/barcode/{code}")
def api_barcode(code: str):
    res = foods.by_barcode(code[:32])
    if res.get("food"):
        res["food"]["favorite"] = foods.is_favorite(res["food"]["ref"])
    return res


# Eigene Produkte (captured.db)
@app.post("/api/product")
async def api_product_create(request: Request):
    return {"ref": foods.save_product(await _body(request))}


@app.put("/api/product/{pid}")
async def api_product_update(pid: int, request: Request):
    return {"ref": foods.save_product(await _body(request), pid)}


@app.delete("/api/food/{ref}")
def api_food_delete(ref: str):
    foods.delete_ref(ref)
    return {"ok": True}


@app.post("/api/food/{ref}/restore")
def api_food_restore(ref: str):
    foods.delete_ref(ref, undo=True)
    return {"ok": True}


@app.post("/api/recipe")
async def api_recipe_create(request: Request):
    return {"ref": f"own:{foods.save_recipe(await _body(request))}"}


@app.put("/api/recipe/{fid}")
async def api_recipe_update(fid: int, request: Request):
    foods.save_recipe(await _body(request), fid)
    return {"ref": f"own:{fid}"}


@app.post("/api/favorite")
async def api_favorite(request: Request):
    body = await _body(request)
    ref = str(body.get("ref") or "")
    if not foods.get(ref):
        raise HTTPException(404)
    foods.set_favorite(ref, bool(body.get("on")))
    return {"ok": True}


# --- Eintraege & Wasser -----------------------------------------------------------------

@app.post("/api/entries")
async def api_entry_create(request: Request):
    return {"id": views.create_entry(await _body(request))}


@app.patch("/api/entries/{eid}")
async def api_entry_update(eid: int, request: Request):
    try:
        views.update_entry(eid, await _body(request))
    except KeyError:
        raise HTTPException(404)
    return {"ok": True}


@app.delete("/api/entries/{eid}")
def api_entry_delete(eid: int):
    views.delete_entry(eid)
    return {"ok": True}


@app.post("/api/entries/{eid}/restore")
def api_entry_restore(eid: int):
    views.delete_entry(eid, undo=True)
    return {"ok": True}


@app.post("/api/entries/copy")
async def api_entry_copy(request: Request):
    body = await _body(request)
    ids = [int(x) for x in body.get("ids", []) if str(x).isdigit()]
    new_ids = views.copy_entries(ids, str(body.get("day") or date.today().isoformat()), body.get("meal"))
    return {"copied": len(new_ids), "ids": new_ids}


@app.post("/api/water")
async def api_water(request: Request):
    body = await _body(request)
    return {"id": views.add_water(str(body.get("day") or date.today().isoformat()), body.get("ml"))}


@app.delete("/api/water/{wid}")
def api_water_delete(wid: int):
    views.delete_water(wid)
    return {"ok": True}


@app.post("/api/water/{wid}/restore")
def api_water_restore(wid: int):
    views.delete_water(wid, undo=True)
    return {"ok": True}


# --- Gespeicherte Mahlzeiten ----------------------------------------------------------------

@app.get("/api/templates")
def api_templates():
    return {"templates": templates.list_all()}


@app.post("/api/templates")
async def api_template_create(request: Request):
    return {"id": templates.save(await _body(request))}


@app.post("/api/templates/from-entries")
async def api_template_from_entries(request: Request):
    b = await _body(request)
    return {"id": templates.from_entries(str(b.get("day") or date.today().isoformat()), str(b.get("meal")),
                                         str(b.get("name") or ""))}


@app.get("/api/templates/{tid}")
def api_template(tid: int):
    t = templates.get(tid)
    if not t:
        raise HTTPException(404)
    return t


@app.put("/api/templates/{tid}")
async def api_template_update(tid: int, request: Request):
    return {"id": templates.save(await _body(request), tid)}


@app.delete("/api/templates/{tid}")
def api_template_delete(tid: int):
    templates.delete(tid)
    return {"ok": True}


@app.post("/api/templates/{tid}/restore")
def api_template_restore(tid: int):
    templates.delete(tid, undo=True)
    return {"ok": True}


@app.post("/api/templates/{tid}/log")
async def api_template_log(tid: int, request: Request):
    try:
        return {"ids": templates.log(tid, await _body(request))}
    except KeyError:
        raise HTTPException(404)


@app.post("/api/entries/delete-many")
async def api_entries_delete_many(request: Request):
    """Rueckgaengig fuer "Mahlzeit eingetragen" (mehrere Eintraege auf einmal)."""
    b = await _body(request)
    ids = [int(x) for x in b.get("ids", []) if str(x).isdigit()][:100]
    for eid in ids:
        views.delete_entry(eid, undo=bool(b.get("undo")))
    return {"ok": True, "count": len(ids)}


# --- Einstellungen & Info -------------------------------------------------------------------

@app.get("/api/settings")
def api_settings():
    s = db.settings()
    return {**s, "effectiveWeightKg": budget.weight(s)}


@app.put("/api/settings")
async def api_settings_put(request: Request):
    body = await _body(request)
    clean = {}
    if body.get("goal") in ("maintain", "lose", "gain"):
        clean["goal"] = body["goal"]
    if isinstance(body.get("goalOffset"), dict):
        clean["goalOffset"] = {k: max(-1500, min(1500, float(body["goalOffset"].get(k, 0) or 0)))
                               for k in ("maintain", "lose", "gain")}
    ranges = {"weightKg": (30, 250, "Körpergewicht"), "proteinPerKg": (0.5, 4, "Eiweiß pro kg"),
              "fatPerKg": (0.3, 3, "Fett pro kg"), "fiberGoal": (0, 100, "Ballaststoffe"), "sugarMax": (0, 300, "Zucker"),
              "saltMax": (0, 30, "Salz"), "waterGoalMl": (0, 8000, "Wasser"), "fallbackBudget": (800, 6000, "Ersatzbudget"),
              "waterPerTrainingHour": (0, 1500, "Wasser pro Trainingsstunde")}
    for k, (lo, hi, label) in ranges.items():
        if k in body:
            v = foods._num(body[k], lo, hi)
            if v is None and body[k] not in (None, ""):
                raise ValueError(f"{label}: erlaubt sind {lo:g} bis {hi:g}".replace(".", ","))
            clean[k] = v if k == "weightKg" else (v if v is not None else db.DEFAULT_SETTINGS[k])
    if "eveningHint" in body:
        clean["eveningHint"] = bool(body["eveningHint"])
    db.set_settings(clean)
    return api_settings()


@app.get("/api/info")
def api_info():
    return {"sources": {s: fooddb.meta(s) for s in fooddb.SOURCES},
            "own": captured.count(),
            "recipes": db.one("SELECT COUNT(*) n FROM my_foods WHERE deleted IS NULL AND kind='recipe'")["n"],
            "garmin": budget.status()}


# --- Intern: Dashboard -> Tracker ------------------------------------------------------------

@app.get("/internal/v1/summary")
def internal_summary(request: Request):
    q = request.query_params
    end = _date(q.get("to"))
    start = _date(q.get("from"), end - timedelta(days=6))
    if start > end or (end - start).days > 400:
        raise HTTPException(400, "Zeitraum ungültig")
    return {"days": views.summary(start, end)}


# --- Frontend ----------------------------------------------------------------------------------

@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/sw.js")
def service_worker():
    return FileResponse(WEB_DIR / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
