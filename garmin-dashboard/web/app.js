// Training Dashboard - Frontend ohne Build-Schritt.
// Alle Daten kommen aus der eigenen API (SQLite-Cache auf dem Pi).

const $ = (sel, root = document) => root.querySelector(sel);
const viewEl = $("#view");
const tipEl = $("#tip");

// --- Formatierung -----------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const pd = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (s) => { const d = pd(s); return `${WD[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`; };
const fmtShort = (s) => { const d = pd(s); return `${d.getDate()}.${d.getMonth() + 1}.`; };
const fmtTime = (s) => (s || "").slice(11, 16);
const n0 = (v) => (v == null || isNaN(v) ? "–" : Math.round(v).toLocaleString("de-DE"));
const n1 = (v) => (v == null || isNaN(v) ? "–" : (Math.round(v * 10) / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const km = (m) => (m == null ? "–" : (m / 1000).toLocaleString("de-DE", { minimumFractionDigits: m >= 100000 ? 0 : 1, maximumFractionDigits: m >= 100000 ? 0 : 1 }));
function dur(sec, long = false) {
  if (sec == null) return "–";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (long) return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}
const hm = (sec) => { if (sec == null) return "–"; const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return `${h}:${String(m).padStart(2, "0")}`; };
function pace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm)) return "–";
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
}
const paceFromSpeed = (v) => (v ? pace(1000 / v) : "–");
const kmh = (v) => (v ? n1(v * 3.6) : "–");
const ago = (ts) => {
  if (!ts) return "nie";
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `vor ${h} h` : `vor ${Math.round(h / 24)} T`;
};

// --- Uebersetzungen ---------------------------------------------------------

const SPORT = { running: "Laufen", cycling: "Rad", strength: "Kraft", other: "Sonstiges" };
const READY_LEVEL = { POOR: "Schlecht", LOW: "Niedrig", MODERATE: "Mäßig", HIGH: "Hoch", PRIME: "Top" };
const READY_SHORT = {
  LISTEN_TO_YOUR_BODY: "Hör auf deinen Körper", READY_TO_TRAIN: "Bereit fürs Training",
  RECOVER: "Erholung priorisieren", REST: "Ruhe einplanen", PRIME: "Topform", GO_FOR_IT: "Leg los",
  FOCUS_ON_RECOVERY: "Fokus auf Erholung", TAKE_IT_EASY: "Locker bleiben", KEEP_GOING: "Weiter so",
};
const HRV_STATUS = { BALANCED: "Ausgeglichen", UNBALANCED: "Unausgeglichen", LOW: "Niedrig", POOR: "Schlecht", NONE: "Keine Daten" };
const TS = {
  PRODUCTIVE: "Produktiv", MAINTAINING: "Erhaltend", RECOVERY: "Erholung", UNPRODUCTIVE: "Unproduktiv",
  DETRAINING: "Leistungsabbau", OVERREACHING: "Überlastung", PEAKING: "Höchstform", STRAINED: "Angestrengt",
  NO_STATUS: "Kein Status", PAUSED: "Pausiert",
};
const ACWR = { OPTIMAL: "Optimal", LOW: "Niedrig", HIGH: "Hoch", VERY_HIGH: "Sehr hoch", NONE: "–" };
const BALANCE = {
  AEROBIC_LOW_SHORTAGE: "Zu wenig lockere Grundlage", AEROBIC_HIGH_SHORTAGE: "Zu wenig intensive Ausdauer",
  ANAEROBIC_SHORTAGE: "Zu wenig anaerobe Reize", BALANCED: "Ausgewogen",
  AEROBIC_LOW_FOCUS: "Fokus Grundlage", AEROBIC_HIGH_FOCUS: "Fokus intensive Ausdauer", ANAEROBIC_FOCUS: "Fokus anaerob",
};
const TE_LABEL = {
  RECOVERY: "Erholung", BASE: "Grundlage", TEMPO: "Tempo", LACTATE_THRESHOLD: "Schwelle", THRESHOLD: "Schwelle",
  VO2MAX: "VO2max", ANAEROBIC_CAPACITY: "Anaerob", SPRINT: "Sprint", NONE: "",
};
const tsLabel = (phrase) => { if (!phrase) return "–"; const key = Object.keys(TS).find((k) => phrase.startsWith(k)); return key ? TS[key] : phrase; };
const humanize = (s) => (s ? s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "");

// --- Icons -------------------------------------------------------------------

const ICONS = {
  running: '<circle cx="14.5" cy="4.5" r="2"/><path d="M8 21l2.5-5.5 3 2.5v4"/><path d="M5.5 11.5l3-3 4.5.5 2.5 3.5 3 .8"/><path d="M10.5 15.5L13 9"/>',
  cycling: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5l4-7h6l3 7"/><path d="M9.5 9.5l3 7h-7"/><path d="M13.5 6.5h3"/>',
  strength: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  wave: '<path d="M2.5 12h3.5l2-5 4 10 3-8 1.5 3h5"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  steps: '<path d="M8 3c1.4 0 2.3 1.9 2.3 4.2S9.4 11.5 8 11.5 5.7 9.5 5.7 7.2 6.6 3 8 3zM16 8.5c1.4 0 2.3 1.9 2.3 4.2S17.4 17 16 17s-2.3-2-2.3-4.3.9-4.2 2.3-4.2zM5.8 14h4.4v1.8a2.2 2.2 0 0 1-4.4 0zM13.8 19.3h4.4v.2a2.2 2.2 0 0 1-4.4 0z"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  flame: '<path d="M12 21c-3.6 0-6-2.4-6-5.8 0-3.9 3.5-5.6 3.8-10.2 2.8 1.8 4.3 4.3 4.5 6.7.8-.6 1.3-1.6 1.4-2.8 1.5 1.5 2.3 3.6 2.3 6.1C18 18.6 15.6 21 12 21z"/>',
  zap: '<path d="M4 20h16M6 16l3-5 3 3 4-7 2 3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.1"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  trend: '<path d="M3.5 17l5.5-5.5 4 4 7.5-8"/><path d="M15 7.5h5.5V13"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 10a5 5 0 0 1 7 0l-2.5 2.5"/>',
};
const icon = (name, sw = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.other}</svg>`;
const sportIcon = (sport) => icon(ICONS[sport] ? sport : "other", 2);

function statusBadge(kind, text) {
  const map = { good: "check", warn: "alert", serious: "alert", critical: "x", neutral: "clock" };
  return `<span class="badge ${kind}">${icon(map[kind] || "clock", 2.4)}${esc(text)}</span>`;
}

// --- Farben aus CSS ------------------------------------------------------------

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SPORT_VAR = { running: "--run", cycling: "--bike", strength: "--gym", other: "--other" };
const sportColor = (s) => css(SPORT_VAR[s] || "--other");

// --- API ---------------------------------------------------------------------

const cache = new Map();
async function api(path, { fresh = false } = {}) {
  if (!fresh && cache.has(path)) return cache.get(path);
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (res.status === 401) { location.replace("/login.html"); throw new Error("Anmeldung nötig"); }
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  const data = await res.json();
  cache.set(path, data);
  return data;
}

// --- Charts ------------------------------------------------------------------
// Kleine SVG-Engine: Linien, Flaechen, Balken (gestapelt/schwebend), Tooltip.

const charts = new Set();
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => charts.forEach((c) => (c.el.isConnected ? c.draw() : charts.delete(c))), 120);
});

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; min = min - 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

function showTip(evt, title, rows) {
  tipEl.replaceChildren();
  const h = document.createElement("div"); h.className = "h"; h.textContent = title; tipEl.append(h);
  for (const r of rows) {
    const row = document.createElement("div"); row.className = "r";
    const key = document.createElement("i"); key.style.background = r.color || "transparent";
    const lab = document.createElement("span"); lab.textContent = r.label;
    const val = document.createElement("b"); val.textContent = r.value;
    row.append(key, lab, val); tipEl.append(row);
  }
  tipEl.classList.add("on");
  const pad = 14, w = tipEl.offsetWidth, hgt = tipEl.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY - hgt - pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y < 8) y = evt.clientY + pad;
  tipEl.style.left = `${Math.max(8, x)}px`; tipEl.style.top = `${y}px`;
}
const hideTip = () => tipEl.classList.remove("on");
document.addEventListener("scroll", hideTip, { passive: true });

/**
 * spec: {
 *   n, height, xLabel(i), tipTitle(i), yFmt(v), mini,
 *   lines: [{label, color, values, area, dash, width, fmt}],
 *   bars:  [{label, color, values, fmt}]   // gestapelt
 *   ranges: {label, color, low:[], high:[], fmt}  // schwebende Balken
 *   band: {low:[], high:[], label}          // Zielkorridor hinter den Linien
 *   yMin, yMax, onClick(i)
 * }
 */
function chart(el, spec) {
  const c = { el, draw: () => drawChart(el, spec) };
  charts.add(c);
  c.draw();
}

function drawChart(el, spec) {
  const W = Math.max(el.clientWidth, 200);
  const H = spec.height || 180;
  const mini = !!spec.mini;
  const pad = mini ? { l: 2, r: 2, t: 4, b: 4 } : { l: 36, r: 8, t: 10, b: 24 };
  const n = spec.n;
  if (!n) { el.innerHTML = '<div class="empty-state">Noch keine Daten</div>'; return; }

  // Wertebereich
  const vals = [];
  (spec.lines || []).forEach((s) => s.values.forEach((v) => v != null && vals.push(v)));
  if (spec.bars) {
    for (let i = 0; i < n; i++) vals.push(spec.bars.reduce((a, s) => a + (s.values[i] || 0), 0));
    vals.push(0);
  }
  if (spec.ranges) { spec.ranges.low.forEach((v) => v != null && vals.push(v)); spec.ranges.high.forEach((v) => v != null && vals.push(v)); }
  if (spec.band) { spec.band.low.forEach((v) => v != null && vals.push(v)); spec.band.high.forEach((v) => v != null && vals.push(v)); }
  if (!vals.length) { el.innerHTML = '<div class="empty-state">Noch keine Daten</div>'; return; }
  let lo = spec.yMin ?? Math.min(...vals), hi = spec.yMax ?? Math.max(...vals);
  if (spec.bars && spec.yMin == null) lo = 0;
  if (!spec.bars && spec.yMin == null) {
    const p = (hi - lo) * 0.12 || 1;
    const nonNeg = lo >= 0;
    lo -= p; hi += p;
    if (nonNeg && lo < 0) lo = 0;
  }
  let ticks = mini ? [lo, hi] : niceTicks(lo, hi, spec.ticks || 4);
  if (!mini && spec.tickStep) {
    // Feste Schrittweite (z. B. 30 s fuer Pace), bei Bedarf verdoppeln
    let st = spec.tickStep;
    while ((hi - lo) / st > 6) st *= 2;
    ticks = [];
    for (let v = Math.floor(lo / st) * st; v <= Math.ceil(hi / st) * st + 1e-9; v += st) ticks.push(v);
  }
  if (!mini) {
    const nonNeg = lo >= 0;
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    if (nonNeg && lo < 0) { lo = 0; ticks = ticks.filter((t) => t >= 0); }
  }
  if (spec.yMin != null) lo = spec.yMin;
  if (spec.yMax != null) hi = spec.yMax;

  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const barMode = !!(spec.bars || spec.ranges);
  const step = barMode ? iw / n : iw / Math.max(n - 1, 1);
  // Optional echte x-Werte (z. B. Zeitstempel) statt gleichmaessiger Abstaende
  const xv = !barMode && spec.x ? spec.x : null;
  const x0 = xv ? xv[0] : 0, x1 = xv ? xv[n - 1] : 1;
  const X = (i) => pad.l + (barMode ? step * (i + 0.5) : xv ? ((xv[i] - x0) / (x1 - x0 || 1)) * iw : step * i);
  const Y = (v) => pad.t + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const yFmt = spec.yFmt || ((v) => n0(v));

  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(spec.aria || "Diagramm")}">`;

  if (!mini) {
    const shown = ticks.filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
    let labels = shown.map(yFmt);
    // Formatierer rundet zu grob (z. B. 0,5er-Schritte als ganze Zahlen)? Dann mit passenden Nachkommastellen.
    if (new Set(labels).size < labels.length && shown.length > 1) {
      const dec = Math.min(2, Math.max(1, Math.ceil(-Math.log10(shown[1] - shown[0]) + 1e-9)));
      labels = shown.map((t) => t.toLocaleString("de-DE", { minimumFractionDigits: dec, maximumFractionDigits: dec }));
    }
    shown.forEach((t, k) => {
      svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/>`;
      svg += `<text class="axis" x="${pad.l - 6}" y="${Y(t) + 3.5}" text-anchor="end">${esc(labels[k])}</text>`;
    });
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 62))));
    if (xv && spec.xTick) {
      const count = Math.max(2, Math.floor(iw / 70));
      for (let k = 0; k <= count; k++) {
        const v = x0 + ((x1 - x0) * k) / count;
        const anchor = k === 0 ? "start" : k === count ? "end" : "middle";
        svg += `<text class="axis" x="${pad.l + (iw * k) / count}" y="${H - 6}" text-anchor="${anchor}">${esc(spec.xTick(v))}</text>`;
      }
    } else for (let i = 0; i < n; i += every) {
      const anchor = barMode ? "middle" : i === 0 ? "start" : "middle";
      svg += `<text class="axis" x="${X(i)}" y="${H - 6}" text-anchor="${anchor}">${esc(spec.xLabel ? spec.xLabel(i) : i)}</text>`;
    }
  }

  // Band (Zielkorridor)
  if (spec.band) {
    let top = "", bot = "";
    const pts = [];
    for (let i = 0; i < n; i++) if (spec.band.low[i] != null && spec.band.high[i] != null) pts.push(i);
    if (pts.length > 1) {
      top = pts.map((i, k) => `${k ? "L" : "M"}${X(i)},${Y(spec.band.high[i])}`).join("");
      bot = pts.slice().reverse().map((i) => `L${X(i)},${Y(spec.band.low[i])}`).join("");
      svg += `<path d="${top}${bot}Z" fill="${spec.band.color || css("--good")}" opacity="0.14"/>`;
    }
  }

  // Balken (gestapelt), 2px Luft zwischen Segmenten, 4px Rundung am Ende
  if (spec.bars) {
    const bw = Math.max(3, Math.min(28, step * 0.62));
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const segs = spec.bars.map((s) => s.values[i] || 0);
      const total = segs.reduce((a, b) => a + b, 0);
      spec.bars.forEach((s, k) => {
        const v = segs[k];
        if (!v) return;
        const y0 = Y(acc), y1 = Y(acc + v);
        acc += v;
        const isTop = acc >= total - 1e-9;
        const h = Math.max(0, y0 - y1 - (k > 0 ? 2 : 0));
        const r = isTop ? Math.min(4, bw / 2, h) : 0;
        const x = X(i) - bw / 2, y = y1;
        svg += r
          ? `<path d="M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + h}Z" fill="${s.color}"/>`
          : `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${s.color}"/>`;
      });
    }
    if (!mini) svg += `<line class="baseline" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(0)}" y2="${Y(0)}"/>`;
  }

  // Schwebende Balken (z. B. Body Battery Tief-Hoch)
  if (spec.ranges) {
    const bw = Math.max(3, Math.min(14, step * 0.5));
    for (let i = 0; i < n; i++) {
      const a = spec.ranges.low[i], b = spec.ranges.high[i];
      if (a == null || b == null) continue;
      const y = Y(b), h = Math.max(2, Y(a) - Y(b));
      svg += `<rect x="${X(i) - bw / 2}" y="${y}" width="${bw}" height="${h}" rx="${Math.min(bw / 2, 4)}" fill="${spec.ranges.color}"/>`;
    }
  }

  // Linien
  for (const s of spec.lines || []) {
    let d = "", pen = false, first = null, last = null;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true; if (first == null) first = i; last = i;
    });
    if (s.area && first != null) {
      const gid = `g${Math.random().toString(36).slice(2, 8)}`;
      svg += `<defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity="0.35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0.02"/></linearGradient></defs>`;
      const base = Y(Math.max(lo, 0));
      const areaPath = d.replace(/M/g, (m, idx) => (idx === 0 ? "M" : "L"));
      svg += `<path d="${areaPath}L${X(last)},${base}L${X(first)},${base}Z" fill="url(#${gid})"/>`;
    }
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="4 4"' : ""}/>`;
    if (s.dots) s.values.forEach((v, i) => { if (v != null) svg += `<circle cx="${X(i)}" cy="${Y(v)}" r="3.5" fill="${s.color}" stroke="var(--page)" stroke-width="2"/>`; });
    if (!mini && s.endLabel && last != null) {
      svg += `<circle cx="${X(last)}" cy="${Y(s.values[last])}" r="4" fill="${s.color}" stroke="var(--page)" stroke-width="2"/>`;
    }
  }

  // Hover-Ebene
  svg += `<line class="cross" id="cx" x1="0" x2="0" y1="${pad.t}" y2="${pad.t + ih}" visibility="hidden"/>`;
  svg += `<g class="hoverdots"></g>`;
  svg += `<rect class="hit" x="${pad.l - 6}" y="0" width="${iw + 12}" height="${H}"/>`;
  svg += "</svg>";
  el.innerHTML = svg;

  const svgEl = el.firstChild;
  const cross = svgEl.querySelector("#cx");
  const dots = svgEl.querySelector(".hoverdots");
  const indexAt = (evt) => {
    const r = svgEl.getBoundingClientRect();
    const x = ((evt.clientX - r.left) / r.width) * W;
    if (xv) {
      const target = x0 + ((x - pad.l) / iw) * (x1 - x0);
      let best = 0;
      for (let k = 1; k < n; k++) if (Math.abs(xv[k] - target) < Math.abs(xv[best] - target)) best = k;
      return best;
    }
    const i = barMode ? Math.floor((x - pad.l) / step) : Math.round((x - pad.l) / step);
    return Math.max(0, Math.min(n - 1, i));
  };
  const move = (evt) => {
    const i = indexAt(evt);
    cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
    let dsvg = "";
    const rows = [];
    for (const s of spec.lines || []) {
      const v = s.values[i];
      if (v != null) dsvg += `<circle cx="${X(i)}" cy="${Y(v)}" r="4.5" fill="${s.color}" stroke="var(--page)" stroke-width="2"/>`;
      if (s.label && !s.hideTip) rows.push({ color: s.color, label: s.label, value: v == null ? "–" : (s.fmt || yFmt)(v) });
    }
    for (const s of (spec.bars || []).slice().reverse()) rows.push({ color: s.color, label: s.label, value: s.values[i] == null ? "–" : (s.fmt || yFmt)(s.values[i] || 0) });
    if (spec.ranges) {
      const a = spec.ranges.low[i], b = spec.ranges.high[i];
      rows.push({ color: spec.ranges.color, label: spec.ranges.label, value: a == null ? "–" : `${n0(a)}–${n0(b)}` });
    }
    if (spec.band && spec.band.low[i] != null) rows.push({ color: "transparent", label: spec.band.label || "Korridor", value: `${yFmt(spec.band.low[i])}–${yFmt(spec.band.high[i])}` });
    if (spec.extraTip) rows.push(...spec.extraTip(i));
    dots.innerHTML = dsvg;
    showTip(evt, spec.tipTitle ? spec.tipTitle(i) : String(i), rows);
  };
  const leave = () => { cross.setAttribute("visibility", "hidden"); dots.innerHTML = ""; hideTip(); };
  svgEl.addEventListener("pointermove", move);
  svgEl.addEventListener("pointerdown", move);
  svgEl.addEventListener("pointerleave", leave);
  if (spec.onClick) svgEl.addEventListener("click", (evt) => spec.onClick(indexAt(evt)));
}

function ring(value, max, color, size = 132, stroke = 12) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, (value || 0) / max));
  return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--chip)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" style="transition: stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)"/></svg>`;
}

const legend = (items) => `<div class="legend">${items.map((i) => `<span><i class="${i.box ? "box" : ""}" style="background:${i.color}"></i>${esc(i.label)}</span>`).join("")}</div>`;

// --- Gemeinsame Bausteine ------------------------------------------------------

function readinessColor(score) {
  if (score == null) return css("--ink-3");
  if (score >= 75) return css("--good");
  if (score >= 50) return css("--accent");
  if (score >= 25) return css("--serious");
  return css("--critical");
}

function activityMeta(a) {
  const parts = [];
  if (a.sport === "strength") {
    parts.push(dur(a.duration));
    if (a.sets) parts.push(`${a.sets} Sätze`);
  } else {
    if (a.distance) parts.push(`${km(a.distance)} km`);
    parts.push(dur(a.duration));
    if (a.sport === "running" && a.avgSpeed) parts.push(`${paceFromSpeed(a.avgSpeed)} /km`);
    if (a.sport === "cycling" && a.avgPower) parts.push(`${n0(a.avgPower)} W`);
    else if (a.sport === "cycling" && a.avgSpeed) parts.push(`${kmh(a.avgSpeed)} km/h`);
  }
  if (a.avgHr) parts.push(`${n0(a.avgHr)} bpm`);
  return parts;
}

function activityRow(a, { showDate = true } = {}) {
  return `<button class="row" data-act="${a.id}" type="button">
    <span class="ic bg-${esc(a.sport)}">${sportIcon(a.sport)}</span>
    <span style="min-width:0">
      <div class="ttl">${esc(a.name || SPORT[a.sport])}</div>
      <div class="meta">${activityMeta(a).map((p) => `<span>${esc(p)}</span>`).join("")}</div>
    </span>
    <span class="right">${showDate ? `${esc(fmtShort(a.start))}<br>` : ""}<span class="muted">${esc(fmtTime(a.start))}</span></span>
  </button>`;
}

const STATUS_BADGE = {
  done: () => statusBadge("good", "Erledigt"),
  missed: () => statusBadge("critical", "Verpasst"),
  today: () => statusBadge("neutral", "Heute"),
  planned: () => statusBadge("neutral", "Geplant"),
};

function planRow(e) {
  const a = e.activity;
  const isExtra = e.kind === "extra";
  const meta = a ? activityMeta(a) : [SPORT[e.sport]];
  return `<div class="row ${a ? "" : "planned"} ${e.status === "missed" ? "missed" : ""}" ${a ? `data-act="${a.id}" role="button" tabindex="0"` : ""}>
    <span class="ic ${a ? `bg-${esc(e.sport)}` : `c-${esc(e.sport)}`}">${sportIcon(e.sport)}</span>
    <span style="min-width:0">
      <div class="ttl">${esc(e.title || SPORT[e.sport])}</div>
      <div class="meta">${meta.map((p) => `<span>${esc(p)}</span>`).join("")}</div>
    </span>
    <span class="right">${isExtra ? statusBadge("good", "Zusätzlich") : STATUS_BADGE[e.status]()}</span>
  </div>`;
}

// --- Views ---------------------------------------------------------------------

async function viewToday() {
  const d = await api("/api/today", { fresh: true });
  setHeader("Heute", `${WD_LONG[pd(d.date).getDay()]}, ${pd(d.date).getDate()}. ${MON[pd(d.date).getMonth()]}`);
  updateSync(d.sync);
  const r = d.readiness || {}, s = d.sleep || {}, h = d.hrv || {}, sum = d.summary || {}, ts = d.trainingStatus || {};
  const bbSeries = (d.bodyBattery || []).filter((p) => p && p[1] != null);
  const bbNow = bbSeries.length ? bbSeries[bbSeries.length - 1][1] : sum.bodyBatteryMostRecentValue;

  const factor = (label, pct, text) => `<div class="factor"><div class="lbl"><span>${esc(label)}</span><span class="muted">${esc(text)}</span></div><div class="meter"><i style="width:${Math.max(3, pct || 0)}%;background:${readinessColor(pct)}"></i></div></div>`;

  let html = banner(d.sync);
  html += `<div class="grid">`;

  // Readiness
  html += `<section class="card glass col-8">
    <div class="card-h"><div class="card-t">${icon("gauge")}Trainingsbereitschaft</div>
      ${r.timestampLocal ? `<span class="small muted">${esc(fmtTime(r.timestampLocal))} Uhr</span>` : ""}</div>
    <div class="hero">
      <div class="ring">${ring(r.score, 100, readinessColor(r.score))}
        <div class="val"><b>${r.score ?? "–"}</b><span>${esc(READY_LEVEL[r.level] || "")}</span></div></div>
      <div class="hero-side">
        <div class="mid">${esc(READY_SHORT[r.feedbackShort] || humanize(r.feedbackShort) || "Noch keine Daten")}</div>
        <div class="small ink2">Erholung noch ${r.recoveryTime != null ? `${Math.round(r.recoveryTime / 60)} h` : "–"} · Akute Last ${n0(r.acuteLoad)}</div>
        <div class="factors">
          ${factor("Schlaf", r.sleepScoreFactorPercent, `${r.sleepScore ?? "–"}`)}
          ${factor("HRV", r.hrvFactorPercent, `${r.hrvWeeklyAverage ?? "–"} ms`)}
          ${factor("Erholung", r.recoveryTimeFactorPercent, `${r.recoveryTimeFactorPercent ?? "–"} %`)}
          ${factor("Belastung", r.acwrFactorPercent, `${r.acwrFactorPercent ?? "–"} %`)}
          ${factor("Stress", r.stressHistoryFactorPercent, `${r.stressHistoryFactorPercent ?? "–"} %`)}
          ${factor("Schlafverlauf", r.sleepHistoryFactorPercent, `${r.sleepHistoryFactorPercent ?? "–"} %`)}
        </div>
      </div>
    </div>
  </section>`;

  // Plan heute/morgen
  const plan = d.todayPlan.length ? d.todayPlan.map(planRow).join("") : '<div class="empty-state" style="padding:14px">Ruhetag</div>';
  const tomorrow = d.tomorrowPlan.length ? d.tomorrowPlan.map(planRow).join("") : '<div class="small muted" style="padding:4px 2px">Nichts geplant</div>';
  html += `<section class="card glass col-4">
    <div class="card-h"><div class="card-t">${icon("calendar")}Heute</div><a class="card-link" href="#/woche">Woche</a></div>
    <div class="list">${plan}</div>
    <div class="card-t" style="margin:16px 0 8px">Morgen</div>
    <div class="list">${tomorrow}</div>
  </section>`;

  // Kacheln
  const hrvKind = { BALANCED: "good", UNBALANCED: "warn", LOW: "serious", POOR: "critical" }[h.status] || "neutral";
  html += `<div class="col-12 tiles">
    <div class="tile glass"><div class="t">${icon("wave")}HRV letzte Nacht</div>
      <div class="v">${h.lastNightAvg ?? "–"}<span class="unit">ms</span></div>
      <div class="s">${h.status ? statusBadge(hrvKind, HRV_STATUS[h.status] || h.status) : ""}</div>
      <div class="s">Ø 7 T ${h.weeklyAvg ?? "–"} · Normal ${h.baseline ? `${h.baseline.balancedLow}–${h.baseline.balancedUpper}` : "–"}</div></div>
    <div class="tile glass"><div class="t">${icon("moon")}Schlaf</div>
      <div class="v">${hm(s.sleepSeconds)}<span class="unit">h</span></div>
      <div class="s">Score ${s.score ?? "–"} · ${esc(humanize(s.quality))}</div>
      <div class="s">${s.start ? `${new Date(s.start).toISOString().slice(11, 16)} – ${new Date(s.end).toISOString().slice(11, 16)}` : ""}</div></div>
    <div class="tile glass"><div class="t">${icon("bolt")}Body Battery</div>
      <div class="v">${bbNow ?? "–"}</div>
      <div class="s">Beim Aufwachen ${sum.bodyBatteryAtWakeTime ?? "–"}</div>
      <div class="s">+${sum.bodyBatteryChargedValue ?? "–"} / −${sum.bodyBatteryDrainedValue ?? "–"}</div></div>
    <div class="tile glass"><div class="t">${icon("heart")}Ruhepuls</div>
      <div class="v">${sum.restingHeartRate ?? s.restingHr ?? "–"}<span class="unit">bpm</span></div>
      <div class="s">Ø 7 T ${sum.lastSevenDaysAvgRestingHeartRate ?? "–"}</div></div>
  </div>`;

  // Body Battery Verlauf
  html += `<section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("bolt")}Body Battery heute</div></div><div class="chart" id="c-bb"></div></section>`;

  // Schlaf
  const tot = (s.deep || 0) + (s.light || 0) + (s.rem || 0) + (s.awake || 0);
  const stage = (v, color, label) => (v ? `<i style="width:${(v / tot) * 100}%;background:${color}" title="${esc(label)}"></i>` : "");
  html += `<section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("moon")}Schlafphasen</div>
      <span class="small muted">${d.sleepDay ? esc(fmtDay(d.sleepDay)) : ""}</span></div>
    ${tot ? `<div class="stagebar">${stage(s.deep, css("--deep"), "Tief")}${stage(s.light, css("--light"), "Leicht")}${stage(s.rem, css("--rem"), "REM")}${stage(s.awake, css("--awake"), "Wach")}</div>
    <div class="legend">
      <span><i class="box" style="background:${css("--deep")}"></i>Tief ${hm(s.deep)}</span>
      <span><i class="box" style="background:${css("--light")}"></i>Leicht ${hm(s.light)}</span>
      <span><i class="box" style="background:${css("--rem")}"></i>REM ${hm(s.rem)}</span>
      <span><i class="box" style="background:${css("--awake")}"></i>Wach ${hm(s.awake)}</span>
    </div><div class="chart" id="c-hyp" style="margin-top:10px"></div>` : '<div class="empty-state">Noch keine Schlafdaten</div>'}
  </section>`;

  // Trainingsstatus
  const lb = ts.loadBalance || {};
  const lbRow = (label, v, lo, hi, color) => {
    const max = Math.max(v || 0, hi || 0) * 1.15 || 1;
    return `<div class="factor" style="margin-top:10px"><div class="lbl"><span>${esc(label)}</span><span class="muted num">${n0(v)} · Ziel ${n0(lo)}–${n0(hi)}</span></div>
      <div class="loadbar" style="margin:6px 0 0;height:10px"><div class="band" style="left:${(lo / max) * 100}%;width:${((hi - lo) / max) * 100}%"></div>
      <div style="position:absolute;left:0;top:0;bottom:0;width:${((v || 0) / max) * 100}%;border-radius:5px;background:${color};opacity:.85"></div></div></div>`;
  };
  const cmax = Math.max(ts.chronicMax || 0, ts.acuteLoad || 0) * 1.2 || 1;
  html += `<section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("trend")}Trainingsstatus</div>
      <span class="small muted">${esc(ts.device || "")}</span></div>
    <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end">
      <div><div class="mid">${esc(tsLabel(ts.statusPhrase))}</div><div class="small muted">Status</div></div>
      <div><div class="mid">${n1(ts.vo2max)}</div><div class="small muted">VO2max</div></div>
      <div><div class="mid">${n0(ts.acuteLoad)}</div><div class="small muted">Akute Last · ${esc(ACWR[ts.acwrStatus] || "–")}</div></div>
    </div>
    <div class="loadbar"><div class="band" style="left:${((ts.chronicMin || 0) / cmax) * 100}%;width:${(((ts.chronicMax || 0) - (ts.chronicMin || 0)) / cmax) * 100}%"></div>
      <div class="mark" style="left:${((ts.acuteLoad || 0) / cmax) * 100}%"></div></div>
    <div class="tiny muted">Balken: optimaler Bereich ${n0(ts.chronicMin)}–${n0(ts.chronicMax)} · Strich: akute Last</div>
    ${lb.monthlyLoadAerobicLow != null ? `<div class="card-t" style="margin-top:16px">Belastungsfokus 4 Wochen</div>
      <div class="small ink2" style="margin-top:4px">${esc(BALANCE[lb.trainingBalanceFeedbackPhrase] || humanize(lb.trainingBalanceFeedbackPhrase))}</div>
      ${lbRow("Aerob niedrig", lb.monthlyLoadAerobicLow, lb.monthlyLoadAerobicLowTargetMin, lb.monthlyLoadAerobicLowTargetMax, css("--light"))}
      ${lbRow("Aerob hoch", lb.monthlyLoadAerobicHigh, lb.monthlyLoadAerobicHighTargetMin, lb.monthlyLoadAerobicHighTargetMax, css("--accent"))}
      ${lbRow("Anaerob", lb.monthlyLoadAnaerobic, lb.monthlyLoadAnaerobicTargetMin, lb.monthlyLoadAnaerobicTargetMax, css("--rem"))}` : ""}
  </section>`;

  // Woche
  const tot2 = d.week.totals || {};
  const pct = d.week.planned ? Math.round((d.week.done / d.week.planned) * 100) : 0;
  html += `<section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("calendar")}Diese Woche</div><a class="card-link" href="#/woche">Kalender</a></div>
    <div class="progress-ring"><div class="ring" style="width:76px;height:76px">${ring(d.week.done, d.week.planned || 1, css("--good"), 76, 9)}
      <div class="val"><b style="font-size:20px">${d.week.done}/${d.week.planned}</b></div></div>
      <div><div class="mid">${pct} %</div><div class="small muted">der geplanten Einheiten erledigt</div></div></div>
    <div class="totals" style="margin-top:16px">${["running", "cycling", "strength"].map((sp) => {
      const t = tot2[sp];
      return `<div class="total"><span class="ic bg-${sp}">${sportIcon(sp)}</span><div><b>${t ? (sp === "strength" ? `${t.count}×` : `${km(t.distance)} km`) : "–"}</b><div class="small muted">${SPORT[sp]} · ${t ? dur(t.duration) : "0 min"}</div></div></div>`;
    }).join("")}</div>
  </section>`;

  // Alltag
  html += `<div class="col-12 tiles">
    <div class="tile glass"><div class="t">${icon("steps")}Schritte</div><div class="v">${n0(sum.totalSteps)}</div><div class="s">Ziel ${n0(sum.dailyStepGoal)}</div></div>
    <div class="tile glass"><div class="t">${icon("gauge")}Stress</div><div class="v">${sum.averageStressLevel ?? "–"}</div><div class="s">Ø heute · max ${sum.maxStressLevel ?? "–"}</div></div>
    <div class="tile glass"><div class="t">${icon("zap")}Intensitätsminuten</div><div class="v">${n0((sum.moderateIntensityMinutes || 0) + 2 * (sum.vigorousIntensityMinutes || 0))}</div><div class="s">heute · Wochenziel ${n0(sum.intensityMinutesGoal)}</div></div>
    <div class="tile glass"><div class="t">${icon("flame")}Kalorien</div><div class="v">${n0(sum.totalKilocalories)}</div><div class="s">davon aktiv ${n0(sum.activeKilocalories)}</div></div>
  </div>`;

  if (d.nutrition) html += energyCard(d.nutrition);

  html += `<section class="card glass col-12"><div class="card-h"><div class="card-t">${icon("clock")}Letzte Einheiten</div><a class="card-link" href="#/training/running">Alle</a></div>
    <div class="list">${d.recent.length ? d.recent.map((a) => activityRow(a)).join("") : '<div class="empty-state">Noch keine Aktivitäten</div>'}</div></section>`;
  html += `</div>`;
  render(html);

  if (bbSeries.length) {
    chart($("#c-bb"), {
      n: bbSeries.length, height: 170, yMin: 0, yMax: 100, aria: "Body Battery Verlauf",
      lines: [{ label: "Body Battery", color: css("--accent"), values: bbSeries.map((p) => p[1]), area: true, endLabel: true, dots: bbSeries.length < 40 }],
      x: bbSeries.map((p) => p[0]),
      xTick: (v) => new Date(v).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
      tipTitle: (i) => `${new Date(bbSeries[i][0]).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`,
    });
  } else $("#c-bb").innerHTML = '<div class="empty-state">Noch keine Werte</div>';
  if (tot && s.levels?.length) hypnogram($("#c-hyp"), s.levels);
}

// Energiebilanz aus dem Kalorien-Tracker (gegessen = --accent, Verbrauch = --ink-3)
const MACROS = [["protein", "Eiweiß", "--protein", 4], ["carbs", "Kohlenhydrate", "--carbs", 4], ["fat", "Fett", "--fat", 9]];
const signed = (v) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${n0(Math.abs(v))}`);
function energyCard(n) {
  const eaten = n.available && n.entries ? n.kcal : null;
  const burned = n.burned;
  const max = Math.max(eaten || 0, burned || 0, n.budget || 0) || 1;
  const bar = (v, color, label) => `<div class="factor" style="margin-top:10px"><div class="lbl"><span>${esc(label)}</span><span class="muted num">${v == null ? "–" : `${n0(v)} kcal`}</span></div>
    <div class="meter" style="height:10px"><i style="width:${v ? Math.max(2, (v / max) * 100) : 0}%;background:${color}"></i></div></div>`;
  const mk = MACROS.map(([k, , , f]) => (n[k] || 0) * f);
  const tot = mk.reduce((a, b) => a + b, 0);
  return `<section class="card glass col-12"><div class="card-h"><div class="card-t">${icon("flame")}Energiebilanz</div>
      ${n.link ? `<a class="card-link" href="${esc(n.link)}/#/heute" target="_blank" rel="noopener">Im Tracker öffnen</a>` : ""}</div>
    <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:flex-end">
      <div><div class="mid">${n0(eaten)}<span class="unit">kcal</span></div><div class="small muted">gegessen${n.budget ? ` · Budget ${n0(n.budget)}` : ""}</div></div>
      <div><div class="mid">${n0(burned)}<span class="unit">kcal</span></div><div class="small muted">verbraucht bisher</div></div>
      <div><div class="mid">${eaten != null && burned != null ? signed(eaten - burned) : "–"}<span class="unit">kcal</span></div><div class="small muted">Bilanz bisher</div></div>
    </div>
    ${bar(eaten, css("--accent"), "Gegessen")}${bar(burned, css("--ink-3"), "Verbrauch Garmin")}
    ${tot ? `<div class="stagebar" style="margin-top:16px">${MACROS.map(([, l, c], i) => (mk[i] ? `<i style="width:${(mk[i] / tot) * 100}%;background:var(${c})" title="${esc(l)}"></i>` : "")).join("")}</div>
      <div class="legend">${MACROS.map(([k, l, c]) => `<span><i class="box" style="background:var(${c})"></i>${esc(l)} ${n[k] == null ? "–" : n0(n[k])} g</span>`).join("")}</div>` : ""}
    ${n.available ? "" : '<div class="tiny muted" style="margin-top:10px">Kalorien-Tracker gerade nicht erreichbar.</div>'}
  </section>`;
}

function hypnogram(el, levels) {
  // 0 Tief, 1 Leicht, 2 REM, 3 Wach
  const draw = () => {
    const W = Math.max(el.clientWidth, 200), H = 96, padL = 46;
    const t0 = Date.parse(levels[0][0] + "Z"), t1 = Date.parse(levels[levels.length - 1][1] + "Z");
    const X = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - 4);
    const rowY = { 3: 4, 2: 26, 1: 48, 0: 70 };
    const col = { 0: css("--deep"), 1: css("--light"), 2: css("--rem"), 3: css("--awake") };
    const name = { 0: "Tief", 1: "Leicht", 2: "REM", 3: "Wach" };
    let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Schlafverlauf">`;
    for (const k of [3, 2, 1, 0]) svg += `<text class="axis" x="0" y="${rowY[k] + 12}">${name[k]}</text>`;
    levels.forEach(([a, b, lv]) => {
      const x = X(Date.parse(a + "Z")), w = Math.max(1, X(Date.parse(b + "Z")) - x - 1);
      svg += `<rect x="${x}" y="${rowY[lv]}" width="${w}" height="18" rx="3" fill="${col[lv]}" data-a="${a}" data-b="${b}" data-l="${lv}"/>`;
    });
    svg += "</svg>";
    el.innerHTML = svg;
    el.querySelectorAll("rect").forEach((r) => {
      const fmtT = (s) => new Date(s + "Z").toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
      r.addEventListener("pointermove", (e) => showTip(e, `${fmtT(r.dataset.a)} – ${fmtT(r.dataset.b)}`,
        [{ color: col[r.dataset.l], label: name[r.dataset.l], value: dur((Date.parse(r.dataset.b + "Z") - Date.parse(r.dataset.a + "Z")) / 1000) }]));
      r.addEventListener("pointerleave", hideTip);
    });
  };
  charts.add({ el, draw });
  draw();
}

let weekStart = null;
async function viewWeek() {
  if (!weekStart) weekStart = iso(new Date());
  const d = await api(`/api/week?start=${weekStart}`, { fresh: true });
  weekStart = d.start;
  const s = pd(d.start), e = pd(d.end);
  const kw = isoWeek(s);
  setHeader("Woche", `KW ${kw} · ${s.getDate()}. ${MON[s.getMonth()]} – ${e.getDate()}. ${MON[e.getMonth()]}`);
  const t = d.totals || {};
  let html = `<div class="toolbar">
    <div class="weeknav">
      <button class="icon-btn glass" id="wk-prev" aria-label="Vorherige Woche">${icon("left", 2.2)}</button>
      <button class="sync-btn glass" id="wk-today" style="padding:8px 14px">Diese Woche</button>
      <button class="icon-btn glass" id="wk-next" aria-label="Nächste Woche">${icon("right", 2.2)}</button>
    </div>
    <div class="small ink2">${d.done} von ${d.planned} geplanten Einheiten erledigt</div>
  </div>`;
  html += `<section class="card glass" style="margin-bottom:14px"><div class="totals">${["running", "cycling", "strength"].map((sp) => {
    const x = t[sp];
    return `<div class="total"><span class="ic bg-${sp}">${sportIcon(sp)}</span><div><b>${x ? (sp === "strength" ? `${x.count} ${x.count === 1 ? "Einheit" : "Einheiten"}` : `${km(x.distance)} km`) : "–"}</b><div class="small muted">${SPORT[sp]} · ${x ? dur(x.duration) : "0 min"}</div></div></div>`;
  }).join("")}
  <div class="total"><span class="ic" style="background:var(--chip);color:var(--ink-2)">${icon("trend", 2)}</span><div><b>${n0(Object.values(t).reduce((a, x) => a + (x.load || 0), 0))}</b><div class="small muted">Trainingslast</div></div></div>
  </div></section>`;
  html += `<div class="days">${d.days.map((day) => {
    const dt = pd(day.date);
    return `<div class="day glass ${day.isToday ? "today" : ""}">
      <div class="day-h"><b>${WD_LONG[dt.getDay()]}</b><span>${dt.getDate()}. ${MON[dt.getMonth()]}</span></div>
      <div class="list">${day.entries.length ? day.entries.map(planRow).join("") : '<div class="empty">Ruhetag</div>'}</div>
    </div>`;
  }).join("")}</div>`;
  render(html);
  const shift = (days) => { const x = pd(weekStart); x.setDate(x.getDate() + days); weekStart = iso(x); viewWeek(); };
  $("#wk-prev").onclick = () => shift(-7);
  $("#wk-next").onclick = () => shift(7);
  $("#wk-today").onclick = () => { weekStart = iso(new Date()); viewWeek(); };
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

let trainingWeeks = 12;
async function viewTraining(sport) {
  if (!["running", "cycling", "strength"].includes(sport)) sport = "running";
  setHeader("Training", SPORT[sport]);
  const d = await api(`/api/sport/${sport}?weeks=${trainingWeeks}`, { fresh: true });
  const col = sportColor(sport);
  const wk = d.weekly;
  const wkLabel = (i) => fmtShort(wk[i].week);
  let html = `<div class="toolbar">
    <div class="segment glass" role="tablist">${["running", "cycling", "strength"].map((s) => `<button class="${s === sport ? "on" : ""}" data-sport="${s}" role="tab" aria-selected="${s === sport}">${sportIcon(s)}${SPORT[s]}</button>`).join("")}</div>
    <div class="segment glass">${[8, 12, 26, 52].map((w) => `<button class="${w === trainingWeeks ? "on" : ""}" data-weeks="${w}">${w < 52 ? `${w} W` : "1 J"}</button>`).join("")}</div>
  </div><div class="grid">`;

  if (sport === "running") {
    const rp = d.racePredictions || {};
    const thr = d.threshold || {};
    const volume = wk.reduce((a, w) => a + w.distance, 0);
    html += `<div class="col-12 tiles">
      <div class="tile glass"><div class="t">${icon("trend")}VO2max</div><div class="v">${n1(d.vo2max)}</div><div class="s">Laufen</div></div>
      <div class="tile glass"><div class="t">${icon("heart")}Laktatschwelle</div><div class="v">${pace(thr.pace)}<span class="unit">/km</span></div><div class="s">${thr.hr ?? "–"} bpm · ${thr.power ?? "–"} W</div></div>
      <div class="tile glass"><div class="t">${icon("clock")}Prognose 10 km</div><div class="v">${dur(rp.time10K, true)}</div><div class="s">5 km ${dur(rp.time5K, true)}</div></div>
      <div class="tile glass"><div class="t">${icon("clock")}Prognose HM</div><div class="v">${dur(rp.timeHalfMarathon, true)}</div><div class="s">Marathon ${dur(rp.timeMarathon, true)}</div></div>
    </div>`;
    html += `<section class="card glass col-8"><div class="card-h"><div class="card-t">Kilometer pro Woche</div><span class="small muted">${km(volume)} km gesamt</span></div><div class="chart" id="c-vol"></div></section>`;
    html += `<section class="card glass col-4"><div class="card-h"><div class="card-t">VO2max-Verlauf</div></div><div class="chart" id="c-vo2"></div></section>`;
    html += `<section class="card glass col-6"><div class="card-h"><div class="card-t">Pace je Lauf</div><span class="small muted">min/km, ab 3 km</span></div><div class="chart" id="c-pace"></div></section>`;
    html += `<section class="card glass col-6"><div class="card-h"><div class="card-t">Ø Herzfrequenz je Lauf</div><span class="small muted">bpm</span></div><div class="chart" id="c-hr"></div></section>`;
  } else if (sport === "cycling") {
    const w = d.weight;
    html += `<div class="col-12 tiles">
      <div class="tile glass"><div class="t">${icon("zap")}FTP</div><div class="v">${n0(d.ftp)}<span class="unit">W</span></div><div class="s">${w && d.ftp ? `${n1(d.ftp / w)} W/kg` : ""}</div></div>
      <div class="tile glass"><div class="t">${icon("clock")}Zeit im Zeitraum</div><div class="v">${hm(wk.reduce((a, x) => a + x.duration, 0))}<span class="unit">h</span></div><div class="s">${wk.reduce((a, x) => a + x.count, 0)} Fahrten</div></div>
      <div class="tile glass"><div class="t">${icon("cycling")}Distanz</div><div class="v">${km(wk.reduce((a, x) => a + x.distance, 0))}<span class="unit">km</span></div><div class="s">${n0(wk.reduce((a, x) => a + x.elevation, 0))} Hm</div></div>
      <div class="tile glass"><div class="t">${icon("trend")}Trainingslast</div><div class="v">${n0(wk.reduce((a, x) => a + x.load, 0))}</div><div class="s">Summe Zeitraum</div></div>
    </div>`;
    html += `<section class="card glass col-8"><div class="card-h"><div class="card-t">Stunden pro Woche</div></div><div class="chart" id="c-vol"></div></section>`;
    html += `<section class="card glass col-4"><div class="card-h"><div class="card-t">Leistungszonen</div><span class="small muted">FTP ${n0(d.ftp)} W</span></div>${powerZones(d.powerZones)}</section>`;
    html += `<section class="card glass col-12"><div class="card-h"><div class="card-t">Leistung je Fahrt</div><span class="small muted">Watt</span></div><div class="chart" id="c-pow"></div></section>`;
  } else {
    const ses = d.sessions || [];
    html += `<div class="col-12 tiles">
      <div class="tile glass"><div class="t">${icon("strength")}Einheiten</div><div class="v">${ses.length}</div><div class="s">im Zeitraum</div></div>
      <div class="tile glass"><div class="t">${icon("clock")}Ø Dauer</div><div class="v">${ses.length ? dur(ses.reduce((a, x) => a + (x.duration || 0), 0) / ses.length) : "–"}</div><div class="s">pro Einheit</div></div>
      <div class="tile glass"><div class="t">${icon("trend")}Ø Sätze</div><div class="v">${ses.length ? n0(ses.reduce((a, x) => a + x.sets, 0) / ses.length) : "–"}</div><div class="s">pro Einheit</div></div>
      <div class="tile glass"><div class="t">${icon("scale")}Volumen gesamt</div><div class="v">${n0(ses.reduce((a, x) => a + x.volume, 0) / 1000)}<span class="unit">t</span></div><div class="s">Gewicht × Wiederholungen</div></div>
    </div>`;
    html += `<section class="card glass col-6"><div class="card-h"><div class="card-t">Einheiten pro Woche</div></div><div class="chart" id="c-vol"></div></section>`;
    html += `<section class="card glass col-6"><div class="card-h"><div class="card-t">Volumen je Einheit</div><span class="small muted">kg</span></div><div class="chart" id="c-svol"></div></section>`;
  }
  html += `<section class="card glass col-12"><div class="card-h"><div class="card-t">Einheiten</div><span class="small muted">${d.activities.length}</span></div>
    <div class="list">${d.activities.length ? d.activities.map((a) => activityRow(a)).join("") : '<div class="empty-state">Keine Einheiten im Zeitraum</div>'}</div></section></div>`;
  render(html);

  viewEl.querySelectorAll("[data-sport]").forEach((b) => (b.onclick = () => (location.hash = `#/training/${b.dataset.sport}`)));
  viewEl.querySelectorAll("[data-weeks]").forEach((b) => (b.onclick = () => { trainingWeeks = Number(b.dataset.weeks); viewTraining(sport); }));

  const volSpec = { n: wk.length, height: 190, xLabel: wkLabel, tipTitle: (i) => `Woche ab ${fmtDay(wk[i].week)}` };
  if (sport === "running") {
    chart($("#c-vol"), { ...volSpec, aria: "Kilometer pro Woche", bars: [{ label: "Kilometer", color: col, values: wk.map((w) => w.distance / 1000), fmt: (v) => `${n1(v)} km` }],
      extraTip: (i) => [{ label: "Läufe", value: String(wk[i].count) }, { label: "Zeit", value: dur(wk[i].duration) }] });
    const v = d.vo2Trend || [];
    chart($("#c-vo2"), { n: v.length, height: 190, aria: "VO2max", lines: [{ label: "VO2max", color: col, values: v.map((x) => x.value), fmt: n1, endLabel: true }],
      xLabel: (i) => fmtShort(v[i].date), tipTitle: (i) => fmtDay(v[i].date), yFmt: (x) => n0(x) });
    const p = d.paceTrend || [];
    // Pace-Achse umgedreht: schneller = oben
    chart($("#c-pace"), { n: p.length, height: 180, aria: "Pace je Lauf", lines: [{ label: "Pace", color: col, values: p.map((x) => -x.pace), dots: true, fmt: (x) => `${pace(-x)} /km` }],
      yFmt: (x) => pace(-x), tickStep: 30, xLabel: (i) => fmtShort(p[i].date), tipTitle: (i) => fmtDay(p[i].date), onClick: (i) => openActivity(p[i].id) });
    chart($("#c-hr"), { n: p.length, height: 180, aria: "Herzfrequenz je Lauf", lines: [{ label: "Ø HF", color: css("--critical"), values: p.map((x) => x.hr), dots: true, fmt: (x) => `${n0(x)} bpm` }],
      xLabel: (i) => fmtShort(p[i].date), tipTitle: (i) => fmtDay(p[i].date), onClick: (i) => openActivity(p[i].id) });
  } else if (sport === "cycling") {
    chart($("#c-vol"), { ...volSpec, aria: "Stunden pro Woche", bars: [{ label: "Stunden", color: col, values: wk.map((w) => w.duration / 3600), fmt: (v) => `${hm(v * 3600)} h` }],
      yFmt: (v) => n1(v), extraTip: (i) => [{ label: "Distanz", value: `${km(wk[i].distance)} km` }, { label: "Fahrten", value: String(wk[i].count) }] });
    const p = d.powerTrend || [];
    chart($("#c-pow"), { n: p.length, height: 190, aria: "Leistung je Fahrt", legend: true,
      lines: [{ label: "Normalized Power", color: col, values: p.map((x) => x.np), dots: true, fmt: (x) => `${n0(x)} W` },
        { label: "Ø Leistung", color: css("--ink-3"), values: p.map((x) => x.avg), dash: true, fmt: (x) => `${n0(x)} W` }],
      xLabel: (i) => fmtShort(p[i].date), tipTitle: (i) => fmtDay(p[i].date), onClick: (i) => openActivity(p[i].id) });
    if (p.length) $("#c-pow").insertAdjacentHTML("afterend", legend([{ label: "Normalized Power", color: col }, { label: "Ø Leistung (gestrichelt)", color: css("--ink-3") }]));
  } else {
    chart($("#c-vol"), { ...volSpec, aria: "Einheiten pro Woche", bars: [{ label: "Einheiten", color: col, values: wk.map((w) => w.count), fmt: (v) => String(v) }],
      extraTip: (i) => [{ label: "Zeit", value: dur(wk[i].duration) }] });
    const ses = d.sessions || [];
    chart($("#c-svol"), { n: ses.length, height: 190, aria: "Volumen je Einheit", bars: [{ label: "Volumen", color: col, values: ses.map((x) => x.volume), fmt: (v) => `${n0(v)} kg` }],
      xLabel: (i) => fmtShort(ses[i].date), tipTitle: (i) => fmtDay(ses[i].date),
      extraTip: (i) => [{ label: "Sätze", value: String(ses[i].sets) }, { label: "Wdh.", value: String(ses[i].reps) }], onClick: (i) => openActivity(ses[i].id) });
  }
}

function powerZones(z) {
  if (!z) return '<div class="empty-state">Keine Zonen hinterlegt</div>';
  const floors = [1, 2, 3, 4, 5, 6, 7].map((i) => z[`zone${i}Floor`]).filter((v) => v != null);
  const names = ["Aktive Erholung", "Grundlage", "Tempo", "Schwelle", "VO2max", "Anaerob", "Neuromuskulär"];
  return `<table class="t"><thead><tr><th>Zone</th><th>Watt</th><th>% FTP</th></tr></thead><tbody>${floors.map((f, i) => {
    const hi = floors[i + 1] ? floors[i + 1] - 1 : null;
    return `<tr><td>Z${i + 1} <span class="muted">${names[i] || ""}</span></td><td>${n0(f)}${hi ? `–${n0(hi)}` : "+"}</td><td>${n0((f / z.functionalThresholdPower) * 100)} %</td></tr>`;
  }).join("")}</tbody></table>`;
}

let healthDays = 30;
async function viewHealth() {
  setHeader("Health", `Letzte ${healthDays} Tage`);
  const d = await api(`/api/health?days=${healthDays}`, { fresh: true });
  const rows = d.days;
  const avg = (key) => { const v = rows.map((r) => r[key]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const last = (key) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i][key] != null) return rows[i][key]; return null; };
  const xl = (i) => fmtShort(rows[i].date), tt = (i) => fmtDay(rows[i].date);
  const weights = (d.weights || []).filter((w) => w[0] >= rows[0].date);

  let html = `<div class="toolbar"><div class="segment glass">${[7, 30, 90, 365].map((n) => `<button class="${n === healthDays ? "on" : ""}" data-days="${n}">${n === 365 ? "1 J" : `${n} T`}</button>`).join("")}</div></div>`;
  html += `<div class="grid">
    <div class="col-12 tiles">
      <div class="tile glass"><div class="t">${icon("moon")}Ø Schlaf</div><div class="v">${hm(avg("sleepSeconds"))}<span class="unit">h</span></div><div class="s">Ø Score ${n0(avg("sleepScore"))}</div></div>
      <div class="tile glass"><div class="t">${icon("wave")}Ø HRV</div><div class="v">${n0(avg("hrv"))}<span class="unit">ms</span></div><div class="s">zuletzt ${n0(last("hrv"))} ms</div></div>
      <div class="tile glass"><div class="t">${icon("heart")}Ø Ruhepuls</div><div class="v">${n0(avg("rhr"))}<span class="unit">bpm</span></div><div class="s">zuletzt ${n0(last("rhr"))} bpm</div></div>
      <div class="tile glass"><div class="t">${icon("scale")}Gewicht</div><div class="v">${weights.length ? n1(weights[weights.length - 1][1]) : n1(d.profileWeight)}<span class="unit">kg</span></div><div class="s">${weights.length ? `${weights.length} Messungen` : "aus dem Profil"}</div></div>
    </div>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("moon")}Schlaf</div><span class="small muted">Stunden pro Nacht</span></div><div class="chart" id="h-sleep"></div>
      ${legend([{ label: "Tief", color: css("--deep"), box: true }, { label: "Leicht", color: css("--light"), box: true }, { label: "REM", color: css("--rem"), box: true }, { label: "Wach", color: css("--awake"), box: true }])}</section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("wave")}HRV</div><span class="small muted">ms · Fläche = Normalbereich</span></div><div class="chart" id="h-hrv"></div>
      ${legend([{ label: "Letzte Nacht", color: css("--accent") }, { label: "Ø 7 Tage (gestrichelt)", color: css("--ink-3") }])}</section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("gauge")}Trainingsbereitschaft</div></div><div class="chart" id="h-ready"></div></section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("heart")}Ruhepuls</div><span class="small muted">bpm</span></div><div class="chart" id="h-rhr"></div></section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("trend")}Trainingslast</div><span class="small muted">Fläche = optimaler Bereich</span></div><div class="chart" id="h-load"></div>
      ${legend([{ label: "Akute Last", color: css("--run") }, { label: "Chronische Last (gestrichelt)", color: css("--ink-3") }])}</section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("bolt")}Body Battery</div><span class="small muted">Tiefst- bis Höchstwert</span></div><div class="chart" id="h-bb"></div></section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("gauge")}Stress</div><span class="small muted">Ø pro Tag</span></div><div class="chart" id="h-stress"></div></section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("steps")}Schritte</div></div><div class="chart" id="h-steps"></div></section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("trend")}VO2max</div></div><div class="chart" id="h-vo2"></div></section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("scale")}Gewicht</div><span class="small muted">kg</span></div><div class="chart" id="h-weight"></div></section>
    ${d.nutrition?.enabled ? `<section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("flame")}Energiebilanz</div>${d.nutrition.link ? `<a class="card-link" href="${esc(d.nutrition.link)}/#/verlauf" target="_blank" rel="noopener">Im Tracker öffnen</a>` : '<span class="small muted">kcal pro Tag</span>'}</div><div class="chart" id="h-energy"></div>
      ${legend([{ label: "Gegessen", color: css("--accent"), box: true }, { label: "Verbrauch Garmin", color: css("--ink-3") }])}</section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("flame")}Makros</div><span class="small muted">kcal aus Eiweiß, KH, Fett</span></div><div class="chart" id="h-macros"></div>
      ${legend(MACROS.map(([, l, c]) => ({ label: l, color: css(c), box: true })))}</section>` : ""}
  </div>
  <button class="sync-btn glass logout" id="logout" type="button">Auf diesem Gerät abmelden</button>`;
  render(html);
  $("#logout").onclick = async () => { await fetch("/api/logout", { method: "POST" }); location.replace("/login.html"); };
  viewEl.querySelectorAll("[data-days]").forEach((b) => (b.onclick = () => { healthDays = Number(b.dataset.days); viewHealth(); }));

  const base = { n: rows.length, height: 180, xLabel: xl, tipTitle: tt };
  const h = (v) => (v == null ? null : v / 3600);
  chart($("#h-sleep"), { ...base, aria: "Schlaf", yFmt: (v) => n0(v), tickStep: 2, bars: [
    { label: "Tief", color: css("--deep"), values: rows.map((r) => h(r.deep)), fmt: (v) => hm(v * 3600) },
    { label: "Leicht", color: css("--light"), values: rows.map((r) => h(r.light)), fmt: (v) => hm(v * 3600) },
    { label: "REM", color: css("--rem"), values: rows.map((r) => h(r.rem)), fmt: (v) => hm(v * 3600) },
    { label: "Wach", color: css("--awake"), values: rows.map((r) => h(r.awake)), fmt: (v) => hm(v * 3600) }],
    extraTip: (i) => [{ label: "Score", value: rows[i].sleepScore == null ? "–" : String(rows[i].sleepScore) }] });
  chart($("#h-hrv"), { ...base, aria: "HRV", band: { low: rows.map((r) => r.hrvLow), high: rows.map((r) => r.hrvHigh), label: "Normal", color: css("--good") },
    lines: [{ label: "Letzte Nacht", color: css("--accent"), values: rows.map((r) => r.hrv), dots: rows.length <= 31, fmt: (v) => `${n0(v)} ms` },
      { label: "Ø 7 Tage", color: css("--ink-3"), values: rows.map((r) => r.hrvWeekly), dash: true, fmt: (v) => `${n0(v)} ms` }] });
  chart($("#h-ready"), { ...base, aria: "Trainingsbereitschaft", yMin: 0, yMax: 100, lines: [{ label: "Bereitschaft", color: css("--accent"), values: rows.map((r) => r.readiness), area: true }] });
  chart($("#h-rhr"), { ...base, aria: "Ruhepuls", lines: [{ label: "Ruhepuls", color: css("--critical"), values: rows.map((r) => r.rhr), fmt: (v) => `${n0(v)} bpm`, endLabel: true }] });
  chart($("#h-load"), { ...base, aria: "Trainingslast", band: { low: rows.map((r) => r.chronicMin), high: rows.map((r) => r.chronicMax), label: "Optimal", color: css("--good") },
    lines: [{ label: "Akut", color: css("--run"), values: rows.map((r) => r.acuteLoad) }, { label: "Chronisch", color: css("--ink-3"), values: rows.map((r) => r.chronicLoad), dash: true }] });
  chart($("#h-bb"), { ...base, aria: "Body Battery", yMin: 0, yMax: 100, ranges: { label: "Tief–Hoch", color: css("--accent"), low: rows.map((r) => r.bbLow), high: rows.map((r) => r.bbHigh) },
    extraTip: (i) => [{ label: "Beim Aufwachen", value: rows[i].bbWake == null ? "–" : String(rows[i].bbWake) }] });
  chart($("#h-stress"), { ...base, aria: "Stress", yMin: 0, bars: [{ label: "Ø Stress", color: css("--serious"), values: rows.map((r) => r.stress) }] });
  chart($("#h-steps"), { ...base, aria: "Schritte", bars: [{ label: "Schritte", color: css("--gym"), values: rows.map((r) => r.steps) }] });
  chart($("#h-vo2"), { ...base, aria: "VO2max", lines: [{ label: "VO2max", color: css("--run"), values: rows.map((r) => r.vo2max), fmt: n1, endLabel: true }], yFmt: (v) => n0(v) });
  if (d.nutrition?.enabled) {
    if (!d.nutrition.available) {
      $("#h-energy").innerHTML = '<div class="empty-state">Kalorien-Tracker gerade nicht erreichbar</div>';
      $("#h-macros").innerHTML = '<div class="empty-state">–</div>';
    } else {
      const today = iso(new Date());
      chart($("#h-energy"), { ...base, aria: "Energiebilanz",
        bars: [{ label: "Gegessen", color: css("--accent"), values: rows.map((r) => r.eaten), fmt: (v) => `${n0(v)} kcal` }],
        lines: [{ label: "Verbrauch", color: css("--ink-3"), values: rows.map((r) => (r.date < today ? r.burned : null)), fmt: (v) => `${n0(v)} kcal` }],
        extraTip: (i) => [{ label: "Bilanz", value: rows[i].eaten != null && rows[i].burned != null && rows[i].date < today ? `${signed(rows[i].eaten - rows[i].burned)} kcal` : "–" }] });
      chart($("#h-macros"), { ...base, aria: "Makros pro Tag",
        bars: MACROS.map(([k, l, c, f]) => ({ label: l, color: css(c), values: rows.map((r) => (r[k] == null ? null : r[k] * f)), fmt: (v) => `${n0(v)} kcal` })),
        extraTip: (i) => MACROS.map(([k, l]) => ({ label: `${l} (g)`, value: rows[i][k] == null ? "–" : `${n0(rows[i][k])} g` })) });
    }
  }
  if (weights.length > 1) {
    chart($("#h-weight"), { n: weights.length, height: 180, aria: "Gewicht", lines: [{ label: "Gewicht", color: css("--accent"), values: weights.map((w) => w[1]), dots: true, fmt: (v) => `${n1(v)} kg` }],
      xLabel: (i) => fmtShort(weights[i][0]), tipTitle: (i) => fmtDay(weights[i][0]), yFmt: n1 });
  } else {
    $("#h-weight").innerHTML = (d.weights || []).length
      ? `<div class="empty-state">Zu wenige Messungen in diesem Zeitraum.<br>Zuletzt: ${n1(d.weights[d.weights.length - 1][1])} kg</div>`
      : `<div class="empty-state">Keine Waagen-Messungen in Garmin.<br>Profilgewicht: ${n1(d.profileWeight)} kg</div>`;
  }
}

// --- Aktivitaets-Detail --------------------------------------------------------

const sheet = $("#sheet"), sheetBg = $("#sheet-bg");
async function openActivity(id) {
  if (!id) return;
  sheet.innerHTML = '<div class="grab"></div><div class="skeleton"></div>';
  sheet.classList.add("on"); sheetBg.classList.add("on");
  document.body.style.overflow = "hidden";
  let data;
  try { data = await api(`/api/activity/${id}`); }
  catch { sheet.innerHTML = '<div class="grab"></div><div class="empty-state">Aktivität nicht gefunden</div>'; return; }
  const a = data.activity, det = data.detail || {};
  const sp = a.sport, col = sportColor(sp);
  const stat = (l, v) => `<div class="stat"><div class="l">${esc(l)}</div><div class="v">${v}</div></div>`;
  const u = (x) => `<span class="unit">${x}</span>`;
  let stats = "";
  if (sp === "running") {
    stats = stat("Distanz", `${km(a.distance)}${u("km")}`) + stat("Zeit", dur(a.duration, true)) + stat("Pace", `${paceFromSpeed(a.avgSpeed)}${u("/km")}`)
      + stat("Ø HF", `${n0(a.avgHr)}${u("bpm")}`) + stat("Max HF", `${n0(a.maxHr)}${u("bpm")}`) + stat("GAP", `${paceFromSpeed(a.gap)}${u("/km")}`)
      + stat("Kadenz", `${n0(a.cadence)}${u("spm")}`) + stat("Ø Leistung", `${n0(a.avgPower)}${u("W")}`) + stat("Anstieg", `${n0(a.elevation)}${u("m")}`);
  } else if (sp === "cycling") {
    stats = stat("Distanz", `${km(a.distance)}${u("km")}`) + stat("Zeit", dur(a.duration, true)) + stat("Ø Tempo", `${kmh(a.avgSpeed)}${u("km/h")}`)
      + stat("Ø Leistung", `${n0(a.avgPower)}${u("W")}`) + stat("NP", `${n0(a.normPower)}${u("W")}`) + stat("Ø HF", `${n0(a.avgHr)}${u("bpm")}`)
      + stat("Kadenz", `${n0(a.cadence)}${u("rpm")}`) + stat("Anstieg", `${n0(a.elevation)}${u("m")}`) + stat("Max HF", `${n0(a.maxHr)}${u("bpm")}`);
  } else {
    const sets = (det.sets || []).filter((s) => s.type === "ACTIVE");
    stats = stat("Zeit", dur(a.duration, true)) + stat("Sätze", sets.length || a.sets || "–") + stat("Wdh.", sets.reduce((x, s) => x + (s.reps || 0), 0) || "–")
      + stat("Ø HF", `${n0(a.avgHr)}${u("bpm")}`) + stat("Max HF", `${n0(a.maxHr)}${u("bpm")}`) + stat("Volumen", `${n0(sets.reduce((x, s) => x + ((s.weight || 0) / 1000) * (s.reps || 0), 0))}${u("kg")}`);
  }
  stats += stat("Trainingseffekt", `${n1(a.te)}${u("aerob")}`) + stat("Last", n0(a.load)) + stat("Kalorien", `${n0(a.calories)}${u("kcal")}`);

  let html = `<div class="grab"></div>
    <div class="sheet-h"><span class="ic bg-${esc(sp)}">${sportIcon(sp)}</span>
      <div style="min-width:0"><h2>${esc(a.name || SPORT[sp])}</h2><div class="small muted">${esc(fmtDay(a.start))} · ${esc(fmtTime(a.start))} Uhr${a.teLabel && TE_LABEL[a.teLabel] !== "" ? ` · ${esc(TE_LABEL[a.teLabel] || humanize(a.teLabel))}` : ""}</div></div>
      <button class="icon-btn glass close" id="sheet-close" aria-label="Schließen">${icon("x", 2.2)}</button></div>
    <div class="stats">${stats}</div>`;
  if (det.route?.length > 1) html += `<div class="section"><h3>Strecke</h3><div class="route glass" style="border-radius:20px;padding:10px" id="d-route"></div></div>`;
  const S = det.series || {};
  if (S.hr) html += `<div class="section"><h3>Herzfrequenz</h3><div class="chart" id="d-hr"></div></div>`;
  if (sp === "running" && S.v) html += `<div class="section"><h3>Pace</h3><div class="chart" id="d-pace"></div></div>`;
  if (sp === "cycling" && S.p) html += `<div class="section"><h3>Leistung</h3><div class="chart" id="d-pow"></div></div>`;
  if (S.e && (a.elevation || 0) > 5) html += `<div class="section"><h3>Höhe</h3><div class="chart" id="d-ele"></div></div>`;
  if (det.hrZones?.length) html += `<div class="section"><h3>Zeit in HF-Zonen</h3>${zoneBars(det.hrZones)}</div>`;
  if (det.powerZones?.length) html += `<div class="section"><h3>Zeit in Leistungszonen</h3>${zoneBars(det.powerZones, "W")}</div>`;
  if (det.laps?.length > 1 && sp !== "strength") html += `<div class="section"><h3>Runden</h3><div class="table-wrap">${lapTable(det.laps, sp)}</div></div>`;
  if (det.sets?.length) html += `<div class="section"><h3>Sätze</h3><div class="table-wrap">${setTable(det.sets)}</div></div>`;
  if (!det.laps && !det.series) html += `<div class="empty-state">Details werden noch geladen – kurz nach dem Sync verfügbar.</div>`;
  sheet.innerHTML = html;
  $("#sheet-close").onclick = closeSheet;

  if (det.route?.length > 1) routeMap($("#d-route"), det.route, col);
  const t = S.t || S.d || [];
  const n = t.length;
  const xT = (i) => (S.t ? dur(S.t[i], true) : "");
  const xs = S.t && S.t.every((v, i) => i === 0 || v >= S.t[i - 1]) ? { x: S.t, xTick: (v) => dur(v, true) } : {};
  const tipT = (i) => `${S.t ? dur(S.t[i], true) : ""}${S.d ? ` · ${km(S.d[i])} km` : ""}`;
  if (S.hr) chart($("#d-hr"), { n, height: 150, aria: "Herzfrequenz", lines: [{ label: "HF", color: css("--critical"), values: S.hr, width: 1.6, fmt: (v) => `${n0(v)} bpm` }], xLabel: xT, tipTitle: tipT, ...xs });
  if (sp === "running" && S.v) {
    const pv = S.v.map((v) => (v && v > 0.8 ? 1000 / v : null));
    const sorted = pv.filter((x) => x).sort((x, y) => x - y);
    const p5 = sorted[Math.floor(sorted.length * 0.02)] || 200, p95 = sorted[Math.floor(sorted.length * 0.97)] || 600;
    // Pace-Achse umgedreht (schneller = oben) ueber negative Werte
    chart($("#d-pace"), { n, height: 150, aria: "Pace", lines: [{ label: "Pace", color: col, values: pv.map((x) => (x ? -Math.min(Math.max(x, p5), p95) : null)), width: 1.6, fmt: (x) => `${pace(-x)} /km` }],
      yFmt: (x) => pace(-x), tickStep: 30, xLabel: xT, tipTitle: tipT, ...xs });
  }
  if (sp === "cycling" && S.p) chart($("#d-pow"), { n, height: 150, aria: "Leistung", yMin: 0, lines: [{ label: "Leistung", color: col, values: S.p, width: 1.4, fmt: (v) => `${n0(v)} W` }], xLabel: xT, tipTitle: tipT, ...xs });
  if (S.e && (a.elevation || 0) > 5) chart($("#d-ele"), { n, height: 110, aria: "Höhe", lines: [{ label: "Höhe", color: css("--ink-3"), values: S.e, area: true, width: 1.4, fmt: (v) => `${n0(v)} m` }], xLabel: xT, tipTitle: tipT, ...xs });
}

function zoneBars(zones, unit = "bpm") {
  const total = zones.reduce((a, z) => a + (z.secs || 0), 0) || 1;
  const max = Math.max(...zones.map((z) => z.secs || 0)) || 1;
  const cols = ["--z1", "--z2", "--z3", "--z4", "--z5", "--z5", "--z5"];
  return `<div class="zones">${zones.map((z, i) => `<div class="zone"><span class="muted">Z${z.zone}</span>
    <div class="bar" title="ab ${z.low} ${unit}"><i style="width:${((z.secs || 0) / max) * 100}%;background:var(${cols[i]})"></i></div>
    <span class="num" style="text-align:right;white-space:nowrap;min-width:92px">${dur(z.secs)} <span class="muted">${n0(((z.secs || 0) / total) * 100)} %</span></span></div>`).join("")}</div>`;
}

function lapTable(laps, sp) {
  const TYPE = { WARMUP: "Einlaufen", COOLDOWN: "Auslaufen", ACTIVE: "Belastung", INTERVAL: "Belastung", RECOVERY: "Pause", REST: "Pause" };
  return `<table class="t"><thead><tr><th>#</th><th>Distanz</th><th>Zeit</th><th>${sp === "running" ? "Pace" : "km/h"}</th><th>Ø HF</th><th>${sp === "running" ? "Ø W" : "Ø W"}</th></tr></thead><tbody>
    ${laps.map((l, i) => `<tr><td>${i + 1} <span class="muted small">${esc(TYPE[l.intensityType] || "")}</span></td><td>${km(l.distance)}</td><td>${dur(l.duration, true)}</td>
      <td>${sp === "running" ? paceFromSpeed(l.averageSpeed) : kmh(l.averageSpeed)}</td><td>${n0(l.averageHR)}</td><td>${n0(l.averagePower)}</td></tr>`).join("")}</tbody></table>`;
}

function setTable(sets) {
  let k = 0;
  return `<table class="t"><thead><tr><th>Satz</th><th>Übung</th><th>Wdh.</th><th>Gewicht</th><th>Dauer</th></tr></thead><tbody>
    ${sets.map((s) => {
      if (s.type !== "ACTIVE") return `<tr><td class="muted" colspan="4">Pause</td><td class="muted">${dur(s.duration, true)}</td></tr>`;
      k += 1;
      const ex = s.exercise?.name ? humanize(s.exercise.name) : s.exercise?.category && s.exercise.category !== "UNKNOWN" ? humanize(s.exercise.category) : "–";
      return `<tr><td>${k}</td><td>${esc(ex)}</td><td>${s.reps ?? "–"}</td><td>${s.weight ? `${n1(s.weight / 1000)} kg` : "–"}</td><td>${dur(s.duration, true)}</td></tr>`;
    }).join("")}</tbody></table>`;
}

function routeMap(el, pts, color) {
  const draw = () => {
    const W = Math.max(el.clientWidth - 20, 200);
    const lat0 = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const k = Math.cos((lat0 * Math.PI) / 180);
    const xs = pts.map((p) => p[1] * k), ys = pts.map((p) => -p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = maxX - minX || 1e-6, spanY = maxY - minY || 1e-6;
    const H = Math.min(320, Math.max(180, (W * spanY) / spanX));
    const s = Math.min((W - 24) / spanX, (H - 24) / spanY);
    const ox = (W - spanX * s) / 2, oy = (H - spanY * s) / 2;
    const P = (i) => `${(ox + (xs[i] - minX) * s).toFixed(1)},${(oy + (ys[i] - minY) * s).toFixed(1)}`;
    const d = pts.map((_, i) => `${i ? "L" : "M"}${P(i)}`).join("");
    const [sx, sy] = P(0).split(","), [ex, ey] = P(pts.length - 1).split(",");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Streckenverlauf">
      <path d="${d}" fill="none" stroke="${color}" stroke-opacity="0.25" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${sx}" cy="${sy}" r="6" fill="${css("--good")}" stroke="#fff" stroke-width="2.5"/>
      <circle cx="${ex}" cy="${ey}" r="6" fill="${css("--ink")}" stroke="#fff" stroke-width="2.5"/>
    </svg>`;
  };
  charts.add({ el, draw });
  draw();
}

function closeSheet() {
  sheet.classList.remove("on"); sheetBg.classList.remove("on");
  document.body.style.overflow = "";
  hideTip();
}
sheetBg.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
// Nach unten wischen schliesst das Sheet (nur wenn ganz oben gescrollt)
let dragY = null;
sheet.addEventListener("touchstart", (e) => { dragY = sheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
sheet.addEventListener("touchmove", (e) => {
  if (dragY == null) return;
  const dy = e.touches[0].clientY - dragY;
  if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
}, { passive: true });
sheet.addEventListener("touchend", (e) => {
  if (dragY == null) return;
  const dy = e.changedTouches[0].clientY - dragY;
  sheet.style.transform = "";
  dragY = null;
  if (dy > 110) closeSheet();
});

document.addEventListener("click", (e) => {
  const row = e.target.closest("[data-act]");
  if (row && !e.target.closest(".sheet")) openActivity(Number(row.dataset.act));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.matches?.("[data-act]")) openActivity(Number(e.target.dataset.act));
});

// --- Sync ------------------------------------------------------------------------

const syncBtn = $("#sync"), syncLabel = $("#sync-label"), syncDot = $("#sync-dot");
let lastSync = null;
function updateSync(s) {
  if (!s) return;
  lastSync = s;
  syncBtn.classList.toggle("spinning", !!s.running);
  syncLabel.textContent = s.running ? "Synchronisiere…" : ago(s.lastOk);
  syncDot.className = "dot" + (s.error?.kind === "auth" ? " bad" : s.pausedUntil || s.error ? " warn" : "");
  syncBtn.title = s.error ? `Problem: ${s.error.kind} ${s.error.detail || ""}` : "Jetzt synchronisieren";
}
function banner(s) {
  if (!s) return "";
  if (s.error?.kind === "auth") return `<div class="banner glass">${icon("alert")}<span><b>Garmin-Anmeldung abgelaufen.</b> Auf dem Pi einmal <code>docker compose run --rm garmin-dashboard python -m app.login</code> ausführen.</span></div>`;
  if (s.error?.kind === "rate_limit") return `<div class="banner glass">${icon("clock")}<span>Garmin bremst gerade – der Sync pausiert automatisch und läuft danach weiter.</span></div>`;
  if (s.backfill < 1) return `<div class="banner glass">${icon("clock")}<span>Historie wird im Hintergrund geladen: ${Math.round(s.backfill * 100)} %</span></div>`;
  return "";
}
syncBtn.addEventListener("click", async () => {
  syncBtn.classList.add("spinning");
  syncLabel.textContent = "Synchronisiere…";
  try {
    const before = lastSync?.lastOk || 0;
    const res = await fetch("/api/sync", { method: "POST" }).then((r) => { if (r.status === 401) location.replace("/login.html"); return r.json(); });
    const startedAt = Date.now();
    // Warten, bis der Sync durch ist (max. 90 s), dann Ansicht neu laden
    while (Date.now() - startedAt < 90000) {
      await new Promise((r) => setTimeout(r, 2500));
      const s = await fetch("/api/status").then((r) => r.json());
      updateSync(s);
      if (!s.running && (s.lastOk || 0) > before) break;
      if (!res.started && !s.running) break;
    }
  } catch { /* offline */ }
  syncBtn.classList.remove("spinning");
  route();
});

// --- Router ------------------------------------------------------------------------

function setHeader(title, sub) {
  $("#title").textContent = title;
  $("#subtitle").textContent = sub || "";
  document.title = `${title} · Training`;
}
function render(html) {
  hideTip();
  viewEl.innerHTML = `<div class="view">${html}</div>`;
}

async function route() {
  const parts = (location.hash || "#/heute").slice(2).split("/");
  const tab = parts[0] || "heute";
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  for (const c of charts) if (!c.el.isConnected) charts.delete(c);
  if (!viewEl.children.length) viewEl.innerHTML = '<div class="grid"><div class="skeleton col-8"></div><div class="skeleton col-4"></div><div class="skeleton col-12"></div></div>';
  try {
    if (tab === "woche") await viewWeek();
    else if (tab === "training") await viewTraining(parts[1]);
    else if (tab === "health") await viewHealth();
    else await viewToday();
  } catch (err) {
    render(`<div class="banner glass">${icon("alert")}<span>Keine Verbindung zum Dashboard-Server. Im Heimnetz oder per VPN verbunden? <span class="muted">(${esc(err.message)})</span></span></div>`);
  }
}
window.addEventListener("hashchange", () => { closeSheet(); route(); window.scrollTo({ top: 0 }); });

// Beim Zurueckkehren in die App aktualisieren
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (Date.now() - hiddenAt > 120000) route();
});
setInterval(() => { if (!document.hidden) fetch("/api/status").then((r) => r.json()).then(updateSync).catch(() => {}); }, 60000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
route();
