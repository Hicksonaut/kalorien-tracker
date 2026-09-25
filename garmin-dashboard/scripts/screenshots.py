"""Screenshots des Dashboards fuer die README (mit Demo-Daten, siehe demo_data.py).

Braucht Playwright (`pip install playwright`) und Google Chrome. Der Server muss laufen:

    DATA_DIR=./data/demo SYNC_ENABLED=0 AUTH_ENABLED=0 ./.venv/bin/python -m uvicorn app.main:app --port 4310
    ./.venv/bin/python scripts/screenshots.py http://localhost:4310 ../docs/screenshots
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4310"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "screenshots")
OUT.mkdir(parents=True, exist_ok=True)

PHONE = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True}
DESKTOP = {"viewport": {"width": 1440, "height": 900}, "device_scale_factor": 2}

# (Datei, Geraet, Farbschema, Route, Aktion)
SHOTS = [
    ("dashboard-heute-dunkel.png", PHONE, "dark", "#/heute", None),
    ("dashboard-heute-hell.png", PHONE, "light", "#/heute", None),
    ("dashboard-woche.png", PHONE, "dark", "#/woche", None),
    ("dashboard-training.png", PHONE, "dark", "#/training/running", "scroll-charts"),
    ("dashboard-health.png", PHONE, "light", "#/health", "scroll-health"),
    ("dashboard-aktivitaet.png", PHONE, "dark", "#/training/running", "open-interval"),
    ("dashboard-desktop-heute.png", DESKTOP, "dark", "#/heute", None),
    ("dashboard-desktop-woche.png", DESKTOP, "light", "#/woche", None),
    ("dashboard-desktop-training.png", DESKTOP, "dark", "#/training/running", None),
    ("dashboard-energiebilanz.png", DESKTOP, "light", "#/health", "scroll-energy"),
]


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        for name, device, scheme, route, action in SHOTS:
            ctx = browser.new_context(**device, color_scheme=scheme, locale="de-DE",
                                      timezone_id="Europe/Berlin", reduced_motion="reduce")
            page = ctx.new_page()
            page.goto(f"{BASE}/{route}")
            page.wait_for_selector(".view", timeout=10000)
            page.wait_for_timeout(900)
            if action == "scroll-charts":
                page.evaluate("document.querySelector('.tiles').scrollIntoView({block: 'start'}); window.scrollBy(0, -20)")
            elif action == "scroll-health":
                page.evaluate("document.querySelector('#h-sleep').scrollIntoView({block: 'start'}); window.scrollBy(0, -250)")
            elif action == "scroll-energy":
                page.locator("[data-days='7']").click()
                page.wait_for_selector("#h-energy svg", timeout=10000)
                page.wait_for_timeout(600)
                page.evaluate("document.querySelector('#h-energy').closest('.card').scrollIntoView({block: 'start'}); window.scrollBy(0, -30)")
            elif action == "open-interval":
                page.locator(".row[data-act]", has_text="Intervalle").first.click()
                page.wait_for_selector("#d-hr svg", timeout=10000)
                page.wait_for_timeout(900)
            page.wait_for_timeout(400)
            page.screenshot(path=str(OUT / name))
            print("gespeichert:", OUT / name)
            ctx.close()
        browser.close()


if __name__ == "__main__":
    main()
