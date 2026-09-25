"""Fuellt eine leere Datenbank mit erfundenen Garmin-Daten, z. B. zum Ausprobieren oder fuer Screenshots.

Alles ist synthetisch: eine fiktive Triathletin/ein fiktiver Triathlet, Strecken als
geometrische Schleifen ohne echten Ort. Kein Garmin-Konto noetig.
Nie auf eine echte Datenbank anwenden - das Skript bricht ab, wenn schon Daten da sind.

    DATA_DIR=./data/demo ./.venv/bin/python scripts/demo_data.py
    DATA_DIR=./data/demo SYNC_ENABLED=0 AUTH_ENABLED=0 ./.venv/bin/python -m uvicorn app.main:app --port 4310
"""

from __future__ import annotations

import math
import random
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db  # noqa: E402

random.seed(42)
TODAY = date.today()
DAYS = 120
MAX_HR = 196
FTP = 245
THRESHOLD_PACE = 4 * 60 + 35  # s/km

# Wochenplan (Montag = 0): (Sportart, Titel, Minuten, Art)
PLAN = {
    0: ("strength", "Kraft Ganzkörper", 45, "strength"),
    1: ("running", "Lauf Intervalle 5x1000 m", 55, "intervals"),
    2: ("cycling", "Rad Grundlage 60 min", 60, "z2"),
    3: ("running", "Lauf Schwelle 20 min", 50, "threshold"),
    4: ("running", "Lauf locker 40 min", 40, "z2"),
    5: ("running", "Lauf Zone 3 60 min", 60, "z3"),
    6: ("cycling", "Rad Zone 2 90 min", 90, "z2"),
}
SPORT_KEY = {"running": "running", "cycling": "road_biking", "strength": "strength_training"}


def jitter(v: float, pct: float) -> float:
    return v * (1 + random.uniform(-pct, pct))


# --- Aktivitaeten -------------------------------------------------------------

def route(n: int, seed: int, size: float) -> list[list[float]]:
    """Geschlossene, leicht verbeulte Schleife um einen fiktiven Punkt (kein echter Ort)."""
    rnd = random.Random(seed)
    lat0, lon0 = 0.5, 0.5
    a, b = rnd.uniform(0.6, 1.0), rnd.uniform(0.4, 0.8)
    wob = [(rnd.uniform(0.05, 0.18), rnd.randint(2, 5), rnd.uniform(0, 6)) for _ in range(3)]
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / (n - 1)
        r = 1 + sum(w * math.sin(k * t + ph) for w, k, ph in wob)
        pts.append([round(lat0 + size * b * r * math.sin(t), 5), round(lon0 + size * a * r * math.cos(t), 5)])
    return pts


def run_profile(kind: str, minutes: float) -> list[tuple[str, float, float]]:
    """Abschnitte (Typ, Sekunden, Pace s/km)."""
    if kind == "intervals":
        segs = [("WARMUP", 900, 345)]
        for i in range(5):
            segs.append(("INTERVAL", jitter(292, 0.02), jitter(292, 0.01)))
            if i < 4:
                segs.append(("RECOVERY", 180, 420))
        segs.append(("COOLDOWN", 600, 350))
        return segs
    if kind == "threshold":
        return [("WARMUP", 900, 340), ("INTERVAL", 1200, jitter(THRESHOLD_PACE, 0.015)), ("COOLDOWN", 600, 350)]
    pace = 318 if kind == "z3" else 345
    return [("ACTIVE", minutes * 60, jitter(pace, 0.03))]


def make_run(act_id: int, d: date, title: str, kind: str, minutes: float, hour: int) -> tuple[dict, dict]:
    segs = run_profile(kind, minutes)
    series = {k: [] for k in ("t", "d", "hr", "v", "p", "e", "c")}
    laps = []
    t = dist = 0.0
    hr = 110.0
    step = 10
    for typ, secs, pace in segs:
        target = {"WARMUP": 142, "COOLDOWN": 140, "RECOVERY": 138, "INTERVAL": 178 if kind == "intervals" else 172,
                  "ACTIVE": 158 if kind == "z3" else 146}[typ]
        lap_hr, lap_n, lap_d = [], 0, 0.0
        for _ in range(int(secs // step)):
            hr += (target - hr) * 0.12 + random.uniform(-1.2, 1.2)
            v = 1000 / (pace * random.uniform(0.97, 1.03))
            t += step
            dist += v * step
            lap_d += v * step
            lap_hr.append(hr)
            lap_n += 1
            series["t"].append(round(t, 1))
            series["d"].append(round(dist, 1))
            series["hr"].append(round(hr))
            series["v"].append(round(v, 2))
            series["p"].append(round(v * 78 + random.uniform(-6, 6)))
            series["e"].append(round(112 + 6 * math.sin(dist / 900) + 2 * math.sin(dist / 230), 1))
            series["c"].append(round(166 + (v - 3) * 9 + random.uniform(-2, 2)))
        # Kilometer-Runden fuer Dauerlaeufe, Abschnitte fuer strukturierte Einheiten
        laps.append({"distance": lap_d, "duration": lap_n * step, "movingDuration": lap_n * step,
                     "averageSpeed": lap_d / (lap_n * step), "averageHR": round(sum(lap_hr) / len(lap_hr)),
                     "maxHR": round(max(lap_hr)), "averagePower": round(lap_d / (lap_n * step) * 78),
                     "averageRunCadence": 170, "elevationGain": round(lap_d / 400), "elevationLoss": round(lap_d / 420),
                     "intensityType": typ, "wktStepIndex": len(laps)})
    if kind in ("z3", "z2"):
        laps = split_km(series)
    n = len(series["t"])
    duration = t
    avg_hr = sum(series["hr"]) / n
    zones = zone_times(series["hr"], step)
    load = (sum(secs for secs in zones[2:]) / 60 * 2.2 + duration / 60 * 0.9) * 0.55
    summary = {
        "activityId": act_id, "activityName": title, "startTimeLocal": f"{d} {hour:02d}:{random.randint(0, 50):02d}:00",
        "distance": dist, "duration": duration, "movingDuration": duration, "elapsedDuration": duration + 30,
        "elevationGain": round(dist / 380), "elevationLoss": round(dist / 390), "averageSpeed": dist / duration,
        "maxSpeed": max(series["v"]), "avgGradeAdjustedSpeed": dist / duration * 1.01, "averageHR": round(avg_hr),
        "maxHR": max(series["hr"]), "calories": round(duration / 60 * 12.5), "avgPower": round(sum(series["p"]) / n),
        "maxPower": max(series["p"]), "averageRunningCadenceInStepsPerMinute": round(sum(series["c"]) / n),
        "avgStrideLength": 118, "avgGroundContactTime": 238,
        "aerobicTrainingEffect": round(min(5, 2.2 + load / 90), 1), "anaerobicTrainingEffect": 1.8 if kind == "intervals" else 0.6,
        "trainingEffectLabel": {"intervals": "VO2MAX", "threshold": "LACTATE_THRESHOLD", "z3": "TEMPO"}.get(kind, "BASE"),
        "activityTrainingLoad": round(load, 1), "hasPolyline": True, "typeKey": "running",
        "hrTimeInZone_1": zones[0], "hrTimeInZone_2": zones[1], "hrTimeInZone_3": zones[2],
        "hrTimeInZone_4": zones[3], "hrTimeInZone_5": zones[4], "lapCount": len(laps),
    }
    detail = {"laps": laps, "series": series, "route": route(260, act_id, dist / 1000 * 0.0011),
              "hrZones": [{"zone": i + 1, "secs": zones[i], "low": low} for i, low in enumerate((98, 118, 138, 157, 177))]}
    return summary, detail


def split_km(series: dict) -> list[dict]:
    laps, start = [], 0
    for i, d in enumerate(series["d"]):
        if d >= (len(laps) + 1) * 1000 or i == len(series["d"]) - 1:
            dd = d - (series["d"][start - 1] if start else 0)
            tt = series["t"][i] - (series["t"][start - 1] if start else 0)
            hrs = series["hr"][start:i + 1]
            laps.append({"distance": dd, "duration": tt, "movingDuration": tt, "averageSpeed": dd / tt,
                         "averageHR": round(sum(hrs) / len(hrs)), "maxHR": max(hrs),
                         "averagePower": round(dd / tt * 78), "averageRunCadence": 170, "averageBikeCadence": 88,
                         "elevationGain": random.randint(1, 9), "elevationLoss": random.randint(1, 9),
                         "intensityType": "ACTIVE", "wktStepIndex": None})
            start = i + 1
    return laps


def zone_times(hrs: list[float], step: float) -> list[float]:
    bounds = (0, 118, 138, 157, 177, 999)
    out = [0.0] * 5
    for h in hrs:
        for z in range(5):
            if bounds[z] <= h < bounds[z + 1]:
                out[z] += step
    return out


def make_ride(act_id: int, d: date, title: str, minutes: float, hour: int) -> tuple[dict, dict]:
    series = {k: [] for k in ("t", "d", "hr", "v", "p", "e", "c")}
    step, t, dist, hr = 15, 0.0, 0.0, 105.0
    base_p = 170 if minutes >= 80 else 160
    for i in range(int(minutes * 60 // step)):
        climb = math.sin(i / 35)
        p = max(0, base_p + 45 * climb + random.uniform(-25, 25))
        hr += ((118 + p / 5) - hr) * 0.1 + random.uniform(-1, 1)
        v = max(4, 8.6 - 2.2 * climb + random.uniform(-0.4, 0.4))
        t += step
        dist += v * step
        series["t"].append(t)
        series["d"].append(round(dist, 1))
        series["hr"].append(round(hr))
        series["v"].append(round(v, 2))
        series["p"].append(round(p))
        series["e"].append(round(180 + 60 * math.sin(i / 35 - 1.2), 1))
        series["c"].append(round(86 + random.uniform(-4, 4)))
    n = len(series["t"])
    avg_p = sum(series["p"]) / n
    np_ = (sum(p ** 4 for p in series["p"]) / n) ** 0.25
    zones = zone_times(series["hr"], step)
    pz = [0.0] * 7
    floors = (0, 136, 184, 221, 257, 294, 368)
    for p in series["p"]:
        z = max(i for i, f in enumerate(floors) if p >= f)
        pz[z] += step
    load = (t / 3600) * (np_ / FTP) ** 2 * 100 * 0.8
    summary = {
        "activityId": act_id, "activityName": title, "startTimeLocal": f"{d} {hour:02d}:{random.randint(0, 50):02d}:00",
        "distance": dist, "duration": t, "movingDuration": t, "elapsedDuration": t + 120,
        "elevationGain": round(minutes * 6.5), "elevationLoss": round(minutes * 6.4), "averageSpeed": dist / t,
        "maxSpeed": max(series["v"]), "averageHR": round(sum(series["hr"]) / n), "maxHR": max(series["hr"]),
        "calories": round(avg_p * t / 1000 * 1.05), "avgPower": round(avg_p), "maxPower": max(series["p"]),
        "normPower": round(np_), "averageBikingCadenceInRevPerMinute": 86,
        "aerobicTrainingEffect": round(min(5, 2.0 + load / 80), 1), "anaerobicTrainingEffect": 0.4,
        "trainingEffectLabel": "BASE", "activityTrainingLoad": round(load, 1), "hasPolyline": True, "typeKey": "road_biking",
        "lapCount": 1,
    }
    detail = {"laps": split_km(series)[::5] or [], "series": series, "route": route(320, act_id, dist / 1000 * 0.0009),
              "hrZones": [{"zone": i + 1, "secs": zones[i], "low": low} for i, low in enumerate((98, 118, 138, 157, 177))],
              "powerZones": [{"zone": i + 1, "secs": pz[i], "low": floors[i]} for i in range(7)]}
    return summary, detail


EXERCISES = [("Kniebeuge", 60), ("Bankdrücken", 50), ("Rudern vorgebeugt", 45), ("Rumänisches Kreuzheben", 70),
             ("Schulterdrücken", 30), ("Ausfallschritte", 20)]


def make_strength(act_id: int, d: date, title: str, week_no: int, hour: int) -> tuple[dict, dict]:
    sets, t = [], 0.0
    start = datetime.combine(d, datetime.min.time()) + timedelta(hours=hour)
    for name, kg in EXERCISES[: random.choice((4, 5, 6))]:
        for _ in range(3):
            dur = random.uniform(35, 55)
            sets.append({"type": "ACTIVE", "duration": dur, "reps": random.choice((8, 10, 10, 12)),
                         "weight": (kg + week_no * 1.25) * 1000, "exercise": {"category": "", "name": name},
                         "start": (start + timedelta(seconds=t)).isoformat()})
            t += dur
            rest = random.uniform(80, 120)
            sets.append({"type": "REST", "duration": rest, "reps": None, "weight": None, "exercise": None,
                         "start": (start + timedelta(seconds=t)).isoformat()})
            t += rest
    active = [s for s in sets if s["type"] == "ACTIVE"]
    summary = {
        "activityId": act_id, "activityName": title, "startTimeLocal": f"{d} {hour:02d}:10:00",
        "distance": 0, "duration": t, "movingDuration": t, "averageHR": random.randint(108, 122),
        "maxHR": random.randint(145, 160), "calories": round(t / 60 * 6.5), "activeSets": len(active),
        "totalReps": sum(s["reps"] for s in active), "aerobicTrainingEffect": 1.6, "anaerobicTrainingEffect": 1.2,
        "trainingEffectLabel": "RECOVERY", "activityTrainingLoad": round(t / 60 * 0.9, 1), "typeKey": "strength_training",
    }
    detail = {"laps": [], "sets": sets,
              "hrZones": [{"zone": i + 1, "secs": s, "low": low}
                          for i, (s, low) in enumerate(zip((900, 1300, 400, 60, 0), (98, 118, 138, 157, 177)))]}
    return summary, detail


# --- Tageswerte ----------------------------------------------------------------

def sleep_levels(d: date, total: int) -> tuple[list, int, int]:
    """Hypnogramm: Zyklen aus Leicht/Tief/REM, kurze Wachphasen. Zeiten in GMT (UTC+2 lokal)."""
    start_local = datetime.combine(d - timedelta(days=1), datetime.min.time()) + timedelta(hours=22, minutes=random.randint(15, 70))
    t = start_local - timedelta(hours=2)
    end = t + timedelta(seconds=total)
    levels = []
    cycle = 0
    while t < end:
        for lv, mins in ((1, random.randint(15, 30)), (0, max(5, random.randint(20, 45) - cycle * 8)),
                         (1, random.randint(10, 20)), (2, random.randint(10, 18) + cycle * 5)):
            nxt = min(end, t + timedelta(minutes=mins))
            levels.append([t.strftime("%Y-%m-%dT%H:%M:%S.0"), nxt.strftime("%Y-%m-%dT%H:%M:%S.0"), float(lv)])
            t = nxt
            if t >= end:
                break
        if random.random() < 0.5 and t < end:
            nxt = min(end, t + timedelta(minutes=random.randint(2, 6)))
            levels.append([t.strftime("%Y-%m-%dT%H:%M:%S.0"), nxt.strftime("%Y-%m-%dT%H:%M:%S.0"), 3.0])
            t = nxt
        cycle += 1
    start_ms = int(start_local.replace(tzinfo=None).timestamp() * 1000 + 7200 * 1000)
    return levels, start_ms, start_ms + total * 1000


def main() -> None:
    if db.activity_count() or db.get_blob("name"):
        raise SystemExit("Datenbank enthaelt schon Daten - Demo-Daten nur in ein leeres DATA_DIR schreiben.")

    first = TODAY - timedelta(days=DAYS)
    loads: dict[str, float] = {}
    act_id = 9_000_000_000
    week_no = 0

    # Kalender: geplante Einheiten fuer Vormonat bis naechsten Monat
    cal: dict[str, list] = {}
    d = first
    while d <= TODAY + timedelta(days=45):
        if d.weekday() in PLAN:
            sport, title, minutes, kind = PLAN[d.weekday()]
            key = f"cal:{d.year:04d}-{d.month:02d}"
            cal.setdefault(key, []).append({"id": int(d.strftime("%Y%m%d")), "itemType": "workout", "title": title,
                                            "date": d.isoformat(), "sportTypeKey": SPORT_KEY[sport]})
        d += timedelta(days=1)
    for key, items in cal.items():
        db.put_blob(key, items)

    # Aktivitaeten
    this_monday = TODAY - timedelta(days=TODAY.weekday())
    d = first
    while d < TODAY:
        wd = d.weekday()
        if wd == 0:
            week_no += 1
        plan = PLAN.get(wd)
        skip = random.random() < 0.08 or (d == this_monday + timedelta(days=2) and d < TODAY)  # ein verpasster Tag
        if plan and not skip:
            sport, title, minutes, kind = plan
            act_id += 1
            hour = 7 if wd in (5, 6) else 18
            if sport == "running":
                s, det = make_run(act_id, d, title, kind, jitter(minutes, 0.1), hour)
            elif sport == "cycling":
                s, det = make_ride(act_id, d, title, jitter(minutes, 0.08), hour)
            else:
                s, det = make_strength(act_id, d, title, week_no, hour)
            db.upsert_activity(act_id, s["startTimeLocal"], sport, s)
            db.set_activity_detail(act_id, det)
            loads[d.isoformat()] = loads.get(d.isoformat(), 0) + s["activityTrainingLoad"]
        d += timedelta(days=1)

    # Tageswerte inkl. akuter/chronischer Last (EWMA)
    acute = chronic = 330.0
    vo2 = 50.2
    hrv_base = 62.0
    d = first
    while d <= TODAY:
        ds = d.isoformat()
        load = loads.get((d - timedelta(days=1)).isoformat(), 0)
        acute += (load * 7 - acute) / 7
        chronic += (load * 7 - chronic) / 28
        vo2 = min(54.5, vo2 + random.uniform(-0.05, 0.09))
        hard_yesterday = load > 120
        hrv = round(hrv_base + random.uniform(-7, 7) - (6 if hard_yesterday else 0))
        rhr = round(47 + random.uniform(-2, 2) + (2 if hard_yesterday else 0))
        total = int(random.uniform(6.6, 8.3) * 3600)
        deep, rem = int(total * random.uniform(0.15, 0.22)), int(total * random.uniform(0.18, 0.24))
        awake = int(random.uniform(300, 1800))
        light = total - deep - rem
        score = int(max(55, min(95, 60 + (total / 3600 - 6.5) * 14 + random.uniform(-5, 5))))
        levels, s_ms, e_ms = sleep_levels(d, total)
        final = d <= TODAY - timedelta(days=2)
        ready = int(max(18, min(96, 45 + (hrv - hrv_base) * 2.4 + (score - 75) * 0.8 - (18 if hard_yesterday else 0)
                                + random.uniform(-6, 6))))
        is_today = d == TODAY
        if is_today:
            ready, score, hrv = 78, max(score, 84), max(hrv, 64)  # freundlicher Startbildschirm fuer Screenshots
        steps = random.randint(6500, 14000) if not is_today else 4800
        bb_high = min(100, 55 + int(score * 0.45))
        db.put_daily("sleep", ds, {"sleepSeconds": total, "deep": deep, "light": light, "rem": rem, "awake": awake,
                                   "start": s_ms, "end": e_ms, "score": score,
                                   "quality": "GOOD" if score >= 80 else "FAIR", "avgHrv": hrv, "restingHr": rhr,
                                   "bbChange": bb_high - 20, "levels": levels}, final)
        db.put_daily("hrv", ds, {"calendarDate": ds, "weeklyAvg": round(hrv_base + random.uniform(-2, 2)),
                                 "lastNightAvg": hrv, "lastNight5MinHigh": hrv + 25,
                                 "baseline": {"lowUpper": 52, "balancedLow": 55, "balancedUpper": 70},
                                 "status": "BALANCED" if hrv >= 55 else "UNBALANCED"}, final)
        db.put_daily("rhr", ds, rhr, final)
        db.put_daily("readiness", ds, {
            "score": ready, "level": "HIGH" if ready >= 75 else "MODERATE" if ready >= 50 else "LOW",
            "feedbackShort": "READY_TO_TRAIN" if ready >= 60 else "TAKE_IT_EASY", "sleepScore": score,
            "sleepScoreFactorPercent": score, "recoveryTime": 0 if ready > 70 else 900,
            "recoveryTimeFactorPercent": min(100, ready + 15), "acwrFactorPercent": 88, "acuteLoad": round(acute),
            "stressHistoryFactorPercent": random.randint(70, 92), "hrvFactorPercent": min(100, int(hrv * 1.3)),
            "hrvWeeklyAverage": round(hrv_base), "sleepHistoryFactorPercent": random.randint(65, 90),
            "timestampLocal": f"{ds}T07:05:00.0"}, final)
        db.put_daily("tstatus", ds, {
            "vo2max": round(vo2, 1), "status": 7, "statusPhrase": "PRODUCTIVE_1" if acute > chronic else "MAINTAINING_1",
            "fitnessTrend": 1, "acuteLoad": round(acute), "chronicLoad": round(chronic),
            "chronicMin": round(chronic * 0.8), "chronicMax": round(chronic * 1.5),
            "acwr": round(acute / chronic, 2), "acwrStatus": "OPTIMAL",
            "loadBalance": {"monthlyLoadAerobicLow": 540, "monthlyLoadAerobicHigh": 610, "monthlyLoadAnaerobic": 160,
                            "monthlyLoadAerobicLowTargetMin": 380, "monthlyLoadAerobicLowTargetMax": 720,
                            "monthlyLoadAerobicHighTargetMin": 420, "monthlyLoadAerobicHighTargetMax": 760,
                            "monthlyLoadAnaerobicTargetMin": 120, "monthlyLoadAnaerobicTargetMax": 340,
                            "trainingBalanceFeedbackPhrase": "BALANCED"},
            "device": "Forerunner 965"}, final)
        active_kcal = round(loads.get(ds, 0) * 4.2 + steps * 0.035) if not is_today else 180
        db.put_daily("summary", ds, {
            "totalKilocalories": 1720 + active_kcal, "activeKilocalories": active_kcal, "totalSteps": steps,
            "dailyStepGoal": 9000, "moderateIntensityMinutes": random.randint(10, 40),
            "vigorousIntensityMinutes": random.randint(0, 50), "intensityMinutesGoal": 150, "restingHeartRate": rhr,
            "lastSevenDaysAvgRestingHeartRate": 47, "averageStressLevel": random.randint(18, 34),
            "maxStressLevel": random.randint(70, 92), "bodyBatteryChargedValue": bb_high - 22,
            "bodyBatteryDrainedValue": bb_high - 30, "bodyBatteryHighestValue": bb_high,
            "bodyBatteryLowestValue": random.randint(12, 30), "bodyBatteryMostRecentValue": bb_high - 12,
            "bodyBatteryAtWakeTime": bb_high}, final)
        d += timedelta(days=1)

    # Body Battery heute (Verlauf bis jetzt)
    now = datetime.now()
    midnight = datetime.combine(TODAY, datetime.min.time())
    pts, v, t = [], 28, midnight
    wake = midnight + timedelta(hours=6, minutes=45)
    while t <= now:
        if t < wake:
            v = min(92, v + random.uniform(2.5, 4.5))
        else:
            v = max(15, v - random.uniform(0.8, 2.2))
        pts.append([int(t.timestamp() * 1000), round(v)])
        t += timedelta(minutes=15)
    db.put_daily("bb", TODAY.isoformat(), pts, False)

    db.put_blob("name", "Demo")
    db.put_blob("race_predictions", {"time5K": 19 * 60 + 48, "time10K": 41 * 60 + 12,
                                     "timeHalfMarathon": 91 * 60 + 30, "timeMarathon": 3 * 3600 + 14 * 60})
    db.put_blob("lactate_threshold", {"speed_and_heart_rate": {"speed": 1000 / THRESHOLD_PACE, "heartRate": 176},
                                      "power": {"functionalThresholdPower": 335}})
    db.put_blob("power_zones", [{"sport": "CYCLING", "functionalThresholdPower": float(FTP), "zone1Floor": 0.0,
                                 "zone2Floor": 136.0, "zone3Floor": 184.0, "zone4Floor": 221.0, "zone5Floor": 257.0,
                                 "zone6Floor": 294.0, "zone7Floor": 368.0}])
    db.put_blob("hr_zones", [])
    db.put_blob("profile", {"weight": 75000.0, "height": 181.0, "vo2MaxRunning": 52.0})
    db.put_blob("weights", [[(TODAY - timedelta(days=7 * i)).isoformat(),
                             round(75.0 + i * 0.16 + random.uniform(-0.3, 0.3), 1), None] for i in range(12, -1, -1)])
    db.set_state("backfill_progress", 1.0)
    db.set_state("backfill_done", [])
    db.set_state("last_ok", time.time() - 240)
    db.set_state("error", None)
    print(f"Demo-Daten: {db.activity_count()} Aktivitaeten, {DAYS} Tage -> {db.DB_PATH}")


if __name__ == "__main__":
    main()
