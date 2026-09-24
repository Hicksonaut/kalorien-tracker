"""Erzeugt die App-Icons im Stil des Training-Dashboards (Farbfelder + Glas + weisses Symbol).
Farben: Makro-Tokens (--protein, --carbs, --fat). Aufruf: python scripts/make_icons.py"""
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "web" / "icons"
S = 1024


def base(size=S, inset=0.0):
    img = Image.new("RGB", (size, size), (28, 26, 60))
    blobs = Image.new("RGB", (size, size), (40, 34, 96))
    d = ImageDraw.Draw(blobs)
    for (cx, cy, r, col) in [(0.05, 0.05, 0.75, (237, 161, 0)), (1.0, 0.1, 0.8, (74, 58, 167)),
                             (0.1, 1.0, 0.75, (232, 123, 164)), (0.95, 0.95, 0.55, (43, 35, 110))]:
        d.ellipse([(cx - r) * size, (cy - r) * size, (cx + r) * size, (cy + r) * size], fill=col)
    img = blobs.filter(ImageFilter.GaussianBlur(size * 0.16))
    # Glas-Rechteck
    g0, g1 = size * (0.2 + inset), size * (0.8 - inset)
    glass = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glass)
    rad = (g1 - g0) * 0.22
    gd.rounded_rectangle([g0, g0, g1, g1], rad, fill=(255, 255, 255, 52), outline=(255, 255, 255, 120), width=int(size * 0.006))
    img = Image.alpha_composite(img.convert("RGBA"), glass)
    # Symbol: Budget-Ring (3/4 gefuellt) mit Punkt am Ende
    sym = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sym)
    c, r, w = size / 2, (g1 - g0) * 0.27, (g1 - g0) * 0.075
    box = [c - r, c - r, c + r, c + r]
    sd.arc(box, 0, 360, fill=(255, 255, 255, 90), width=int(w))
    sd.arc(box, -90, 180, fill=(255, 255, 255, 255), width=int(w))
    for ang in (-90, 180):
        # runde Enden: Mittellinie des Bogens liegt bei r - w/2
        rr = r - w / 2
        x, y = c + rr * math.cos(math.radians(ang)), c + rr * math.sin(math.radians(ang))
        sd.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=(255, 255, 255, 255))
    img = Image.alpha_composite(img, sym)
    return img.convert("RGB")


OUT.mkdir(parents=True, exist_ok=True)
full = base()
full.resize((512, 512), Image.LANCZOS).save(OUT / "icon-512.png")
full.resize((192, 192), Image.LANCZOS).save(OUT / "icon-192.png")
full.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png")
base(inset=0.06).resize((512, 512), Image.LANCZOS).save(OUT / "icon-maskable-512.png")
print("ok")
