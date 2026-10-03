// Export-Studio: eine Einheit als Bild (PNG, auch transparent) oder kurzen Clip teilen.
// Gezeichnet wird komplett auf <canvas>. Farben kommen aus den CSS-Tokens beider Modi.

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, "Segoe UI", sans-serif';
const FORMATS = {
  story: { w: 1080, h: 1920, label: "Story 9:16" },
  post: { w: 1080, h: 1350, label: "Post 4:5" },
  square: { w: 1080, h: 1080, label: "1:1" },
};
const LAYOUTS = { classic: "Klassisch", sticker: "Sticker", poster: "Poster" };
const BGS = { transparent: "Ohne", liquid: "Liquid", aurora: "Aurora", night: "Nacht", topo: "Topo", sport: "Farbe" };
const MODES = { dark: "Dunkel", light: "Hell" };
const LINES = { sport: "Sportfarbe", mono: "Einfarbig", pace: "Tempo-Verlauf", hr: "Puls-Verlauf" };
const FLAGS = { title: "Titel", date: "Datum", glow: "Glow", grain: "Körnung", card: "Glaskarte", markers: "Start/Ziel", sign: "Signatur" };
const TOKENS = ["page", "ink", "ink-2", "ink-3", "run", "bike", "gym", "other", "good", "warn", "critical", "accent", "light", "blob-4"];
const SPORT_TOKEN = { running: "run", cycling: "bike", strength: "gym", other: "other" };
const STORE = "export-studio-v1";
const MAX_STATS = 6;
const CLIP_MS = 6000;
const BINS = 24;

const studio = document.getElementById("studio");
const studioBg = document.getElementById("studio-bg");
const q = (sel) => studio.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let data = null;       // Payload aus app.js
let P = null;          // Tokens {light, dark}
let st = null;         // Einstellungen
let geo = null;        // projizierte Strecke
let seriesCache = {};
let topoCache = null;
let grainTile = null;
let iconP = [];
let logo = null;
let raf = 0, introStart = 0, previewScale = 1, observer = null;
let pending = null;    // fertige Datei, falls Teilen eine neue Nutzergeste braucht
let busy = false;
let SC = 1;            // Zeichenmassstab (shadowBlur/filter werden nicht mittransformiert)

// --- Farben -------------------------------------------------------------------

function readTokens() {
  const root = document.documentElement, prev = root.getAttribute("data-theme");
  const read = (mode) => {
    root.setAttribute("data-theme", mode);
    const cs = getComputedStyle(root);
    return Object.fromEntries(TOKENS.map((t) => [t, cs.getPropertyValue(`--${t}`).trim()]));
  };
  const out = { light: read("light"), dark: read("dark") };
  if (prev == null) root.removeAttribute("data-theme"); else root.setAttribute("data-theme", prev);
  return out;
}

function parse(c) {
  c = String(c).trim();
  if (c.startsWith("#")) {
    let h = c.slice(1);
    if (h.length === 3) h = [...h].map((x) => x + x).join("");
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/[\d.]+/g) || [0, 0, 0];
  return [+m[0], +m[1], +m[2]];
}
const rgba = (c, a) => { const [r, g, b] = parse(c); return `rgba(${r},${g},${b},${a})`; };
function mix(c1, c2, t) {
  const a = parse(c1), b = parse(c2);
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
}
function rampAt(ramp, v) {
  const x = Math.max(0, Math.min(1, v)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  return mix(ramp[i], ramp[i + 1], x - i);
}

function palette() {
  const dark = st.bg === "sport" || st.mode === "dark";
  const t = dark ? P.dark : P.light;
  const sport = t[SPORT_TOKEN[data.sport] || "other"];
  const others = [t.run, t.bike, t.gym].filter((c) => c !== sport);
  const onColor = st.bg === "sport";
  return {
    dark, t, sport, others,
    ink: onColor ? "#ffffff" : t.ink,
    ink2: onColor ? "rgba(255,255,255,0.86)" : t["ink-2"],
    ink3: onColor ? "rgba(255,255,255,0.7)" : t["ink-3"],
  };
}

// --- Helfer -------------------------------------------------------------------

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (v) => 1 - Math.pow(1 - v, 3);
const easeIO = (v) => (v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2);
const reveal = (intro, delay, dur = 0.55) => easeOut(clamp01((intro - delay) / dur));

function font(ctx, weight, size, spacing = 0) {
  ctx.font = `${weight} ${Math.round(size * 10) / 10}px ${FONT}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
}
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fitText(ctx, s, maxW) {
  if (ctx.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (ctx.measureText(s.slice(0, m) + "…").width <= maxW) lo = m; else hi = m - 1;
  }
  return s.slice(0, lo).trimEnd() + "…";
}
function iconPaths(svg) {
  const out = [];
  for (const m of svg.matchAll(/<path d="([^"]+)"/g)) out.push(new Path2D(m[1]));
  for (const m of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
    const p = new Path2D(); p.arc(+m[1], +m[2], +m[3], 0, Math.PI * 2); out.push(p);
  }
  return out;
}
function drawIcon(ctx, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
  iconP.forEach((p) => ctx.stroke(p));
  ctx.restore();
}
function textShadow(ctx, T) {
  if (st.bg !== "transparent") return;
  ctx.shadowColor = T.dark ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.45)";
  ctx.shadowBlur = 16 * SC;
}
const picked = () => st.stats.map((k) => data.stats.find((s) => s.key === k)).filter(Boolean);
const motifOk = (m) => m === "none" || (m === "route" ? (data.route || []).length > 1
  : (data.series?.[m] || []).filter((v) => v != null).length > 10);

// --- Hintergruende ------------------------------------------------------------

function blob(ctx, W, H, cx, cy, r, color, a) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.55, rgba(color, a * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
function vignette(ctx, W, H, a) {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.78);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function paintBackground(ctx, W, H, T, time, bg) {
  if (bg === "transparent") return;
  const t = T.t, R = Math.max(W, H), dark = T.dark;
  const wob = (k, a, b) => [Math.sin(time * 0.13 + k * 1.9) * W * a, Math.cos(time * 0.1 + k * 2.7) * H * b];

  if (bg === "liquid") {
    ctx.fillStyle = t.page; ctx.fillRect(0, 0, W, H);
    const cols = [T.sport, ...T.others, t["blob-4"]].slice(0, 4);
    const pos = [[0.12, 0.14, 0.62], [0.96, 0.4, 0.55], [0.22, 0.9, 0.5], [0.9, 0.96, 0.45]];
    const al = dark ? [0.6, 0.44, 0.34, 0.34] : [0.5, 0.38, 0.3, 0.3];
    cols.forEach((c, k) => {
      const [dx, dy] = wob(k, 0.09, 0.05);
      blob(ctx, W, H, pos[k][0] * W + dx, pos[k][1] * H + dy, R * pos[k][2], c, al[k]);
    });
  } else if (bg === "aurora") {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, dark ? "#04060c" : t.page);
    g.addColorStop(1, dark ? "#0b0d18" : mix(t.page, "#ffffff", 0.6));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    const bands = [[T.sport, 0.3, 0.2, -0.38], [T.others[1] || t.gym, 0.62, 0.42, 0.28], [T.others[0], 0.78, 0.7, -0.16], [T.sport, 0.2, 0.86, 0.2]];
    bands.forEach(([c, bx, by, ang], k) => {
      const cx = W * (bx + 0.07 * Math.sin(time * 0.12 + k)), cy = H * (by + 0.035 * Math.cos(time * 0.09 + k * 2));
      const r = R * 0.5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang + 0.1 * Math.sin(time * 0.07 + k));
      ctx.scale(1.7, 0.3 + 0.05 * Math.sin(time * 0.21 + k));
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      const a = dark ? 0.34 : 0.26;
      gr.addColorStop(0, rgba(c, a)); gr.addColorStop(0.5, rgba(c, a * 0.35)); gr.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = gr; ctx.fillRect(-r, -r, 2 * r, 2 * r);
      ctx.restore();
    });
    ctx.globalCompositeOperation = "source-over";
    vignette(ctx, W, H, dark ? 0.5 : 0.1);
  } else if (bg === "night") {
    ctx.fillStyle = dark ? "#030406" : t.page; ctx.fillRect(0, 0, W, H);
    blob(ctx, W, H, W * 0.5, H * 0.42, R * (0.5 + 0.03 * Math.sin(time * 0.6)), T.sport, dark ? 0.3 : 0.2);
    ctx.fillStyle = rgba(T.ink, dark ? 0.11 : 0.13);
    const sp = 44;
    for (let y = sp / 2; y < H; y += sp) for (let x = sp / 2; x < W; x += sp) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    vignette(ctx, W, H, dark ? 0.6 : 0.12);
  } else if (bg === "topo") {
    ctx.fillStyle = t.page; ctx.fillRect(0, 0, W, H);
    blob(ctx, W, H, W * 0.9, H * 0.08, R * 0.62, T.sport, dark ? 0.26 : 0.2);
    blob(ctx, W, H, W * 0.08, H * 0.94, R * 0.5, T.others[0], dark ? 0.18 : 0.14);
    const topo = topoPaths(W, H);
    ctx.save();
    ctx.translate(Math.sin(time * 0.05) * 30 - 40, Math.cos(time * 0.04) * 30 - 40);
    ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(T.ink, dark ? 0.1 : 0.12); ctx.stroke(topo.thin);
    ctx.lineWidth = 2.6; ctx.strokeStyle = rgba(T.ink, dark ? 0.18 : 0.2); ctx.stroke(topo.thick);
    ctx.restore();
  } else if (bg === "sport") {
    const g = ctx.createLinearGradient(0, 0, W * 0.6, H);
    g.addColorStop(0, mix(T.sport, "#ffffff", 0.14));
    g.addColorStop(1, mix(T.sport, "#000000", 0.42));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    blob(ctx, W, H, W * (0.18 + 0.06 * Math.sin(time * 0.2)), H * 0.12, R * 0.6, "#ffffff", 0.22);
    blob(ctx, W, H, W * 0.92, H * (0.86 + 0.04 * Math.cos(time * 0.17)), R * 0.55, t["blob-4"], 0.38);
    vignette(ctx, W, H, 0.28);
  }
}

// Hoehenlinien per Marching Squares aus einem glatten Feld (je Einheit eigene Phase)
const SEG = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 5: [[0, 1], [3, 2]], 6: [[0, 2]], 7: [[3, 0]],
  8: [[3, 0]], 9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] };
function topoPaths(W, H) {
  const key = `${W}x${H}`;
  if (topoCache?.key === key) return topoCache;
  const seed = ((data.id || 1) % 997) / 997 * Math.PI * 2;
  const Wd = W + 80, Hd = H + 80, cs = 18;
  const nx = Math.ceil(Wd / cs) + 1, ny = Math.ceil(Hd / cs) + 1;
  const F = new Float32Array(nx * ny);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * cs, y = j * cs;
    const v = Math.sin(x * 0.0041 + seed) * Math.cos(y * 0.0033 - seed * 0.7)
      + 0.6 * Math.sin((x + y) * 0.0024 + seed * 1.3)
      + 0.35 * Math.cos(x * 0.0087 - y * 0.0061 + seed * 2.1)
      + 0.2 * Math.sin(y * 0.011 + x * 0.002 - seed);
    F[j * nx + i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const thin = new Path2D(), thick = new Path2D(), levels = 18;
  for (let l = 1; l < levels; l++) {
    const v = lo + ((hi - lo) * l) / levels, path = l % 4 === 0 ? thick : thin;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = F[j * nx + i], b = F[j * nx + i + 1], c = F[(j + 1) * nx + i + 1], d = F[(j + 1) * nx + i];
      const idx = (a > v ? 8 : 0) | (b > v ? 4 : 0) | (c > v ? 2 : 0) | (d > v ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = i * cs, y = j * cs;
      const e = [
        () => [x + (cs * (v - a)) / (b - a), y],
        () => [x + cs, y + (cs * (v - b)) / (c - b)],
        () => [x + (cs * (v - d)) / (c - d), y + cs],
        () => [x, y + (cs * (v - a)) / (d - a)],
      ];
      for (const [p, r] of SEG[idx]) {
        const [x1, y1] = e[p](), [x2, y2] = e[r]();
        path.moveTo(x1, y1); path.lineTo(x2, y2);
      }
    }
  }
  topoCache = { key, thin, thick };
  return topoCache;
}

function paintGrain(ctx, W, H, T) {
  if (!grainTile) {
    grainTile = document.createElement("canvas");
    grainTile.width = grainTile.height = 160;
    const g = grainTile.getContext("2d"), img = g.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  ctx.save();
  ctx.globalAlpha = T.dark ? 0.07 : 0.1;
  ctx.globalCompositeOperation = T.dark ? "screen" : "overlay";
  ctx.fillStyle = ctx.createPattern(grainTile, "repeat");
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function glassCard(ctx, x, y, w, h, T, a) {
  if (a <= 0) return;
  const r = Math.min(48, h / 2);
  ctx.save();
  ctx.globalAlpha *= a;
  // Milchglas: Hintergrund unter der Karte weichzeichnen (wo der Browser Canvas-Filter kann)
  if (st.bg !== "transparent" && "filter" in ctx) {
    ctx.save();
    rr(ctx, x, y, w, h, r); ctx.clip();
    const b = 40;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${Math.max(1, Math.round(26 * SC))}px)`;
    const sx = Math.max(0, (x - b) * SC), sy = Math.max(0, (y - b) * SC);
    const sw = Math.min(ctx.canvas.width - sx, (w + 2 * b) * SC), sh = Math.min(ctx.canvas.height - sy, (h + 2 * b) * SC);
    if (sw > 0 && sh > 0) ctx.drawImage(ctx.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
    ctx.restore();
  }
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = T.dark ? "rgba(34,36,46,0.42)" : "rgba(255,255,255,0.52)";
  if (st.bg === "sport") ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fill();
  const s = ctx.createLinearGradient(x, y, x + w * 0.55, y + h * 0.9);
  s.addColorStop(0, "rgba(255,255,255,0.12)"); s.addColorStop(0.38, "rgba(255,255,255,0)");
  ctx.fillStyle = s; ctx.fill();
  const g = ctx.createLinearGradient(x, y, x + w * 0.35, y + h);
  g.addColorStop(0, T.dark ? "rgba(255,255,255,0.34)" : "rgba(255,255,255,0.95)");
  g.addColorStop(0.5, T.dark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.45)");
  g.addColorStop(1, T.dark ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.75)");
  ctx.lineWidth = 2; ctx.strokeStyle = g; ctx.stroke();
  ctx.restore();
}

// --- Strecke & Kurven ---------------------------------------------------------

function prepRoute(pts) {
  if (!pts || pts.length < 2) return null;
  const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const total = cum[cum.length - 1] || 1;
  return {
    xs, ys, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys),
    frac: cum.map((c) => c / total), vals: {},
  };
}

// Serienwert (Tempo/Puls) je Streckenpunkt, ueber die relative Distanz zugeordnet, 0..1 normiert
function routeValues(key) {
  if (key in geo.vals) return geo.vals[key];
  const S = data.series || {}, arr = S[key];
  if (!arr) return (geo.vals[key] = null);
  const n = arr.length;
  const clean = arr.map((v) => (v == null || (key === "v" && v < 0.5) ? null : v));
  const w = Math.max(2, Math.round(n * 0.012));
  const sm = clean.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) if (clean[j] != null) { s += clean[j]; c++; }
    return c ? s / c : null;
  });
  const sorted = sm.filter((v) => v != null).sort((a, b) => a - b);
  if (sorted.length < 10) return (geo.vals[key] = null);
  const lo = sorted[Math.floor(sorted.length * 0.05)], hi = sorted[Math.floor(sorted.length * 0.95)];
  const dist = S.d && S.d.length === n ? S.d : null;
  const dmax = dist ? Math.max(...dist.filter((v) => v != null)) : n - 1;
  let j = 0;
  const out = geo.frac.map((f) => {
    if (dist) { const target = f * dmax; while (j < n - 1 && (dist[j + 1] ?? -1) < target) j++; }
    else j = Math.round(f * (n - 1));
    const v = sm[j];
    return v == null ? null : clamp01((v - lo) / (hi - lo || 1));
  });
  return (geo.vals[key] = { out, lo, hi });
}

function lineColor(T) {
  if (st.line === "mono") return T.ink;
  return st.bg === "sport" ? "#ffffff" : T.sport;
}
function rampFor(kind, T) {
  if (st.bg === "sport") return [mix(T.sport, "#ffffff", 0.45), "#ffffff"];
  return kind === "hr" ? [T.t.light, T.t.warn, T.t.critical] : [T.t.light, T.sport, T.t.warn];
}

function dot(ctx, x, y, r, fill, stroke, lw) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke();
}

function drawRoute(ctx, x, y, w, h, T, p) {
  const R = geo;
  if (!R) return;
  const spanX = R.maxX - R.minX || 1e-9, spanY = R.maxY - R.minY || 1e-9;
  const lw = Math.max(6, Math.min(12, Math.min(w, h) / 58));
  const inset = lw * 2.4;
  const s = Math.min((w - 2 * inset) / spanX, (h - 2 * inset) / spanY);
  const ox = x + (w - spanX * s) / 2, oy = y + (h - spanY * s) / 2;
  const X = (i) => ox + (R.xs[i] - R.minX) * s, Y = (i) => oy + (R.ys[i] - R.minY) * s;
  const n = R.xs.length, upto = p * (n - 1), last = Math.floor(upto), fr = upto - last;
  const tail = last < n - 1 && fr > 0 ? [X(last) + (X(last + 1) - X(last)) * fr, Y(last) + (Y(last + 1) - Y(last)) * fr] : null;
  const full = new Path2D();
  full.moveTo(X(0), Y(0));
  for (let i = 1; i <= last; i++) full.lineTo(X(i), Y(i));
  if (tail) full.lineTo(tail[0], tail[1]);

  const grad = st.line === "pace" || st.line === "hr" ? routeValues(st.line === "pace" ? "v" : "hr") : null;
  const base = lineColor(T);
  ctx.save();
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = rgba(grad ? T.ink : base, grad ? 0.1 : 0.25);
  ctx.lineWidth = lw * 2.8;
  ctx.stroke(full);
  if (st.glow) { ctx.shadowBlur = lw * 3 * SC; ctx.shadowColor = rgba(base, 0.85); }
  ctx.lineWidth = lw;
  if (!grad) {
    ctx.strokeStyle = base; ctx.stroke(full);
  } else {
    const ramp = rampFor(st.line, T);
    let bin = -1, path = null;
    const flush = () => {
      if (!path) return;
      const c = rampAt(ramp, bin / (BINS - 1));
      ctx.strokeStyle = c;
      if (st.glow) ctx.shadowColor = rgba(c, 0.8);
      ctx.stroke(path);
    };
    const end = Math.min(n - 1, last + (tail ? 1 : 0));
    for (let i = 1; i <= end; i++) {
      const v = grad.out[i] ?? grad.out[i - 1] ?? 0.5;
      const b = Math.round(v * (BINS - 1));
      const pt = i > last ? tail : [X(i), Y(i)];
      if (b !== bin) { flush(); bin = b; path = new Path2D(); path.moveTo(X(i - 1), Y(i - 1)); }
      path.lineTo(pt[0], pt[1]);
    }
    flush();
  }
  ctx.shadowBlur = 0;
  if (st.markers) {
    const mr = lw * 1.25;
    dot(ctx, X(0), Y(0), mr, T.t.good, "#ffffff", lw * 0.5);
    if (p >= 1) dot(ctx, X(n - 1), Y(n - 1), mr, "#111318", "#ffffff", lw * 0.5);
  }
  ctx.restore();
}

const SERIES_TITLE = { e: "Höhenprofil", hr: "Herzfrequenz", v: "Tempo" };
function paceStr(v) {
  if (!v) return "–";
  const sec = 1000 / v, m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}
function seriesGeo(key) {
  if (key in seriesCache) return seriesCache[key];
  const S = data.series || {}, arr = S[key];
  if (!arr) return (seriesCache[key] = null);
  const xsrc = S.d?.length === arr.length ? S.d : S.t?.length === arr.length ? S.t : null;
  const pts = [];
  arr.forEach((v, i) => {
    if (v == null || (key === "v" && v < 0.8)) return;
    const xv = xsrc ? xsrc[i] : i;
    if (xv != null) pts.push([xv, v]);
  });
  if (pts.length < 10) return (seriesCache[key] = null);
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  const NB = 220, sum = new Float64Array(NB), cnt = new Uint32Array(NB);
  for (const [xv, v] of pts) {
    const b = Math.min(NB - 1, Math.max(0, Math.floor(((xv - x0) / (x1 - x0 || 1)) * NB)));
    sum[b] += v; cnt[b]++;
  }
  let out = [];
  for (let b = 0; b < NB; b++) if (cnt[b]) out.push([(b + 0.5) / NB, sum[b] / cnt[b]]);
  if (key !== "e") out = out.map(([f], i) => {
    const win = out.slice(Math.max(0, i - 2), i + 3);
    return [f, win.reduce((a, o) => a + o[1], 0) / win.length];
  });
  const sorted = out.map((o) => o[1]).sort((a, b) => a - b);
  let lo = key === "e" ? sorted[0] : sorted[Math.floor(sorted.length * 0.03)];
  let hi = key === "e" ? sorted[sorted.length - 1] : sorted[Math.floor(sorted.length * 0.97)];
  const span = hi - lo || 1;
  const bottom = key === "e" ? lo - span * 0.6 : lo - span * 0.1, top = hi + span * 0.12;
  const running = data.sport === "running";
  const title = key === "v" ? (running ? "Pace" : "Tempo") : SERIES_TITLE[key];
  const rawMax = Math.max(...pts.map((p) => p[1])), rawMin = Math.min(...pts.map((p) => p[1]));
  const label = key === "hr" ? `max ${Math.round(rawMax)} bpm`
    : key === "e" ? `${Math.round(rawMin)}–${Math.round(rawMax)} m`
      : running ? `bis ${paceStr(hi)} /km` : `bis ${(hi * 3.6).toFixed(1).replace(".", ",")} km/h`;
  return (seriesCache[key] = { pts: out.map(([f, v]) => [f, clamp01((v - bottom) / (top - bottom))]), title, label });
}

function drawSeries(ctx, x, y, w, h, T, p, key) {
  const C = seriesGeo(key);
  if (!C) return;
  const color = st.line === "mono" ? T.ink : key === "hr" && st.bg !== "sport" ? T.t.critical : lineColor(T);
  const cap = Math.min(28, h * 0.08);
  ctx.save();
  font(ctx, 600, cap, cap * 0.06);
  ctx.fillStyle = T.ink3; ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left"; ctx.fillText(C.title.toUpperCase(), x, y + cap);
  font(ctx, 600, cap);
  ctx.textAlign = "right"; ctx.fillText(C.label, x + w, y + cap);
  const top = y + cap * 2.2, hh = h - cap * 2.2;
  const X = (f) => x + f * w, Y = (v) => top + hh - v * hh;
  const shown = C.pts.filter(([f]) => f <= p + 1e-9);
  if (shown.length > 1) {
    const line = new Path2D();
    shown.forEach(([f, v], i) => (i ? line.lineTo(X(f), Y(v)) : line.moveTo(X(f), Y(v))));
    const area = new Path2D(line);
    area.lineTo(X(shown[shown.length - 1][0]), top + hh);
    area.lineTo(X(shown[0][0]), top + hh);
    area.closePath();
    const g = ctx.createLinearGradient(0, top, 0, top + hh);
    g.addColorStop(0, rgba(color, 0.42)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.fill(area);
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 6; ctx.strokeStyle = color;
    if (st.glow) { ctx.shadowBlur = 18 * SC; ctx.shadowColor = rgba(color, 0.8); }
    ctx.stroke(line);
    ctx.shadowBlur = 0;
    const [lf, lv] = shown[shown.length - 1];
    dot(ctx, X(lf), Y(lv), 10, color, T.dark ? "#111318" : "#ffffff", 4);
  }
  ctx.restore();
}

function drawMotif(ctx, x, y, w, h, T, intro) {
  if (h < 80 || st.motif === "none" || !motifOk(st.motif)) return;
  const p = easeIO(clamp01((intro - 0.2) / 1.8));
  if (st.motif === "route") drawRoute(ctx, x, y, w, h, T, p);
  else drawSeries(ctx, x, y, w, h, T, p, st.motif);
}

// --- Texte ---------------------------------------------------------------------

const statH = (ls, vs) => ls * 1.55 + vs * 0.78;

function valueWidth(ctx, s, vs) {
  font(ctx, 700, vs, -vs * 0.02);
  const vw = ctx.measureText(s.value).width;
  font(ctx, 600, vs * 0.42);
  return vw + (s.unit ? ctx.measureText(s.unit).width + vs * 0.1 : 0);
}
function fitVs(ctx, stats, vs, cw) {
  let k = 1;
  for (const s of stats) k = Math.min(k, (cw * 0.96) / (valueWidth(ctx, s, vs) || 1));
  return vs * k;
}

function drawStat(ctx, s, x, y, o) {
  const { ls, vs, T } = o, a = o.a ?? 1;
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  y += (1 - a) * 24;
  textShadow(ctx, T);
  ctx.textBaseline = "alphabetic";
  font(ctx, 600, ls, ls * 0.07);
  ctx.fillStyle = T.ink3;
  ctx.textAlign = o.center ? "center" : "left";
  ctx.fillText(s.label.toUpperCase(), x, y + ls * 0.8);
  const total = valueWidth(ctx, s, vs);
  font(ctx, 700, vs, -vs * 0.02);
  const vw = ctx.measureText(s.value).width;
  const vx = o.center ? x - total / 2 : x, yb = y + ls * 1.55 + vs * 0.72;
  ctx.textAlign = "left";
  ctx.fillStyle = T.ink;
  ctx.fillText(s.value, vx, yb);
  if (s.unit) {
    font(ctx, 600, vs * 0.42);
    ctx.fillStyle = T.ink3;
    ctx.fillText(s.unit, vx + vw + vs * 0.1, yb);
  }
  ctx.restore();
}

function drawHeader(ctx, x, y, w, T, size, a) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.translate(0, (1 - a) * 16);
  rr(ctx, x, y, size, size, size * 0.28);
  ctx.fillStyle = st.bg === "sport" ? "rgba(255,255,255,0.22)" : T.sport;
  ctx.fill();
  drawIcon(ctx, x + size * 0.2, y + size * 0.2, size * 0.6, "#ffffff");
  textShadow(ctx, T);
  const tx = x + size * 1.3, tw = w - size * 1.3;
  const ts = size * 0.5, ds = size * 0.31;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const title = () => { font(ctx, 700, ts, -ts * 0.01); ctx.fillStyle = T.ink; return fitText(ctx, data.title, tw); };
  const date = () => { font(ctx, 500, ds); ctx.fillStyle = T.ink2; return fitText(ctx, data.date, tw); };
  if (st.title && st.date) {
    const t1 = title(); ctx.fillText(t1, tx, y + size * 0.48);
    const t2 = date(); ctx.fillText(t2, tx, y + size * 0.88);
  } else if (st.title) {
    const t1 = title(); ctx.fillText(t1, tx, y + size / 2 + ts * 0.36);
  } else {
    const t2 = date(); ctx.fillText(t2, tx, y + size / 2 + ds * 0.36);
  }
  ctx.restore();
}

function drawSign(ctx, W, B, T, a) {
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha *= a * 0.9;
  textShadow(ctx, T);
  const size = 44, gap = 14, cy = B.bottom - 22;
  font(ctx, 650, 28, 0.5);
  const label = "Training";
  const tw = ctx.measureText(label).width;
  const hasLogo = logo && logo.complete && logo.naturalWidth;
  const total = (hasLogo ? size + gap : 0) + tw;
  let x = (W - total) / 2;
  if (hasLogo) {
    ctx.save(); ctx.shadowBlur = 0;
    rr(ctx, x, cy - size / 2, size, size, 12); ctx.clip();
    ctx.drawImage(logo, x, cy - size / 2, size, size);
    ctx.restore();
    x += size + gap;
  }
  ctx.fillStyle = T.ink2; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(label, x, cy + 1);
  ctx.restore();
}

// --- Layouts -------------------------------------------------------------------

function contentBox(W, H) {
  const pad = 80, story = H / W > 1.6;
  const top = pad + (story ? 170 : 0), bottom = H - pad - (story ? 210 : 0);
  return { x: pad, y: top, w: W - 2 * pad, bottom, end: st.sign ? bottom - 90 : bottom };
}

function layoutClassic(ctx, W, H, T, intro, B) {
  let top = B.y, bottom = B.end;
  if (st.title || st.date) { drawHeader(ctx, B.x, top, B.w, T, 96, reveal(intro, 0.05)); top += 96 + 60; }
  const stats = picked();
  if (stats.length) {
    const cols = stats.length <= 3 ? stats.length : stats.length === 4 ? 2 : 3;
    const rows = Math.ceil(stats.length / cols);
    const cp = st.card ? 48 : 0;
    const cw = (B.w - 2 * cp) / cols;
    const ls = 26;
    const vs = fitVs(ctx, stats, cols === 1 ? 124 : cols === 2 ? 100 : 82, cw - 18);
    const rh = statH(ls, vs), gy = 44;
    const boxH = rows * rh + (rows - 1) * gy + 2 * cp;
    const y0 = bottom - boxH;
    if (st.card) glassCard(ctx, B.x, y0, B.w, boxH, T, reveal(intro, 0.2));
    stats.forEach((s, i) => drawStat(ctx, s, B.x + cp + (i % cols) * cw, y0 + cp + Math.floor(i / cols) * (rh + gy),
      { ls, vs, T, a: reveal(intro, 0.3 + i * 0.08) }));
    bottom = y0 - 56;
  }
  drawMotif(ctx, B.x, top, B.w, bottom - top, T, intro);
}

function layoutSticker(ctx, W, H, T, intro, B) {
  const stats = picked();
  const avail = B.end - B.y;
  const hasMotif = st.motif !== "none" && motifOk(st.motif);
  const headT = st.title ? 50 : 0, headD = st.date ? 32 : 0;
  const head = headT + headD + (headT && headD ? 14 : 0);
  let ls = 30, vs = fitVs(ctx, stats, 128, B.w * 0.86), gap = 46;
  let mW = Math.min(B.w * 0.8, 700), mH = hasMotif ? Math.min(B.w * 0.55, 480) : 0;
  const cp = st.card ? 60 : 0;
  const parts = [head, stats.length ? stats.length * statH(ls, vs) + (stats.length - 1) * gap : 0, mH].filter((v) => v > 0);
  const total = parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * 56 + 2 * cp;
  const f = Math.min(1, avail / total);
  ls *= f; vs *= f; gap *= f; mH *= f; mW *= Math.max(f, 0.8);
  let y = B.y + (avail - total * f) / 2;
  const cx = W / 2;
  if (st.card) {
    let widest = mW;
    for (const s of stats) widest = Math.max(widest, valueWidth(ctx, s, vs));
    if (head) { font(ctx, 700, headT * f); widest = Math.max(widest, Math.min(B.w - 2 * cp, ctx.measureText(data.title).width)); }
    const cw = Math.min(B.w, widest + 2 * cp);
    glassCard(ctx, cx - cw / 2, y, cw, total * f, T, reveal(intro, 0.15));
  }
  y += cp * f;
  if (head) {
    const a = reveal(intro, 0.05);
    ctx.save(); ctx.globalAlpha *= a; textShadow(ctx, T);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    if (st.title) {
      font(ctx, 700, headT * f, -0.5); ctx.fillStyle = T.ink;
      ctx.fillText(fitText(ctx, data.title, B.w - 2 * cp), cx, y + headT * f * 0.82);
    }
    if (st.date) {
      font(ctx, 500, headD * f); ctx.fillStyle = T.ink2;
      ctx.fillText(data.date, cx, y + (headT ? headT + 14 : 0) * f + headD * f * 0.82);
    }
    ctx.restore();
    y += head * f + 56 * f;
  }
  stats.forEach((s, i) => {
    drawStat(ctx, s, cx, y, { ls, vs, T, center: true, a: reveal(intro, 0.3 + i * 0.1) });
    y += statH(ls, vs) + gap;
  });
  if (stats.length) y += 56 * f - gap;
  if (hasMotif) drawMotif(ctx, cx - mW / 2, y, mW, mH, T, intro);
}

function layoutPoster(ctx, W, H, T, intro, B) {
  const stats = picked(), hero = stats[0], rest = stats.slice(1);
  let top = B.y;
  if (st.title || st.date) { drawHeader(ctx, B.x, top, B.w, T, 76, reveal(intro, 0.05)); top += 76 + 50; }
  const cp = st.card ? 52 : 0;
  const cols = Math.min(3, rest.length) || 1, rows = Math.ceil(rest.length / cols);
  const cw = (B.w - 2 * cp) / cols;
  const hls = 30, hvs = hero ? fitVs(ctx, [hero], H / W > 1.6 ? 240 : 196, B.w - 2 * cp) : 0;
  const rls = 24, rvs = rest.length ? fitVs(ctx, rest, 66, cw - 18) : 0;
  const heroH = hero ? statH(hls, hvs) : 0;
  const restH = rows && rest.length ? rows * statH(rls, rvs) + (rows - 1) * 34 : 0;
  const blockH = stats.length ? heroH + (rest.length ? 72 + restH : 0) + 2 * cp : 0;
  const y0 = B.end - blockH;
  if (st.card && stats.length) glassCard(ctx, B.x, y0, B.w, blockH, T, reveal(intro, 0.2));
  if (hero) drawStat(ctx, hero, B.x + cp, y0 + cp, { ls: hls, vs: hvs, T, a: reveal(intro, 0.3) });
  if (rest.length) {
    const ly = y0 + cp + heroH + 34;
    const a = reveal(intro, 0.4);
    ctx.save(); ctx.globalAlpha *= a;
    ctx.fillStyle = rgba(T.ink, 0.14); ctx.fillRect(B.x + cp, ly, (B.w - 2 * cp) * a, 2);
    ctx.restore();
    rest.forEach((s, i) => drawStat(ctx, s, B.x + cp + (i % cols) * cw, ly + 38 + Math.floor(i / cols) * (statH(rls, rvs) + 34),
      { ls: rls, vs: rvs, T, a: reveal(intro, 0.45 + i * 0.08) }));
  }
  drawMotif(ctx, B.x, top, B.w, (stats.length ? y0 - 60 : B.end) - top, T, intro);
}

function render(ctx, W, H, scale, time, intro) {
  SC = scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const T = palette();
  paintBackground(ctx, W, H, T, time, st.bg);
  if (st.grain && st.bg !== "transparent") paintGrain(ctx, W, H, T);
  const B = contentBox(W, H);
  ({ classic: layoutClassic, sticker: layoutSticker, poster: layoutPoster }[st.layout] || layoutClassic)(ctx, W, H, T, intro, B);
  if (st.sign) drawSign(ctx, W, B, T, reveal(intro, 0.8));
}

// --- Einstellungen -------------------------------------------------------------

function loadState() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { /* privat */ }
  const s = {
    format: "story", layout: "classic", bg: "liquid", mode: "dark", line: "sport",
    title: true, date: true, glow: true, grain: true, card: true, markers: true, sign: true,
    ...(saved.common || {}),
  };
  if (!(s.format in FORMATS)) s.format = "story";
  if (!(s.layout in LAYOUTS)) s.layout = "classic";
  if (!(s.bg in BGS)) s.bg = "liquid";
  const per = saved.sport?.[data.sport] || {};
  const avail = new Set(data.stats.map((x) => x.key));
  const keys = (per.stats || data.defaults).filter((k) => avail.has(k));
  s.stats = (keys.length ? keys : data.defaults.filter((k) => avail.has(k))).slice(0, MAX_STATS);
  s.motif = per.motif && motifOk(per.motif) ? per.motif : ["route", "hr", "e", "none"].find(motifOk);
  if (!lineOk(s.line)) s.line = "sport";
  return s;
}
function saveState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
    const { stats, motif, ...common } = st;
    saved.common = common;
    saved.sport = { ...(saved.sport || {}), [data.sport]: { stats, motif } };
    localStorage.setItem(STORE, JSON.stringify(saved));
  } catch { /* privat */ }
}
const lineOk = (l) => l === "sport" || l === "mono" || (l === "pace" && data.series?.v) || (l === "hr" && data.series?.hr);

// --- Oberflaeche -----------------------------------------------------------------

const CAN_SHARE = (() => {
  try { return !!navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.png", { type: "image/png" })] }); }
  catch { return false; }
})();
const CAN_COPY = !!(window.ClipboardItem && navigator.clipboard?.write);
const CAN_CLIP = !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);

function motifLabels() {
  const out = { route: "Strecke", e: "Höhe", hr: "Puls", v: data.sport === "running" ? "Pace" : "Tempo", none: "Ohne" };
  return Object.fromEntries(Object.entries(out).filter(([k]) => motifOk(k)));
}
const seg = (name, opts) => `<div class="segment glass st-seg" data-seg="${name}">${Object.entries(opts)
  .map(([k, l]) => `<button type="button" data-v="${k}">${esc(l)}</button>`).join("")}</div>`;
const group = (title, body, extra = "") => `<div class="st-group" ${extra}><h3>${esc(title)}</h3>${body}</div>`;

function shell() {
  const x = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const lines = Object.entries(LINES).filter(([k]) => lineOk(k));
  return `<div class="studio-h">
      <div style="min-width:0"><h2>Exportieren</h2><div class="small muted">Bild oder Clip für Story, Feed und Strava</div></div>
      <button class="icon-btn glass" id="st-close" type="button" aria-label="Schließen">${x}</button>
    </div>
    <div class="studio-body">
      <div class="stage" id="st-stage"><div class="stage-frame" id="st-frame"><canvas id="st-canvas" role="img" aria-label="Vorschau"></canvas></div></div>
      <div class="studio-ctl">
        ${group("Format", seg("format", Object.fromEntries(Object.entries(FORMATS).map(([k, f]) => [k, f.label]))))}
        ${group("Layout", seg("layout", LAYOUTS))}
        ${group("Hintergrund", `<div class="swatches">${Object.entries(BGS).map(([k, l]) =>
          `<button type="button" class="swatch" data-bg="${k}"><canvas class="${k === "transparent" ? "checker" : ""}" width="96" height="128"></canvas><span>${esc(l)}</span></button>`).join("")}</div>`)}
        ${group("Modus", `${seg("mode", MODES)}<div class="tiny muted st-hint" id="st-mode-hint">Ohne Hintergrund bestimmt der Modus die Schriftfarbe: Dunkel = weiße Schrift für dunkle Fotos.</div>`)}
        ${group("Motiv", seg("motif", motifLabels()))}
        ${group("Linie", `<div class="chips">${lines.map(([k, l]) => `<button type="button" class="chip" data-line="${k}">${esc(l)}</button>`).join("")}</div>`, 'id="st-line"')}
        ${group(`Kennzahlen`, `<div class="chips">${data.stats.map((s) =>
          `<button type="button" class="chip" data-stat="${esc(s.key)}"><span class="n"></span>${esc(s.label)}</button>`).join("")}</div>
          <div class="tiny muted st-hint">Reihenfolge wie angetippt, höchstens ${MAX_STATS}.</div>`)}
        ${group("Details", `<div class="chips">${Object.entries(FLAGS).map(([k, l]) => `<button type="button" class="chip" data-flag="${k}">${esc(l)}</button>`).join("")}</div>`)}
      </div>
    </div>
    <div class="studio-actions">
      <span class="small muted st-msg" id="st-msg" role="status"></span>
      ${CAN_CLIP ? '<button class="sync-btn glass" id="st-clip" type="button">Clip</button>' : ""}
      ${CAN_COPY ? '<button class="sync-btn glass" id="st-copy" type="button">Kopieren</button>' : ""}
      ${CAN_SHARE ? '<button class="sync-btn glass" id="st-save" type="button">Sichern</button><button class="primary" id="st-share" type="button">Teilen</button>'
        : '<button class="primary" id="st-save" type="button">Bild sichern</button>'}
    </div>`;
}

function syncUI() {
  studio.querySelectorAll("[data-seg]").forEach((g) => g.querySelectorAll("button").forEach((b) => {
    const on = st[g.dataset.seg] === b.dataset.v;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
  }));
  studio.querySelectorAll("[data-bg]").forEach((b) => b.classList.toggle("on", b.dataset.bg === st.bg));
  studio.querySelectorAll("[data-line]").forEach((b) => b.classList.toggle("on", b.dataset.line === st.line));
  studio.querySelectorAll("[data-flag]").forEach((b) => b.classList.toggle("on", !!st[b.dataset.flag]));
  studio.querySelectorAll("[data-stat]").forEach((b) => {
    const i = st.stats.indexOf(b.dataset.stat);
    b.classList.toggle("on", i >= 0);
    b.querySelector(".n").textContent = i >= 0 ? String(i + 1) : "";
  });
  q("#st-line").hidden = st.motif !== "route";
  q("#st-mode-hint").hidden = st.bg !== "transparent";
  q("#st-frame").classList.toggle("checker", st.bg === "transparent");
  const clip = q("#st-clip");
  if (clip && !busy) {
    clip.disabled = st.bg === "transparent";
    clip.title = clip.disabled ? "Videos können keinen transparenten Hintergrund haben" : "6 Sekunden, Strecke zeichnet sich";
  }
}

function drawThumbs() {
  studio.querySelectorAll("[data-bg] canvas").forEach((c) => {
    const ctx = c.getContext("2d");
    SC = c.width / 1080;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(SC, 0, 0, SC, 0, 0);
    const bg = c.closest("[data-bg]").dataset.bg;
    const saved = st.bg; st.bg = bg;
    paintBackground(ctx, 1080, 1440, palette(), 0, bg);
    st.bg = saved;
  });
}

function sizeStage() {
  const stage = q("#st-stage"), frame = q("#st-frame"), cv = q("#st-canvas");
  if (!stage) return;
  const { w, h } = FORMATS[st.format];
  const cs = getComputedStyle(stage);
  const sw = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const sh = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const k = Math.max(0.05, Math.min(sw / w, sh / h));
  frame.style.width = `${Math.floor(w * k)}px`;
  frame.style.height = `${Math.floor(h * k)}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(w * k * dpr));
  cv.height = Math.max(1, Math.round(h * k * dpr));
  previewScale = cv.width / w;
  drawFrame(performance.now());
}

const nowTime = () => (reduced() ? 0 : performance.now() / 1000);
function drawFrame(now) {
  const cv = q("#st-canvas");
  if (!cv || !st) return;
  const { w, h } = FORMATS[st.format];
  render(cv.getContext("2d"), w, h, previewScale, reduced() ? 0 : now / 1000, reduced() ? 99 : (now - introStart) / 1000);
}
function restartIntro() { introStart = performance.now(); if (reduced()) drawFrame(introStart); }
function loop() {
  cancelAnimationFrame(raf);
  let last = 0;
  const tick = (now) => {
    if (!isStudioOpen()) return;
    raf = requestAnimationFrame(tick);
    if (reduced() || now - last < 32) return;
    last = now;
    drawFrame(now);
  };
  raf = requestAnimationFrame(tick);
}
function changed({ intro = false, size = false, thumbs = false } = {}) {
  pending = null;
  resetShareLabel();
  saveState();
  syncUI();
  if (thumbs) drawThumbs();
  if (size) sizeStage();
  if (intro) restartIntro();
  if (reduced()) drawFrame(performance.now());
}

function msg(text) { const m = q("#st-msg"); if (m) m.textContent = text || ""; }
function resetShareLabel() { const b = q("#st-clip"); if (b && !busy) b.textContent = "Clip"; }

function bind() {
  studio.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    if (b.id === "st-close") return closeStudio();
    const segEl = b.closest("[data-seg]");
    if (segEl) {
      const name = segEl.dataset.seg;
      if (st[name] === b.dataset.v) return;
      st[name] = b.dataset.v;
      return changed({ intro: name !== "mode", size: name === "format", thumbs: name === "mode" });
    }
    if (b.dataset.bg) { st.bg = b.dataset.bg; return changed(); }
    if (b.dataset.line) { st.line = b.dataset.line; return changed({ intro: true }); }
    if (b.dataset.flag) { st[b.dataset.flag] = !st[b.dataset.flag]; return changed(); }
    if (b.dataset.stat) {
      const k = b.dataset.stat, i = st.stats.indexOf(k);
      if (i >= 0) st.stats.splice(i, 1);
      else if (st.stats.length < MAX_STATS) st.stats.push(k);
      else { msg(`Höchstens ${MAX_STATS} Kennzahlen`); return; }
      msg("");
      return changed();
    }
    if (b.id === "st-save") return exportImage("save");
    if (b.id === "st-share") return exportImage("share");
    if (b.id === "st-copy") return copyImage();
    if (b.id === "st-clip") return pending?.type?.startsWith("video") ? shareFile(pending) : recordClip();
  };
}

// --- Export --------------------------------------------------------------------

function fileBase() {
  const slug = data.title.toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return `${data.day}-${slug || "training"}`;
}
function fullCanvas() {
  const { w, h } = FORMATS[st.format];
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function pngBlob() {
  const c = fullCanvas();
  render(c.getContext("2d"), c.width, c.height, 1, nowTime(), 99);
  return new Promise((res) => c.toBlob(res, "image/png"));
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
async function shareFile(file) {
  try {
    await navigator.share({ files: [file], title: data.title });
    pending = null; resetShareLabel();
    msg("Geteilt");
  } catch (e) {
    if (e.name === "AbortError") return;
    if (e.name === "NotAllowedError") { pending = file; msg("Fertig – bitte noch einmal tippen"); return; }
    download(file, file.name);
    msg("Gespeichert");
  }
}
async function exportImage(how) {
  if (how === "share" && pending?.type === "image/png") return shareFile(pending);
  msg("Wird erstellt…");
  const blob = await pngBlob();
  if (!blob) { msg("Export fehlgeschlagen"); return; }
  const name = `${fileBase()}.png`;
  if (how === "share" && CAN_SHARE) return shareFile(new File([blob], name, { type: "image/png" }));
  download(blob, name);
  msg("Gespeichert");
}
async function copyImage() {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob() })]);
    msg("In die Zwischenablage kopiert");
  } catch {
    msg("Kopieren nicht möglich (nur über HTTPS)");
  }
}

async function recordClip() {
  if (busy) return;
  const mime = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"]
    .find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) { msg("Video wird von diesem Browser nicht unterstützt"); return; }
  busy = true;
  const btn = q("#st-clip");
  btn.disabled = true;
  const c = fullCanvas();
  c.style.cssText = "position:fixed;left:-99999px;top:0;width:10px;height:10px;pointer-events:none";
  document.body.append(c);
  const ctx = c.getContext("2d");
  const stream = c.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((r) => (rec.onstop = r));
  render(ctx, c.width, c.height, 1, performance.now() / 1000, 0);
  rec.start(250);
  const t0 = performance.now();
  await new Promise((res) => {
    const step = (now) => {
      const el = now - t0;
      render(ctx, c.width, c.height, 1, now / 1000, el / 1000);
      btn.textContent = `Aufnahme ${Math.max(1, Math.ceil((CLIP_MS - el) / 1000))} s`;
      if (el < CLIP_MS && isStudioOpen()) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  c.remove();
  busy = false;
  btn.disabled = false;
  if (!isStudioOpen()) return;
  const type = mime.split(";")[0];
  const file = new File([new Blob(chunks, { type })], `${fileBase()}.${type === "video/mp4" ? "mp4" : "webm"}`, { type });
  if (CAN_SHARE && navigator.canShare({ files: [file] })) {
    pending = file;
    btn.textContent = "Clip teilen";
    msg("Clip fertig");
  } else {
    btn.textContent = "Clip";
    download(file, file.name);
    msg("Clip gespeichert");
  }
}

// --- Oeffentliche API ------------------------------------------------------------

export const isStudioOpen = () => studio.classList.contains("on");

export function openStudio(payload) {
  data = payload;
  P = readTokens();
  st = loadState();
  geo = prepRoute(data.route);
  seriesCache = {};
  topoCache = null;
  pending = null;
  iconP = iconPaths(data.iconSvg || "");
  if (!logo) { logo = new Image(); logo.src = "/icons/icon-192.png"; }
  studio.innerHTML = shell();
  bind();
  syncUI();
  studio.classList.add("on");
  studioBg.classList.add("on");
  drawThumbs();
  observer = new ResizeObserver(() => sizeStage());
  observer.observe(q("#st-stage"));
  sizeStage();
  restartIntro();
  loop();
  q("#st-close").focus({ preventScroll: true });
}

export function closeStudio() {
  if (!isStudioOpen()) return;
  studio.classList.remove("on");
  studioBg.classList.remove("on");
  cancelAnimationFrame(raf);
  observer?.disconnect();
  observer = null;
}
studioBg.addEventListener("click", closeStudio);
