"""Bereitet die Daten aus dem Cache fuer die einzelnen Screens auf.

Hier wird nie Garmin aufgerufen - nur SQLite gelesen.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from . import db, nutrition
from .sync import sport_of

PLANNED_SPORT = {
    "running": "running", "cycling": "cycling", "strength_training": "strength",
    "road_biking": "cycling", "indoor_cycling": "cycling", "trail_running": "running",
}


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _planned_sport(item: dict) -> str:
    key = item.get("sportTypeKey") or ""
    if key in PLANNED_SPORT:
        return PLANNED_SPORT[key]
    title = (item.get("title") or "").lower()
    if title.startswith(("rad", "bike", "rolle")):
        return "cycling"
    if "kraft" in title or "strength" in title:
        return "strength"
    return sport_of(key) if key else "running"


def _act_card(a: dict) -> dict:
    """Kompakte Darstellung einer Aktivitaet fuer Listen und Kalender."""
    return {
        "id": a.get("activityId"),
        "name": a.get("activityName"),
        "sport": a.get("_sport"),
        "type": a.get("typeKey"),
        "start": a.get("startTimeLocal"),
        "duration": a.get("duration"),
        "distance": a.get("distance"),
        "avgHr": a.get("averageHR"),
        "avgSpeed": a.get("averageSpeed"),
        "avgPower": a.get("avgPower"),
        "normPower": a.get("normPower"),
        "elevation": a.get("elevationGain"),
        "load": a.get("activityTrainingLoad"),
        "te": a.get("aerobicTrainingEffect"),
        "teAnaerobic": a.get("anaerobicTrainingEffect"),
        "teLabel": a.get("trainingEffectLabel"),
        "calories": a.get("calories"),
        "sets": a.get("activeSets") or a.get("totalSets"),
        "reps": a.get("totalReps"),
    }


def _calendar_items(start: date, end: date) -> list[dict]:
    items: list[dict] = []
    seen = set()
    d = start.replace(day=1)
    while d <= end:
        for it in db.get_blob(f"cal:{d.year:04d}-{d.month:02d}") or []:
            if it.get("itemType") != "workout" or not it.get("date"):
                continue
            if not (start.isoformat() <= it["date"] <= end.isoformat()):
                continue
            if it["id"] in seen:
                continue
            seen.add(it["id"])
            items.append(it)
        d = (d.replace(day=28) + timedelta(days=5)).replace(day=1)
    return items


def week(start: date) -> dict[str, Any]:
    start = _monday(start)
    end = start + timedelta(days=6)
    today = date.today()
    acts = db.activities_between(start.isoformat(), end.isoformat())
    acts_by_day: dict[str, list[dict]] = defaultdict(list)
    for a in sorted(acts, key=lambda x: x.get("startTimeLocal") or ""):
        acts_by_day[(a.get("startTimeLocal") or "")[:10]].append(a)
    planned_by_day: dict[str, list[dict]] = defaultdict(list)
    for it in _calendar_items(start, end):
        planned_by_day[it["date"]].append(it)

    days = []
    totals: dict[str, dict[str, float]] = defaultdict(lambda: {"duration": 0, "distance": 0, "count": 0, "load": 0})
    planned_count = done_count = 0
    for i in range(7):
        d = start + timedelta(days=i)
        ds = d.isoformat()
        unused = list(acts_by_day.get(ds, []))
        entries = []
        for p in planned_by_day.get(ds, []):
            sport = _planned_sport(p)
            match = next((a for a in unused if a["_sport"] == sport), None)
            if match:
                unused.remove(match)
                status = "done"
                done_count += 1
            elif d < today:
                status = "missed"
            elif d == today:
                status = "today"
            else:
                status = "planned"
            planned_count += 1
            entries.append({
                "kind": "planned", "title": p.get("title"), "sport": sport,
                "status": status, "workoutId": p.get("workoutId"),
                "activity": _act_card(match) if match else None,
            })
        for a in unused:
            entries.append({"kind": "extra", "title": a.get("activityName"), "sport": a["_sport"],
                            "status": "done", "activity": _act_card(a)})
        for a in acts_by_day.get(ds, []):
            t = totals[a["_sport"]]
            t["duration"] += a.get("duration") or 0
            t["distance"] += a.get("distance") or 0
            t["load"] += a.get("activityTrainingLoad") or 0
            t["count"] += 1
        days.append({"date": ds, "entries": entries, "isToday": d == today})

    return {
        "start": start.isoformat(), "end": end.isoformat(), "days": days,
        "totals": totals, "planned": planned_count, "done": done_count,
    }


def _latest_daily(kind: str, max_age_days: int = 3) -> tuple[str | None, Any]:
    today = date.today()
    for i in range(max_age_days + 1):
        ds = (today - timedelta(days=i)).isoformat()
        val = db.get_daily(kind, ds)
        if val:
            return ds, val
    return None, None


def today_view() -> dict[str, Any]:
    today = date.today()
    ts = today.isoformat()
    summary = db.get_daily("summary", ts) or {}
    sleep_day, sleep = _latest_daily("sleep", 1)
    _, readiness = _latest_daily("readiness", 1)
    hrv = db.get_daily("hrv", ts)
    _, tstatus = _latest_daily("tstatus", 3)
    bb = db.get_daily("bb", ts) or []
    w = week(today)
    today_entries = next((d["entries"] for d in w["days"] if d["isToday"]), [])
    tomorrow = today + timedelta(days=1)
    next_entries = []
    if tomorrow.weekday() != 0:
        next_entries = next((d["entries"] for d in w["days"] if d["date"] == tomorrow.isoformat()), [])
    else:
        next_entries = week(tomorrow)["days"][0]["entries"]
    recent = db.activities_between((today - timedelta(days=14)).isoformat(), ts)
    return {
        "date": ts,
        "name": db.get_blob("name"),
        "readiness": readiness,
        "sleep": sleep, "sleepDay": sleep_day,
        "hrv": hrv,
        "summary": summary,
        "bodyBattery": bb,
        "trainingStatus": tstatus,
        "todayPlan": today_entries,
        "tomorrowPlan": next_entries,
        "week": {"planned": w["planned"], "done": w["done"], "totals": w["totals"]},
        "recent": [_act_card(a) for a in recent[:4]],
        "nutrition": _nutrition_today(today, summary),
    }


def _nutrition_today(today: date, summary: dict) -> dict[str, Any] | None:
    """Energiebilanz fuer die Heute-Karte. None, wenn der Tracker nicht angebunden ist."""
    if not nutrition.enabled():
        return None
    data = nutrition.summary(today, today)
    t = (data or {}).get(today.isoformat()) or {}
    return {
        "available": data is not None,
        "kcal": t.get("kcal"), "protein": t.get("protein"), "carbs": t.get("carbs"), "fat": t.get("fat"),
        "budget": t.get("budget"), "entries": t.get("entries"),
        "burned": summary.get("totalKilocalories"), "active": summary.get("activeKilocalories"),
        "link": nutrition.link(),
    }


def _weekly_series(sport: str, weeks: int) -> list[dict]:
    today = date.today()
    first = _monday(today) - timedelta(weeks=weeks - 1)
    acts = db.activities_between(first.isoformat(), today.isoformat(), sport)
    buckets = []
    for i in range(weeks):
        ws = first + timedelta(weeks=i)
        buckets.append({"week": ws.isoformat(), "duration": 0, "distance": 0, "count": 0,
                        "load": 0, "elevation": 0})
    for a in acts:
        d = date.fromisoformat(a["startTimeLocal"][:10])
        idx = (d - first).days // 7
        if 0 <= idx < weeks:
            b = buckets[idx]
            b["duration"] += a.get("duration") or 0
            b["distance"] += a.get("distance") or 0
            b["elevation"] += a.get("elevationGain") or 0
            b["load"] += a.get("activityTrainingLoad") or 0
            b["count"] += 1
    return buckets


def _pace_trend(acts: list[dict]) -> list[dict]:
    """Pace und Puls je Lauf, um Effizienz ueber die Zeit zu sehen."""
    out = []
    for a in reversed(acts):
        if (a.get("distance") or 0) < 3000 or not a.get("averageSpeed"):
            continue
        out.append({
            "date": a["startTimeLocal"][:10],
            "pace": 1000 / a["averageSpeed"],
            "hr": a.get("averageHR"),
            "id": a.get("activityId"),
        })
    return out


def sport_view(sport: str, weeks: int = 12) -> dict[str, Any]:
    today = date.today()
    since = (today - timedelta(days=weeks * 7)).isoformat()
    acts = db.activities_between(since, today.isoformat(), sport)
    out: dict[str, Any] = {
        "sport": sport,
        "weekly": _weekly_series(sport, weeks),
        "activities": [_act_card(a) for a in acts[:30]],
    }
    if sport == "running":
        _, ts = _latest_daily("tstatus", 7)
        lt = db.get_blob("lactate_threshold") or {}
        sh = lt.get("speed_and_heart_rate") or {}
        speed = sh.get("speed")
        if speed and speed < 1:
            speed *= 10  # Garmin liefert die Schwelle um Faktor 10 verkleinert
        out["vo2max"] = (ts or {}).get("vo2max")
        out["threshold"] = {"hr": sh.get("heartRate"),
                            "pace": (1000 / speed) if speed else None,
                            "power": (lt.get("power") or {}).get("functionalThresholdPower")}
        out["racePredictions"] = db.get_blob("race_predictions")
        out["paceTrend"] = _pace_trend(acts)
        out["vo2Trend"] = [
            {"date": d, "value": v.get("vo2max")}
            for d, v in db.daily_range("tstatus", since, today.isoformat()).items()
            if v and v.get("vo2max")
        ]
    elif sport == "cycling":
        pz = db.get_blob("power_zones") or []
        cyc = next((z for z in pz if z.get("sport") == "CYCLING"), None)
        profile = db.get_blob("profile") or {}
        out["ftp"] = cyc.get("functionalThresholdPower") if cyc else None
        out["weight"] = (profile.get("weight") or 0) / 1000 or None
        out["powerZones"] = cyc
        out["powerTrend"] = [
            {"date": a["startTimeLocal"][:10], "np": a.get("normPower"), "avg": a.get("avgPower"),
             "hr": a.get("averageHR"), "id": a.get("activityId")}
            for a in reversed(acts) if a.get("avgPower")
        ]
    elif sport == "strength":
        volume = []
        for a in reversed(acts):
            found = db.activity(a["activityId"])
            detail = found[1] if found else None
            sets = [s for s in (detail or {}).get("sets", []) if s.get("type") == "ACTIVE"]
            kg = sum((s.get("weight") or 0) / 1000 * (s.get("reps") or 0) for s in sets)
            volume.append({"date": a["startTimeLocal"][:10], "sets": len(sets),
                           "reps": sum(s.get("reps") or 0 for s in sets),
                           "volume": round(kg), "duration": a.get("duration"),
                           "id": a.get("activityId")})
        out["sessions"] = volume
    return out


def health_view(days: int = 30) -> dict[str, Any]:
    today = date.today()
    start = (today - timedelta(days=days - 1)).isoformat()
    end = today.isoformat()
    summary = db.daily_range("summary", start, end)
    sleep = db.daily_range("sleep", start, end)
    sleep_daily = db.daily_range("sleep_daily", start, end)
    hrv = db.daily_range("hrv", start, end)
    rhr = db.daily_range("rhr", start, end)
    ready = db.daily_range("readiness", start, end)
    tstatus = db.daily_range("tstatus", start, end)
    rows = []
    for i in range(days):
        ds = (today - timedelta(days=days - 1 - i)).isoformat()
        s = summary.get(ds) or {}
        sl = sleep.get(ds) or {}
        sd = sleep_daily.get(ds) or {}
        h = hrv.get(ds) or {}
        r = ready.get(ds) or {}
        t = tstatus.get(ds) or {}
        rows.append({
            "date": ds,
            "sleepScore": sl.get("score") or sd.get("sleepScore"),
            "sleepSeconds": sl.get("sleepSeconds") or sd.get("totalSleepTimeInSeconds"),
            "deep": sl.get("deep") or sd.get("deepTime"),
            "light": sl.get("light") or sd.get("lightTime"),
            "rem": sl.get("rem") or sd.get("remTime"),
            "awake": sl.get("awake") or sd.get("awakeTime"),
            "hrv": h.get("lastNightAvg") or sd.get("avgOvernightHrv"),
            "hrvWeekly": h.get("weeklyAvg"),
            "hrvLow": (h.get("baseline") or {}).get("balancedLow"),
            "hrvHigh": (h.get("baseline") or {}).get("balancedUpper"),
            "hrvStatus": h.get("status") or sd.get("hrvStatus"),
            "rhr": rhr.get(ds) or s.get("restingHeartRate") or sd.get("restingHeartRate"),
            "bbHigh": s.get("bodyBatteryHighestValue"),
            "bbLow": s.get("bodyBatteryLowestValue"),
            "bbWake": s.get("bodyBatteryAtWakeTime"),
            "stress": s.get("averageStressLevel"),
            "steps": s.get("totalSteps"),
            "readiness": r.get("score"),
            "acuteLoad": t.get("acuteLoad"),
            "chronicLoad": t.get("chronicLoad"),
            "chronicMin": t.get("chronicMin"),
            "chronicMax": t.get("chronicMax"),
            "vo2max": t.get("vo2max"),
        })
    food = nutrition.summary(today - timedelta(days=days - 1), today)
    for row in rows:
        s = summary.get(row["date"]) or {}
        f = (food or {}).get(row["date"]) or {}
        row["burned"] = s.get("totalKilocalories")
        row["eaten"] = f.get("kcal") if f.get("entries") else None
        for k in ("protein", "carbs", "fat"):
            row[k] = f.get(k) if f.get("entries") else None
    _, latest_ts = _latest_daily("tstatus", 7)
    profile = db.get_blob("profile") or {}
    weights = db.get_blob("weights") or []
    return {
        "days": rows,
        "trainingStatus": latest_ts,
        "weights": weights,
        "profileWeight": (profile.get("weight") or 0) / 1000 or None,
        "nutrition": {"enabled": nutrition.enabled(), "available": food is not None, "link": nutrition.link()},
    }


def activity_view(act_id: int) -> dict[str, Any] | None:
    found = db.activity(act_id)
    if not found:
        return None
    summary, detail = found
    card = _act_card(summary)
    card.update({
        "maxHr": summary.get("maxHR"),
        "maxSpeed": summary.get("maxSpeed"),
        "gap": summary.get("avgGradeAdjustedSpeed"),
        "cadence": summary.get("averageRunningCadenceInStepsPerMinute") or summary.get("averageBikingCadenceInRevPerMinute"),
        "movingDuration": summary.get("movingDuration"),
        "elevationLoss": summary.get("elevationLoss"),
        "location": summary.get("locationName"),
        "maxPower": summary.get("maxPower"),
        "strideLength": summary.get("avgStrideLength"),
        "gct": summary.get("avgGroundContactTime"),
        "bodyBattery": summary.get("differenceBodyBattery"),
        "vo2max": summary.get("vO2MaxValue"),
    })
    return {"activity": card, "detail": detail}


def status_view(sync_status: dict) -> dict[str, Any]:
    return sync_status
