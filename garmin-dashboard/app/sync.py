"""Intelligenter Garmin-Sync.

Grundsaetze, damit die inoffizielle API uns nicht sperrt:
- Jeder Abruf laeuft ueber `_call`: global gedrosselt, mit Backoff bei 429
  und bei Auth-Fehlern.
- Abgeschlossene Tage (aelter als gestern) werden als `final` markiert und nie
  wieder geholt. Nur heute/gestern werden aktualisiert.
- Aktivitaeten: nur die Liste wird regelmaessig geprueft, Details (Splits,
  Zeitreihen, Saetze) werden genau einmal pro neuer Aktivitaet geholt.
- Die Frequenz haengt von der Tageszeit ab: morgens eng getaktet, bis die
  Schlafdaten da sind, nachts selten.
- Die Historie wird im Hintergrund in kleinen Portionen nachgeladen.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

from . import db

log = logging.getLogger("sync")

TOKENSTORE = os.getenv("GARMINTOKENS", str(db.DATA_DIR / "tokens"))
MIN_CALL_GAP = float(os.getenv("SYNC_MIN_CALL_GAP", "1.5"))  # Sekunden zwischen API-Aufrufen
HISTORY_DAYS = int(os.getenv("SYNC_HISTORY_DAYS", "365"))    # Aktivitaeten & Trends
DAILY_HISTORY_DAYS = int(os.getenv("SYNC_DAILY_HISTORY_DAYS", "90"))  # Tageswerte einzeln
MANUAL_MIN_GAP = 60  # Sekunden zwischen zwei manuellen Syncs

RUNNING = {"running", "treadmill_running", "trail_running", "track_running",
           "virtual_run", "indoor_running", "street_running"}
CYCLING = {"cycling", "road_biking", "indoor_cycling", "virtual_ride",
           "gravel_cycling", "mountain_biking", "cyclocross", "e_bike_fitness"}
STRENGTH = {"strength_training", "hiit", "indoor_cardio", "fitness_equipment"}


def sport_of(type_key: str) -> str:
    if type_key in RUNNING:
        return "running"
    if type_key in CYCLING:
        return "cycling"
    if type_key in STRENGTH:
        return "strength"
    return "other"


class Paused(Exception):
    """Sync pausiert (Rate-Limit oder Auth) - Task spaeter erneut versuchen."""


# --- Reduktion der Rohdaten ---------------------------------------------------

SUMMARY_KEYS = (
    "totalKilocalories", "activeKilocalories", "totalSteps", "dailyStepGoal",
    "totalDistanceMeters", "moderateIntensityMinutes", "vigorousIntensityMinutes",
    "intensityMinutesGoal", "floorsAscended", "restingHeartRate",
    "lastSevenDaysAvgRestingHeartRate", "averageStressLevel", "maxStressLevel",
    "stressQualifier", "bodyBatteryChargedValue", "bodyBatteryDrainedValue",
    "bodyBatteryHighestValue", "bodyBatteryLowestValue", "bodyBatteryMostRecentValue",
    "bodyBatteryAtWakeTime", "bodyBatteryDuringSleep", "lowStressDuration",
    "mediumStressDuration", "highStressDuration", "restStressDuration",
)


def reduce_summary(d: dict | None) -> dict | None:
    if not d:
        return None
    return {k: d.get(k) for k in SUMMARY_KEYS}


def reduce_sleep(d: dict | None) -> dict | None:
    if not d or not d.get("dailySleepDTO"):
        return None
    dto = d["dailySleepDTO"]
    if not dto.get("sleepTimeSeconds"):
        return None
    scores = dto.get("sleepScores") or {}
    return {
        "sleepSeconds": dto.get("sleepTimeSeconds"),
        "deep": dto.get("deepSleepSeconds"),
        "light": dto.get("lightSleepSeconds"),
        "rem": dto.get("remSleepSeconds"),
        "awake": dto.get("awakeSleepSeconds"),
        "start": dto.get("sleepStartTimestampLocal"),
        "end": dto.get("sleepEndTimestampLocal"),
        "score": (scores.get("overall") or {}).get("value"),
        "quality": (scores.get("overall") or {}).get("qualifierKey"),
        "needMinutes": (dto.get("sleepNeed") or {}).get("actual") if isinstance(dto.get("sleepNeed"), dict) else None,
        "avgHrv": d.get("avgOvernightHrv"),
        "restingHr": d.get("restingHeartRate"),
        "bbChange": d.get("bodyBatteryChange"),
        "respiration": dto.get("averageRespirationValue"),
        "levels": [
            [lv.get("startGMT"), lv.get("endGMT"), lv.get("activityLevel")]
            for lv in d.get("sleepLevels") or []
        ],
    }


def reduce_readiness(d: Any) -> dict | None:
    if isinstance(d, list):
        d = max(d, key=lambda x: x.get("timestamp") or "", default=None)
    if not d:
        return None
    keep = ("score", "level", "feedbackShort", "feedbackLong", "sleepScore",
            "sleepScoreFactorPercent", "recoveryTime", "recoveryTimeFactorPercent",
            "acwrFactorPercent", "acuteLoad", "stressHistoryFactorPercent",
            "hrvFactorPercent", "hrvWeeklyAverage", "sleepHistoryFactorPercent",
            "timestampLocal")
    return {k: d.get(k) for k in keep}


def reduce_tstatus(d: dict | None) -> dict | None:
    if not d:
        return None
    out: dict[str, Any] = {}
    vo2 = ((d.get("mostRecentVO2Max") or {}).get("generic")) or {}
    out["vo2max"] = vo2.get("vo2MaxPreciseValue")
    cyc = ((d.get("mostRecentVO2Max") or {}).get("cycling")) or {}
    out["vo2maxCycling"] = cyc.get("vo2MaxPreciseValue")
    ts_map = ((d.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData")) or {}
    ts = next(iter(ts_map.values()), None) or {}
    acute = ts.get("acuteTrainingLoadDTO") or {}
    out.update({
        "status": ts.get("trainingStatus"),
        "statusPhrase": ts.get("trainingStatusFeedbackPhrase"),
        "fitnessTrend": ts.get("fitnessTrend"),
        "acuteLoad": acute.get("dailyTrainingLoadAcute"),
        "chronicLoad": acute.get("dailyTrainingLoadChronic"),
        "chronicMin": acute.get("minTrainingLoadChronic"),
        "chronicMax": acute.get("maxTrainingLoadChronic"),
        "acwr": acute.get("dailyAcuteChronicWorkloadRatio"),
        "acwrStatus": acute.get("acwrStatus"),
    })
    lb_map = ((d.get("mostRecentTrainingLoadBalance") or {}).get("metricsTrainingLoadBalanceDTOMap")) or {}
    lb = next(iter(lb_map.values()), None) or {}
    if lb:
        out["loadBalance"] = {
            k: lb.get(k) for k in (
                "monthlyLoadAerobicLow", "monthlyLoadAerobicHigh", "monthlyLoadAnaerobic",
                "monthlyLoadAerobicLowTargetMin", "monthlyLoadAerobicLowTargetMax",
                "monthlyLoadAerobicHighTargetMin", "monthlyLoadAerobicHighTargetMax",
                "monthlyLoadAnaerobicTargetMin", "monthlyLoadAnaerobicTargetMax",
                "trainingBalanceFeedbackPhrase")
        }
    devs = ((d.get("mostRecentTrainingStatus") or {}).get("recordedDevices")) or []
    out["device"] = devs[0].get("deviceName") if devs else None
    return out


def reduce_bb(d: Any) -> list | None:
    if not d:
        return None
    row = d[-1] if isinstance(d, list) else d
    return row.get("bodyBatteryValuesArray") or []


ACTIVITY_KEYS = (
    "activityId", "activityName", "startTimeLocal", "startTimeGMT", "distance",
    "duration", "movingDuration", "elapsedDuration", "elevationGain", "elevationLoss",
    "averageSpeed", "maxSpeed", "avgGradeAdjustedSpeed", "averageHR", "maxHR",
    "calories", "avgPower", "maxPower", "normPower",
    "averageRunningCadenceInStepsPerMinute", "averageBikingCadenceInRevPerMinute",
    "avgStrideLength", "avgGroundContactTime", "avgVerticalOscillation",
    "aerobicTrainingEffect", "anaerobicTrainingEffect", "trainingEffectLabel",
    "activityTrainingLoad", "vO2MaxValue", "locationName", "lapCount", "hasPolyline",
    "workoutId", "totalSets", "activeSets", "totalReps", "summarizedExerciseSets",
    "hrTimeInZone_1", "hrTimeInZone_2", "hrTimeInZone_3", "hrTimeInZone_4", "hrTimeInZone_5",
    "differenceBodyBattery", "minTemperature", "maxTemperature",
)


def reduce_activity(a: dict) -> dict:
    out = {k: a.get(k) for k in ACTIVITY_KEYS if a.get(k) is not None}
    out["typeKey"] = (a.get("activityType") or {}).get("typeKey")
    return out


LAP_KEYS = ("distance", "duration", "movingDuration", "averageSpeed", "averageHR",
            "maxHR", "averagePower", "averageRunCadence", "averageBikeCadence",
            "elevationGain", "elevationLoss", "intensityType", "wktStepIndex")

SERIES_KEYS = {
    "sumDuration": "t", "sumDistance": "d", "directHeartRate": "hr",
    "directSpeed": "v", "directPower": "p", "directElevation": "e",
    "directRunCadence": "c", "directBikeCadence": "c",
}


def reduce_details(d: dict | None) -> dict:
    if not d:
        return {}
    idx = {m["key"]: m["metricsIndex"] for m in d.get("metricDescriptors") or []}
    series: dict[str, list] = {}
    rows = d.get("activityDetailMetrics") or []
    for key, short in SERIES_KEYS.items():
        if key not in idx or short in series:
            continue
        i = idx[key]
        vals = [(r.get("metrics") or [None] * (i + 1))[i] for r in rows]
        if any(v is not None for v in vals):
            series[short] = [round(v, 2) if isinstance(v, float) else v for v in vals]
    poly = (d.get("geoPolylineDTO") or {}).get("polyline") or []
    return {
        "series": series,
        "route": [[round(p["lat"], 5), round(p["lon"], 5)] for p in poly
                  if p.get("lat") is not None and p.get("lon") is not None],
    }


# --- Syncer -------------------------------------------------------------------

class Syncer:
    def __init__(self) -> None:
        self.api: Garmin | None = None
        self._last_call = 0.0
        # Sync-Thread und Schreibaufrufe aus der API (Wasser) teilen sich den Garmin-Client
        self._call_lock = threading.RLock()
        self._wake = threading.Event()
        self._force = False
        self._thread: threading.Thread | None = None
        self.backoff_until = 0.0
        self._backoff_step = 0
        self.running_task: str | None = None
        self.tasks: list[tuple[str, Callable[[datetime], float], Callable[[], None]]] = [
            ("today", self._iv_today, self.sync_today),
            ("activities", self._iv_activities, self.sync_activities),
            ("details", lambda now: 60, self.sync_details),
            ("calendar", self._iv_calendar, self.sync_calendar),
            ("trends", lambda now: 3 * 3600, self.sync_trends),
            ("profile", lambda now: 6 * 3600, self.sync_profile),
            ("backfill", lambda now: 60, self.sync_backfill),
        ]

    # --- Intervalle je nach Tageszeit ---

    @staticmethod
    def _daytime(now: datetime) -> bool:
        return 6 <= now.hour < 23

    def _iv_today(self, now: datetime) -> float:
        today = now.date().isoformat()
        if 4 <= now.hour < 12 and not db.get_daily("sleep", today):
            return 10 * 60  # Morgens eng pruefen, bis die Nacht synchronisiert ist
        return 30 * 60 if self._daytime(now) else 2 * 3600

    def _iv_activities(self, now: datetime) -> float:
        return 10 * 60 if self._daytime(now) else 60 * 60

    def _iv_calendar(self, now: datetime) -> float:
        return 30 * 60 if self._daytime(now) else 3 * 3600

    # --- Infrastruktur ---

    def _connect(self) -> Garmin:
        if self.api is None:
            if not Path(TOKENSTORE).exists():
                raise GarminConnectAuthenticationError(
                    f"Kein Tokenstore unter {TOKENSTORE} - zuerst `python -m app.login` ausfuehren"
                )
            api = Garmin()
            api.login(tokenstore=TOKENSTORE)
            self.api = api
        return self.api

    def _call(self, name: str, *args: Any, **kwargs: Any) -> Any:
        with self._call_lock:
            return self._call_locked(name, *args, **kwargs)

    def add_hydration(self, day: str, time_hm: str | None, ml: float) -> Any:
        """Wasser in Garmin Connect eintragen (negativ = abziehen). Wirft Paused bei Sperre/Login-Problem."""
        ts = f"{day}T{(time_hm or '12:00')[:5]}:00.000"
        return self._call("add_hydration_data", value_in_ml=float(ml), timestamp=ts, cdate=day)

    def _call_locked(self, name: str, *args: Any, **kwargs: Any) -> Any:
        if time.time() < self.backoff_until:
            raise Paused()
        gap = time.time() - self._last_call
        if gap < MIN_CALL_GAP:
            time.sleep(MIN_CALL_GAP - gap)
        try:
            api = self._connect()
            result = getattr(api, name)(*args, **kwargs)
            self._backoff_step = 0
            db.set_state("last_ok", time.time())
            db.set_state("error", None)
            return result
        except GarminConnectTooManyRequestsError:
            self._pause("rate_limit", 15 * 60)
            raise Paused()
        except GarminConnectAuthenticationError as err:
            self.api = None
            self._pause("auth", 30 * 60, str(err))
            raise Paused()
        except GarminConnectConnectionError as err:
            if "404" in str(err) or "not found" in str(err).lower():
                return None
            if "429" in str(err):
                self._pause("rate_limit", 15 * 60)
                raise Paused()
            raise
        finally:
            self._last_call = time.time()

    def _pause(self, kind: str, base: int, detail: str = "") -> None:
        delay = min(base * (2 ** self._backoff_step), 4 * 3600)
        self._backoff_step += 1
        self.backoff_until = time.time() + delay
        log.warning("Sync pausiert (%s) fuer %d min %s", kind, delay // 60, detail)
        db.set_state("error", {"kind": kind, "detail": detail[:200], "until": self.backoff_until})

    def _due(self, name: str, interval: float, now_ts: float) -> bool:
        last = db.get_state(f"task:{name}", 0) or 0
        return now_ts - last >= interval

    def start(self) -> None:
        if self._thread:
            return
        self._thread = threading.Thread(target=self._loop, name="garmin-sync", daemon=True)
        self._thread.start()

    def trigger(self) -> bool:
        """Manueller Sync aus dem UI. Gibt False zurueck, wenn zu frueh."""
        last = db.get_state("manual_sync", 0) or 0
        if time.time() - last < MANUAL_MIN_GAP:
            return False
        db.set_state("manual_sync", time.time())
        if time.time() < self.backoff_until and (db.get_state("error") or {}).get("kind") == "auth":
            self.backoff_until = 0  # Nach Neu-Login direkt wieder versuchen
        self._force = True
        self._wake.set()
        return True

    def _loop(self) -> None:
        time.sleep(2)
        while True:
            force, self._force = self._force, False
            now = datetime.now()
            for name, interval_fn, fn in self.tasks:
                if time.time() < self.backoff_until:
                    break
                forced = force and name in ("today", "activities", "details", "calendar")
                if not forced and not self._due(name, interval_fn(now), time.time()):
                    continue
                self.running_task = name
                try:
                    fn()
                    db.set_state(f"task:{name}", time.time())
                except Paused:
                    break
                except Exception:
                    log.error("Task %s fehlgeschlagen:\n%s", name, traceback.format_exc())
                    # Nicht in Endlosschleife hauen: Task gilt als gelaufen,
                    # naechster Versuch nach regulaerem Intervall.
                    db.set_state(f"task:{name}", time.time())
                    db.set_state("error", {"kind": "task", "detail": f"{name}: {traceback.format_exc(limit=1)[-200:]}"})
                finally:
                    self.running_task = None
            self._wake.wait(timeout=30)
            self._wake.clear()

    # --- Tasks ---

    @staticmethod
    def _final(day: date) -> bool:
        return day <= date.today() - timedelta(days=2)

    def _fetch_day(self, day: date, kinds: tuple[str, ...], skip_final: bool = True) -> None:
        ds = day.isoformat()
        final = self._final(day)
        for kind in kinds:
            if skip_final:
                meta = db.daily_meta(kind, ds)
                if meta and meta["final"]:
                    continue
            if kind == "summary":
                data = reduce_summary(self._call("get_user_summary", ds))
            elif kind == "sleep":
                data = reduce_sleep(self._call("get_sleep_data", ds))
            elif kind == "hrv":
                data = (self._call("get_hrv_data", ds) or {}).get("hrvSummary")
            elif kind == "readiness":
                data = reduce_readiness(self._call("get_training_readiness", ds))
            elif kind == "tstatus":
                data = reduce_tstatus(self._call("get_training_status", ds))
            elif kind == "bb":
                data = reduce_bb(self._call("get_body_battery", ds, ds))
            else:
                raise ValueError(kind)
            db.put_daily(kind, ds, data, final)

    def sync_today(self) -> None:
        today = date.today()
        self._fetch_day(today, ("sleep", "hrv", "readiness", "summary", "tstatus", "bb"))
        # Gestern nachziehen, bis der Tag endgueltig ist (Uhr synchronisiert
        # oft erst am Morgen die letzten Stunden).
        y = today - timedelta(days=1)
        meta = db.daily_meta("summary", y.isoformat())
        morning = datetime.combine(today, datetime.min.time()).timestamp() + 10 * 3600
        if not meta or meta["fetched_at"] < morning:
            self._fetch_day(y, ("summary", "bb", "tstatus"))

    def _store_activities(self, acts: list[dict]) -> int:
        new = 0
        for a in acts or []:
            if not a.get("activityId") or not a.get("startTimeLocal"):
                continue
            sport = sport_of((a.get("activityType") or {}).get("typeKey", ""))
            if db.upsert_activity(a["activityId"], a["startTimeLocal"], sport, reduce_activity(a)):
                new += 1
        return new

    def sync_activities(self) -> None:
        acts = self._call("get_activities", 0, 20)
        new = self._store_activities(acts)
        if new:
            log.info("%d neue Aktivitaet(en)", new)
            # Neue Einheit veraendert Readiness/Trainingsstatus -> heute neu holen
            db.set_state("task:today", 0)
            self._wake.set()

    def sync_details(self) -> None:
        for act_id in db.activities_without_detail(3):
            found = db.activity(act_id)
            if not found:
                continue
            summary, _ = found
            sport = summary["_sport"]
            detail: dict[str, Any] = {}
            splits = self._call("get_activity_splits", act_id) or {}
            detail["laps"] = [{k: lap.get(k) for k in LAP_KEYS} for lap in splits.get("lapDTOs") or []]
            if summary.get("hasPolyline") or sport in ("running", "cycling"):
                detail.update(reduce_details(self._call("get_activity_details", act_id, 400, 800)))
            zones = self._call("get_activity_hr_in_timezones", act_id) or []
            detail["hrZones"] = [{"zone": z.get("zoneNumber"), "secs": z.get("secsInZone"),
                                  "low": z.get("zoneLowBoundary")} for z in zones]
            if sport == "cycling":
                pz = self._call("get_activity_power_in_timezones", act_id) or []
                detail["powerZones"] = [{"zone": z.get("zoneNumber"), "secs": z.get("secsInZone"),
                                         "low": z.get("zoneLowBoundary")} for z in pz]
            if sport == "strength":
                sets = (self._call("get_activity_exercise_sets", act_id) or {}).get("exerciseSets") or []
                detail["sets"] = [{
                    "type": s.get("setType"),
                    "duration": s.get("duration"),
                    "reps": s.get("repetitionCount"),
                    "weight": s.get("weight"),
                    "exercise": next((e for e in (s.get("exercises") or [])), None),
                    "start": s.get("startTime"),
                } for s in sets]
            db.set_activity_detail(act_id, detail)

    def sync_calendar(self) -> None:
        today = date.today()
        months = {(today.year, today.month)}
        prev = today.replace(day=1) - timedelta(days=1)
        nxt = (today.replace(day=28) + timedelta(days=5))
        months |= {(prev.year, prev.month), (nxt.year, nxt.month)}
        for y, m in sorted(months):
            data = self._call("get_scheduled_workouts", y, m) or {}
            items = []
            for it in data.get("calendarItems") or []:
                if it.get("itemType") not in ("workout", "activity", "race", "event"):
                    continue
                items.append({k: it.get(k) for k in (
                    "id", "itemType", "title", "date", "sportTypeKey", "activityTypeId",
                    "duration", "distance", "workoutId", "isRace")})
            db.put_blob(f"cal:{y:04d}-{m:02d}", items)

    def _store_trends(self, start: date, end: date) -> None:
        s, e = start.isoformat(), end.isoformat()
        for row in self._call("get_rhr_daily", s, e) or []:
            d = date.fromisoformat(row["calendarDate"])
            db.put_daily("rhr", row["calendarDate"], row.get("value"), self._final(d))
        hrv = self._call("get_hrv_data_range", s, e) or {}
        for row in hrv.get("hrvSummaries") or []:
            d = date.fromisoformat(row["calendarDate"])
            db.put_daily("hrv", row["calendarDate"], row, self._final(d))
        for row in self._call("get_sleep_daily", s, e) or []:
            d = date.fromisoformat(row["calendarDate"])
            db.put_daily("sleep_daily", row["calendarDate"], row.get("values"), self._final(d))

    def sync_trends(self) -> None:
        today = date.today()
        self._store_trends(today - timedelta(days=13), today)

    def sync_profile(self) -> None:
        db.put_blob("race_predictions", self._call("get_race_predictions"))
        db.put_blob("lactate_threshold", self._call("get_lactate_threshold"))
        db.put_blob("power_zones", self._call("get_power_zones"))
        db.put_blob("hr_zones", self._call("get_heart_rate_zones"))
        profile = self._call("get_user_profile") or {}
        ud = profile.get("userData") or {}
        db.put_blob("profile", {k: ud.get(k) for k in (
            "weight", "height", "birthDate", "vo2MaxRunning", "vo2MaxCycling",
            "lactateThresholdHeartRate", "lactateThresholdSpeed")})
        try:
            name = self._connect().get_full_name()
        except Exception:
            name = None
        db.put_blob("name", name)
        today = date.today()
        weigh = self._call("get_weigh_ins", (today - timedelta(days=HISTORY_DAYS)).isoformat(),
                           today.isoformat()) or {}
        weights = []
        for day in weigh.get("dailyWeightSummaries") or []:
            latest = day.get("latestWeight") or {}
            if latest.get("weight"):
                weights.append([day.get("summaryDate"), round(latest["weight"] / 1000, 1),
                                latest.get("bodyFat")])
        db.put_blob("weights", weights)

    def _backfill_jobs(self) -> list[tuple[str, date, date]]:
        today = date.today()
        jobs: list[tuple[str, date, date]] = []
        # Aktivitaeten in 60-Tage-Bloecken
        end = today
        start_limit = today - timedelta(days=HISTORY_DAYS)
        while end > start_limit:
            start = max(end - timedelta(days=59), start_limit)
            jobs.append(("acts", start, end))
            end = start - timedelta(days=1)
        # Trends (HRV, Ruhepuls, Schlaf) in 28-Tage-Bloecken
        end = today
        while end > start_limit:
            start = max(end - timedelta(days=27), start_limit)
            jobs.append(("trends", start, end))
            end = start - timedelta(days=1)
        # Tageswerte einzeln fuer die letzten Wochen
        for i in range(1, DAILY_HISTORY_DAYS + 1):
            d = today - timedelta(days=i)
            jobs.append(("day", d, d))
        return jobs

    def sync_backfill(self) -> None:
        """Arbeitet pro Durchlauf eine kleine Portion der Historie ab."""
        done: list[str] = db.get_state("backfill_done", []) or []
        done_set = set(done)
        budget = 6
        for kind, start, end in self._backfill_jobs():
            key = f"{kind}:{start}:{end}"
            if kind == "day":
                key = f"day:{start}"
            if key in done_set:
                continue
            if kind == "acts":
                self._store_activities(self._call(
                    "get_activities_by_date", start.isoformat(), end.isoformat()))
                budget -= 1
            elif kind == "trends":
                self._store_trends(start, end)
                budget -= 3
            else:
                self._fetch_day(start, ("summary", "readiness", "tstatus", "sleep"))
                budget -= 4
            done.append(key)
            db.set_state("backfill_done", done)
            if budget <= 0:
                break
        total = len(self._backfill_jobs())
        db.set_state("backfill_progress", min(1.0, len(done_set | set(done)) / max(total, 1)))

    def status(self) -> dict[str, Any]:
        err = db.get_state("error")
        return {
            "lastOk": db.get_state("last_ok"),
            "running": self.running_task,
            "pausedUntil": self.backoff_until if time.time() < self.backoff_until else None,
            "error": err,
            "backfill": db.get_state("backfill_progress", 0),
            "activities": db.activity_count(),
        }


syncer = Syncer()
