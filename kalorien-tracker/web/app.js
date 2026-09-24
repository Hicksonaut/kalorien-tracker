// Kalorien-Tracker - Frontend ohne Build-Schritt.
// Alle Daten kommen aus der eigenen API (SQLite auf dem Pi).
// Stil: garmin-dashboard/docs/DESIGN-SYSTEM.md, Chart-Engine 1:1 aus dem Dashboard.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
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
const fmtLong = (s) => { const d = pd(s); return `${WD_LONG[d.getDay()]}, ${d.getDate()}. ${MON[d.getMonth()]}`; };
const n0 = (v) => (v == null || isNaN(v) ? "–" : Math.round(v).toLocaleString("de-DE"));
const n1 = (v) => (v == null || isNaN(v) ? "–" : (Math.round(v * 10) / 10).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const gram = (v) => (v == null || isNaN(v) ? "–" : Math.abs(v) >= 10 ? n0(v) : n1(v));
const amt = (v) => (v == null ? "–" : Number.isInteger(Math.round(v * 100) / 100) ? n0(v) : (Math.round(v * 100) / 100).toLocaleString("de-DE"));
const signed = (v) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${n0(Math.abs(v))}`);
const todayIso = () => iso(new Date());
const addDays = (s, k) => { const d = pd(s); d.setDate(d.getDate() + k); return iso(d); };
const nowTime = () => new Date().toTimeString().slice(0, 5);
const num = (v) => { if (v == null || v === "") return null; const f = parseFloat(String(v).replace(",", ".")); return isFinite(f) ? f : null; };
const inputVal = (v) => (v == null ? "" : String(Math.round(v * 100) / 100).replace(".", ","));
const ago = (ts) => {
  if (!ts) return "–";
  const d = new Date(Number(ts) * 1000);
  return `${d.getDate()}. ${MON[d.getMonth()]} ${d.getFullYear()}`;
};

const MEALS = [["breakfast", "Frühstück", "sunrise"], ["lunch", "Mittag", "sun"], ["dinner", "Abend", "moon"], ["snack", "Snacks", "apple"]];
const MEAL_LABEL = Object.fromEntries(MEALS.map((m) => [m[0], m[1]]));
const MACROS = [["protein", "Eiweiß", "--protein"], ["carbs", "Kohlenhydrate", "--carbs"], ["fat", "Fett", "--fat"]];
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };
const KIND_LABEL = { bls: "BLS", off: "Open Food Facts", cap: "Eigenes Produkt", own: "Eigenes", recipe: "Rezept" };

// --- Icons -------------------------------------------------------------------

const ICONS = {
  flame: '<path d="M12 21c-3.6 0-6-2.4-6-5.8 0-3.9 3.5-5.6 3.8-10.2 2.8 1.8 4.3 4.3 4.5 6.7.8-.6 1.3-1.6 1.4-2.8 1.5 1.5 2.3 3.6 2.3 6.1C18 18.6 15.6 21 12 21z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.5v.1"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  trend: '<path d="M3.5 17l5.5-5.5 4 4 7.5-8"/><path d="M15 7.5h5.5V13"/>',
  scale: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8.5 10a5 5 0 0 1 7 0l-2.5 2.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  bolt: '<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>',
  sunrise: '<path d="M3.5 18.5h17M7 18.5a5 5 0 0 1 10 0"/><path d="M12 4.5v4M5.3 9.8l1.8 1.8M18.7 9.8l-1.8 1.8M9.5 6.5L12 4l2.5 2.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 1 1 9.5 4.5a6 6 0 0 0 10 10z"/>',
  apple: '<path d="M12 7.6c-1.8-1.3-5.6-1.4-6.9 1.9-1.3 3.3.3 8.1 2.6 10.1 1.3 1.1 2.6.9 4.3.2 1.7.7 3 .9 4.3-.2 2.3-2 3.9-6.8 2.6-10.1-1.3-3.3-5.1-3.2-6.9-1.9z"/><path d="M12 7.6c0-2 .8-3.7 2.6-4.6"/>',
  leaf: '<path d="M5 19c0-8.5 5-13.5 14.5-14 0 9.5-5 14-14.5 14z"/><path d="M5 19l7.5-7.5"/>',
  barcode: '<path d="M4 5.5v13M7 5.5v13M11 5.5v13M14 5.5v13M17.5 5.5v13M20 5.5v13"/>',
  pencil: '<path d="M4.5 19.5l1-4.5L16 4.5a2.1 2.1 0 0 1 3 3L8.5 18z"/><path d="M14 6.5l3 3"/>',
  pot: '<path d="M4.5 10h15v4.5a5.5 5.5 0 0 1-5.5 5.5h-4a5.5 5.5 0 0 1-5.5-5.5z"/><path d="M2.5 10h19M9.5 7c0-1.2 1-1.6 1-2.8M13.5 7c0-1.2 1-1.6 1-2.8"/>',
  drop: '<path d="M12 3.5s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.5-2h4.4l1.5 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
  grain: '<path d="M12 21V9M12 13c-2.5 0-4.5-2-4.5-4.5C10 8.5 12 10.5 12 13zM12 13c2.5 0 4.5-2 4.5-4.5-2.5 0-4.5 2-4.5 4.5zM12 17.5c-2.5 0-4.5-2-4.5-4.5 2.5 0 4.5 2 4.5 4.5zM12 17.5c2.5 0 4.5-2 4.5-4.5-2.5 0-4.5 2-4.5 4.5zM12 8.5c-1.3-1-1.8-2.4-1.2-4 1.4.6 2 2.2 1.2 4z"/>',
};
const icon = (name, sw = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;
const kindOf = (ref) => (!ref ? "quick" : ref.split(":")[0]);
const foodIcon = (kind) => icon({ bls: "leaf", off: "barcode", cap: "pencil", own: "pencil", recipe: "pot", quick: "flame" }[kind] || "apple", 1.9);

function statusBadge(kind, text) {
  const map = { good: "check", warn: "alert", serious: "alert", critical: "x", neutral: "clock" };
  return `<span class="badge ${kind}">${icon(map[kind] || "clock", 2.4)}${esc(text)}</span>`;
}
const nutriscore = (g) => (g ? `<span class="ns ns-${esc(g)}" title="Nutri-Score ${esc(g.toUpperCase())}">${esc(g)}</span>` : "");

// --- Farben aus CSS ------------------------------------------------------------

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// --- API ---------------------------------------------------------------------

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { Accept: "application/json", "Content-Type": "application/json" } : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Keine Verbindung. Im Heimnetz oder per VPN verbunden?");
  }
  if (res.status === 401) { location.replace("/login.html"); throw new Error("Anmeldung nötig"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Fehler ${res.status}`); e.status = res.status; throw e; }
  return data;
}
const post = (p, body = {}) => api(p, { method: "POST", body });
const patch = (p, body) => api(p, { method: "PATCH", body });
const put = (p, body) => api(p, { method: "PUT", body });
const del = (p) => api(p, { method: "DELETE" });

// --- Charts ------------------------------------------------------------------
// Kleine SVG-Engine: Linien, Flaechen, Balken (gestapelt/schwebend), Tooltip.
// 1:1 aus garmin-dashboard/web/app.js uebernommen - Aenderungen bitte in beiden Apps.

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
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
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
    for (const t of ticks) {
      if (t < lo - 1e-9 || t > hi + 1e-9) continue;
      svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/>`;
      svg += `<text class="axis" x="${pad.l - 6}" y="${Y(t) + 3.5}" text-anchor="end">${esc(yFmt(t))}</text>`;
    }
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

// --- Rueckgaengig-Toast ---------------------------------------------------------

const toastEl = $("#toast"), toastText = $("#toast-text"), toastUndo = $("#toast-undo");
let toastTimer = null, toastAction = null;
function toast(text, undo = null) {
  toastText.textContent = text;
  toastAction = undo;
  toastUndo.hidden = !undo;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.classList.remove("on"); toastAction = null; }, undo ? 8000 : 3000);
}
toastUndo.addEventListener("click", async () => {
  const fn = toastAction;
  toastEl.classList.remove("on");
  toastAction = null;
  if (!fn) return;
  try { await fn(); toast("Rückgängig gemacht"); refresh(); } catch (e) { toast(e.message); }
});
const fail = (e) => toast(e.message || "Fehler");

// --- Gemeinsame Bausteine ------------------------------------------------------

function mbar(label, colorVar, value, target, unit = "g") {
  const scale = Math.max(target * 1.2, value || 0) || 1;
  const w = Math.min(100, ((value || 0) / scale) * 100);
  return `<div class="mbar"><div class="lbl"><span><i style="background:var(${colorVar})"></i>${esc(label)}</span>
    <span class="num"><b>${gram(value)}</b> <span class="muted">/ ${n0(target)} ${unit}</span></span></div>
    <div class="track"><b style="width:${w}%;background:var(${colorVar})"></b><s style="left:${(target / scale) * 100}%"></s></div></div>`;
}

function amountText(e) {
  if (e.unit === "kcal") return "Schnelleintrag";
  if (e.unit === "g" || e.unit === "ml") return `${amt(e.amount)} ${e.unit}`;
  const what = e.unit === "piece" ? "Stück" : e.amount === 1 ? "Portion" : "Portionen";
  return `${amt(e.amount)} ${what} · ${n0(e.grams)} g`;
}

function macroMeta(x) {
  if (x.protein == null && x.carbs == null && x.fat == null) return "";
  return `E ${gram(x.protein)} · KH ${gram(x.carbs)} · F ${gram(x.fat)} g`;
}

function entryRow(e) {
  return `<div class="row" data-entry="${e.id}" role="button" tabindex="0">
    <span class="ic food">${foodIcon(kindOf(e.ref))}</span>
    <span style="min-width:0"><div class="ttl">${esc(e.name)}</div>
      <div class="meta"><span>${esc(amountText(e))}</span>${macroMeta(e) ? `<span>${esc(macroMeta(e))}</span>` : ""}</div></span>
    <span class="right"><b>${n0(e.kcal)}</b> kcal<br><span class="muted">${esc(e.time || "")}</span></span>
  </div>`;
}

function foodRow(f, attr = "data-food") {
  const p = f.per100 || {};
  const sub = [f.brand, KIND_LABEL[f.kind]].filter(Boolean).join(" · ");
  return `<div class="row" ${attr}="${esc(f.ref)}" role="button" tabindex="0">
    <span class="ic food">${foodIcon(f.kind)}</span>
    <span style="min-width:0"><div class="ttl">${esc(f.name)}</div>
      <div class="meta"><span>${esc(sub)}</span><span>${esc(macroMeta(p))}</span></div></span>
    <span class="right"><b>${n0(p.kcal)}</b> kcal<br><span class="muted">${f.liquid ? "100 ml" : "100 g"}</span></span>
  </div>`;
}

function budgetSourceLabel(b) {
  return { "garmin-live": "Budget aus Garmin (live)", garmin: "Budget aus Garmin", "garmin-estimate": "Budget geschätzt", fallback: "Ersatzbudget" }[b.source] || "";
}

// --- Heute ---------------------------------------------------------------------

let currentDay = todayIso();
let dayData = null;

async function viewToday(dParam) {
  const dsel = /^\d{4}-\d{2}-\d{2}$/.test(dParam || "") ? dParam : todayIso();
  currentDay = dsel;
  const d = await api(`/api/day?date=${dsel}`);
  dayData = d;
  const yesterday = addDays(todayIso(), -1);
  setHeader(d.isToday ? "Heute" : dsel === yesterday ? "Gestern" : fmtDay(dsel), fmtLong(dsel), "Heute");
  const b = d.budget, t = d.totals, tg = d.targets;
  const eaten = t.kcal || 0;
  const left = b.budget - eaten;
  const over = left < 0;

  let html = `<div class="toolbar">
    <div class="daynav">
      <button class="icon-btn glass" id="d-prev" aria-label="Vorheriger Tag">${icon("left", 2.2)}</button>
      ${d.isToday ? "" : `<button class="sync-btn glass" id="d-today" style="padding:8px 14px">Heute</button>`}
      <button class="icon-btn glass" id="d-next" aria-label="Nächster Tag">${icon("right", 2.2)}</button>
    </div>
    <div class="small ink2">${d.streak ? `${d.streak} ${d.streak === 1 ? "Tag" : "Tage"} in Folge erfasst` : "Noch keine Serie"}</div>
  </div><div class="grid">`;

  html += eveningCard(d.evening);

  // Budget-Karte
  let note;
  if (b.source === "garmin-live") {
    note = `<span>Verbrauch bisher <b>${n0(b.burned)}</b> kcal</span><span>Budget = Ruheumsatz Ø <b>${n0(b.resting)}</b> + aktiv <b>${n0(b.active)}</b>${b.offset ? ` ${signed(b.offset)} Ziel` : ""}</span>`;
  } else if (b.source === "garmin") {
    note = `<span>Verbrauch <b>${n0(b.burned)}</b> kcal${b.final ? "" : " (vorläufig)"}</span><span>Bilanz <b>${signed(eaten - b.burned)}</b> kcal</span>${b.offset ? `<span>Ziel ${signed(b.offset)} kcal</span>` : ""}`;
  } else if (b.source === "garmin-estimate") {
    note = `<span>Verbrauch –</span><span>Budget = Ruheumsatz Ø <b>${n0(b.resting)}</b>${b.offset ? ` ${signed(b.offset)} Ziel` : ""}</span>`;
  } else {
    note = `<span>Garmin-Verbrauch –</span><span>Budget = Ersatzwert aus den Einstellungen</span>`;
  }
  html += `<section class="card glass col-8">
    <div class="card-h"><div class="card-t">${icon("flame")}Kalorien</div><span class="small muted">${esc(budgetSourceLabel(b))}</span></div>
    <div class="budget">
      <div class="ring">${ring(eaten, b.budget, over ? css("--serious") : css("--accent"), 150, 13)}
        <div class="val"><b>${n0(Math.abs(left))}</b><span>${over ? "kcal drüber" : "kcal übrig"}</span></div></div>
      <div class="macros">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><div class="mid">${n0(eaten)}<span class="unit">von ${n0(b.budget)} kcal</span></div>${over ? statusBadge("serious", "Über Budget") : ""}</div>
        ${MACROS.map(([k, l, c]) => mbar(l, c, t[k], tg[k])).join("")}
      </div>
    </div>
    <div class="budget-note">${note}</div>
  </section>`;

  // Naehrwerte + Wasser
  const nut = (label, v, target, kind) => {
    const pct = target ? Math.min(100, ((v || 0) / target) * 100) : 0;
    const overMax = kind === "max" && v > target;
    const reached = kind === "goal" && v >= target;
    return `<div class="nut"><span class="n">${esc(label)} ${overMax ? statusBadge("warn", "über Maximum") : reached ? statusBadge("good", "erreicht") : ""}</span>
      <span class="v"><b>${gram(v)}</b> <span class="muted">/ ${kind === "max" ? "max. " : ""}${gram(target)} g</span></span>
      <div class="meter"><i style="width:${Math.max(2, pct)}%;background:var(--ink-3)"></i></div></div>`;
  };
  const w = d.water;
  html += `<div class="col-4" style="display:grid;gap:14px;align-content:start">
    <section class="card glass"><div class="card-h"><div class="card-t">${icon("grain")}Weitere Nährwerte</div></div>
      <div class="nutlist">${nut("Ballaststoffe", t.fiber, tg.fiber, "goal")}${nut("Zucker", t.sugar, tg.sugar, "max")}${nut("Salz", t.salt, tg.salt, "max")}
      <div class="nut"><span class="n">Gesättigte Fettsäuren</span><span class="v"><b>${gram(t.satfat)}</b> <span class="muted">g</span></span></div></div>
    </section>
    <section class="card glass"><div class="card-h"><div class="card-t">${icon("drop")}Wasser</div><span class="small muted">Ziel ${n1(w.goal / 1000)} l</span></div>
      ${w.training ? `<div class="tiny muted" style="margin:-6px 0 10px">${n1(w.base / 1000)} l + ${n1(w.training / 1000)} l für ${n0(w.trainingMin)} min Training (Garmin)</div>` : ""}
      <div class="water"><div class="mid">${n1(w.ml / 1000)}<span class="unit">l</span></div>
        <div class="water-btns"><button class="chip-btn" data-water="250">${icon("plus", 2.4)}250 ml</button><button class="chip-btn" data-water="500">${icon("plus", 2.4)}500 ml</button></div></div>
      <div class="meter" style="margin-top:12px"><i style="width:${Math.max(2, Math.min(100, (w.ml / (w.goal || 1)) * 100))}%;background:var(--accent)"></i></div>
      ${w.items.length ? `<div class="tiny muted" style="margin-top:8px">${w.items.length} Einträge · zuletzt ${esc(w.items[w.items.length - 1].time || "")} <button class="muted-btn tiny" id="w-undo">Letzten entfernen</button></div>` : ""}
      ${waterGarmin(w)}
    </section></div>`;

  // Mahlzeiten
  for (const [key, label, ic] of MEALS) {
    const items = d.meals[key] || [];
    const sum = items.reduce((a, e) => a + (e.kcal || 0), 0);
    html += `<section class="card glass col-6 meal">
      <div class="card-h"><div class="card-t">${icon(ic)}${label}</div><span class="sum">${items.length ? `${n0(sum)} kcal` : ""}</span></div>
      ${items.some((e) => e.ref) ? `<div style="margin:-6px 0 10px"><button class="card-link" type="button" data-savemeal="${key}">Als Mahlzeit speichern</button></div>` : ""}
      <div class="list">${items.length ? items.map(entryRow).join("") : '<div class="empty">Noch nichts eingetragen</div>'}</div>
      ${!items.length && d.yesterday?.[key] ? `<button class="chip-btn meal-add" data-yesterday="${key}" type="button" style="border-style:solid;margin-bottom:-2px">${icon("clock", 2)}Wie gestern · ${n0(d.yesterday[key].kcal)} kcal</button>
        <div class="tiny muted" style="text-align:center;margin-top:6px">${esc(d.yesterday[key].names.slice(0, 4).join(", "))}${d.yesterday[key].names.length > 4 ? " …" : ""}</div>` : ""}
      <button class="chip-btn meal-add" data-add-meal="${key}" type="button">${icon("plus", 2.2)}Hinzufügen</button>
    </section>`;
  }
  html += `</div>`;
  render(html);

  $$("[data-savemeal]").forEach((b) => (b.onclick = () => saveMealAsTemplate(b.dataset.savemeal)));
  $$("[data-yesterday]").forEach((b) => (b.onclick = async () => {
    const y = d.yesterday[b.dataset.yesterday];
    b.disabled = true;
    try {
      const r = await post("/api/entries/copy", { ids: y.ids, day: dsel, meal: b.dataset.yesterday });
      toast(`${MEAL_LABEL[b.dataset.yesterday]} wie gestern eingetragen`, () => post("/api/entries/delete-many", { ids: r.ids }));
      refresh();
    } catch (e) { b.disabled = false; fail(e); }
  }));
  $$("[data-suggest]").forEach((b) => (b.onclick = () => openSuggestion(d.evening.suggestions[Number(b.dataset.suggest)], dsel)));
  $("#d-prev").onclick = () => (location.hash = `#/heute/${addDays(dsel, -1)}`);
  $("#d-next").onclick = () => (location.hash = `#/heute/${addDays(dsel, 1)}`);
  if ($("#d-today")) $("#d-today").onclick = () => (location.hash = "#/heute");
  $$("[data-water]").forEach((btn) => (btn.onclick = async () => {
    try {
      const r = await post("/api/water", { day: dsel, ml: Number(btn.dataset.water) });
      toast(`${btn.dataset.water} ml Wasser eingetragen`, () => del(`/api/water/${r.id}`));
      refresh();
    } catch (e) { fail(e); }
  }));
  if ($("#w-undo")) $("#w-undo").onclick = async () => {
    const last = w.items[w.items.length - 1];
    try {
      await del(`/api/water/${last.id}`);
      toast(`${n0(last.ml)} ml entfernt`, () => post(`/api/water/${last.id}/restore`));
      refresh();
    } catch (e) { fail(e); }
  };
}

function eveningCard(ev) {
  if (!ev) return "";
  if (ev.kcal < 120) {
    const over = ev.kcal < 0;
    return `<section class="card glass col-12"><div class="card-h" style="margin:0"><div class="card-t">${icon("moon")}Heute Abend</div>
      ${statusBadge(over ? "serious" : "good", over ? `${n0(-ev.kcal)} kcal über Budget` : "Budget erreicht")}</div></section>`;
  }
  const prot = ev.protein >= 10 ? ` und <b>${n0(ev.protein)} g</b> Eiweiß` : "";
  return `<section class="card glass col-12"><div class="card-h"><div class="card-t">${icon("moon")}Heute noch offen</div></div>
    <div class="mid" style="font-size:19px;font-weight:600">Noch <b>${n0(ev.kcal)} kcal</b>${prot}.</div>
    ${ev.suggestions.length ? `<div class="small muted" style="margin:10px 0 8px">Passt aus deinen Sachen:</div>
      <div class="list">${ev.suggestions.map((x, i) => `<div class="row" data-suggest="${i}" role="button" tabindex="0" style="cursor:pointer">
        <span class="ic food">${icon(x.type === "template" ? "pot" : "apple", 1.9)}</span>
        <span style="min-width:0"><div class="ttl">${esc(x.name)}</div><div class="meta"><span>${esc(x.detail)}</span><span>${n0(x.protein)} g Eiweiß</span></div></span>
        <span class="right"><b>${n0(x.kcal)}</b> kcal</span></div>`).join("")}</div>`
      : `<div class="small muted" style="margin-top:8px">Vorschläge erscheinen, sobald du Favoriten oder Mahlzeiten gespeichert hast.</div>`}
  </section>`;
}

async function openSuggestion(x, day) {
  const meal = "dinner";
  try {
    if (x.type === "template") { openTemplate(await api(`/api/templates/${x.id}`), {}); return; }
    const f = await api(`/api/food/${encodeURIComponent(x.ref)}`);
    f.last = { amount: x.amount, unit: x.unit };
    addCtx = { meal, day, tab: "recent", query: "", added: [] };
    openSheet("");
    renderAmount(f, { ctx: addCtx });
  } catch (e) { fail(e); }
}

function waterGarmin(w) {
  const g = w.garmin || {};
  if (!g.enabled || !w.items.length) return "";
  if (g.pending) return `<div class="tiny" style="margin-top:6px">${statusBadge(g.error ? "warn" : "neutral", g.error ? "Garmin gerade nicht erreichbar – wird nachgeholt" : "Wird an Garmin übertragen")}</div>`;
  return `<div class="tiny" style="margin-top:6px">${statusBadge("good", "In Garmin gespeichert")}</div>`;
}

// --- Woche -----------------------------------------------------------------------

let weekStart = null;
async function viewWeek() {
  if (!weekStart) weekStart = todayIso();
  const d = await api(`/api/week?start=${weekStart}`);
  weekStart = d.start;
  const s = pd(d.start), e = pd(d.end);
  const range = s.getMonth() === e.getMonth() ? `${s.getDate()}.–${e.getDate()}. ${MON[e.getMonth()]}` : `${s.getDate()}. ${MON[s.getMonth()]} – ${e.getDate()}. ${MON[e.getMonth()]}`;
  setHeader("Woche", `KW ${isoWeek(s)} · ${range}`, "Woche");
  const days = d.days;
  const past = days.filter((x) => x.date <= d.today);
  const avgBudget = past.length ? past.reduce((a, x) => a + x.budget, 0) / past.length : null;
  const kg = settingsCache?.effectiveWeightKg;

  let html = `<div class="toolbar">
    <div class="daynav">
      <button class="icon-btn glass" id="wk-prev" aria-label="Vorherige Woche">${icon("left", 2.2)}</button>
      <button class="sync-btn glass" id="wk-today" style="padding:8px 14px">Diese Woche</button>
      <button class="icon-btn glass" id="wk-next" aria-label="Nächste Woche">${icon("right", 2.2)}</button>
    </div>
    <div class="small ink2">${d.loggedDays} von ${past.length || 7} Tagen erfasst</div>
  </div><div class="grid">
  <div class="col-12 tiles">
    <div class="tile glass"><div class="t">${icon("flame")}Ø Kalorien</div><div class="v">${n0(d.avg.kcal)}<span class="unit">kcal</span></div><div class="s">Ø Budget ${n0(avgBudget)} kcal</div></div>
    <div class="tile glass"><div class="t">${icon("scale")}Ø Eiweiß</div><div class="v">${gram(d.avg.protein)}<span class="unit">g</span></div><div class="s">${kg && d.avg.protein != null ? `${n1(d.avg.protein / kg)} g/kg` : "–"}</div></div>
    <div class="tile glass"><div class="t">${icon("trend")}Bilanz</div><div class="v">${signed(d.balance)}<span class="unit">kcal</span></div><div class="s">${d.balanceDays ? `gegessen − Verbrauch, ${d.balanceDays} ${d.balanceDays === 1 ? "Tag" : "Tage"}` : "Garmin-Verbrauch –"}</div></div>
    <div class="tile glass"><div class="t">${icon("check")}Im Budget</div><div class="v">${d.inBudget}<span class="unit">Tage</span></div><div class="s">bis 5 % darüber zählt mit</div></div>
  </div>
  <section class="card glass col-8"><div class="card-h"><div class="card-t">${icon("flame")}Kalorien pro Tag</div></div><div class="chart" id="c-kcal"></div>
    ${legend([{ label: "Gegessen", color: css("--accent"), box: true }, { label: "Budget (gestrichelt)", color: css("--ink-3") }, { label: "Verbrauch Garmin (abgeschlossene Tage)", color: css("--ink-2") }])}</section>
  <section class="card glass col-4"><div class="card-h"><div class="card-t">${icon("grain")}Makro-Anteile</div><span class="small muted">Ø erfasste Tage</span></div>${macroShare(d.avg)}</section>
  <section class="card glass col-12"><div class="card-h"><div class="card-t">Makros pro Tag</div><span class="small muted">kcal aus Eiweiß, KH, Fett</span></div><div class="chart" id="c-mac"></div>
    ${legend(MACROS.map(([, l, c]) => ({ label: l, color: css(c), box: true })))}</section>
  <section class="card glass col-12"><div class="card-h"><div class="card-t">${icon("calendar")}Tage</div></div><div class="list dayrows">${days.map((x) => dayRow(x, d.today)).join("")}</div></section>
  </div>`;
  render(html);
  $("#wk-prev").onclick = () => { weekStart = addDays(weekStart, -7); viewWeek().catch(showError); };
  $("#wk-next").onclick = () => { weekStart = addDays(weekStart, 7); viewWeek().catch(showError); };
  $("#wk-today").onclick = () => { weekStart = todayIso(); viewWeek().catch(showError); };

  const base = { n: days.length, height: 200, xLabel: (i) => WD[pd(days[i].date).getDay()], tipTitle: (i) => fmtDay(days[i].date) };
  chart($("#c-kcal"), { ...base, aria: "Kalorien pro Tag",
    bars: [{ label: "Gegessen", color: css("--accent"), values: days.map((x) => (x.entries ? x.kcal : null)), fmt: (v) => `${n0(v)} kcal` }],
    lines: [{ label: "Budget", color: css("--ink-3"), values: days.map((x) => x.budget), dash: true, fmt: (v) => `${n0(v)} kcal` },
      { label: "Verbrauch", color: css("--ink-2"), values: days.map((x) => (x.date < d.today ? x.burned : null)), width: 1.6, fmt: (v) => `${n0(v)} kcal` }] });
  chart($("#c-mac"), { ...base, height: 180, aria: "Makros pro Tag",
    bars: MACROS.map(([k, l, c]) => ({ label: l, color: css(c), values: days.map((x) => (x[k] == null ? null : x[k] * KCAL_PER_G[k])),
      fmt: (v) => `${n0(v)} kcal` })),
    extraTip: (i) => MACROS.map(([k, l]) => ({ label: `${l} (g)`, value: `${gram(days[i][k])} g` })) });
}

function dayRow(x, today) {
  const pct = x.budget ? Math.min(100, ((x.kcal || 0) / (Math.max(x.budget, x.kcal || 0) * 1.05)) * 100) : 0;
  const mark = x.budget ? (x.budget / (Math.max(x.budget, x.kcal || 0) * 1.05)) * 100 : 0;
  const future = x.date > today;
  let badge = "";
  if (x.entries && !future && x.date < today) badge = (x.kcal || 0) <= x.budget * 1.05 ? statusBadge("good", "Im Budget") : statusBadge("serious", "Darüber");
  else if (x.date === today) badge = statusBadge("neutral", "Heute");
  return `<div class="row ${x.date === today ? "today" : ""}" data-day="${x.date}" role="button" tabindex="0" style="cursor:pointer">
    <span class="dname">${WD[pd(x.date).getDay()]}<small>${fmtShort(x.date)}</small></span>
    <span style="min-width:0"><div class="small"><b>${x.entries ? n0(x.kcal) : "–"}</b> <span class="muted">/ ${n0(x.budget)} kcal</span></div>
      <div class="kbar"><b style="width:${pct}%"></b><s style="left:${mark}%"></s></div></span>
    <span class="right">${badge}</span></div>`;
}

function macroShare(avg) {
  const kc = MACROS.map(([k]) => (avg[k] || 0) * KCAL_PER_G[k]);
  const tot = kc.reduce((a, b) => a + b, 0);
  if (!tot) return '<div class="empty-state">Noch keine Daten</div>';
  return `<div class="stagebar">${MACROS.map(([, l, c], i) => (kc[i] ? `<i style="width:${(kc[i] / tot) * 100}%;background:var(${c})" title="${esc(l)}"></i>` : "")).join("")}</div>
    <div class="nutlist" style="margin-top:12px">${MACROS.map(([k, l, c], i) => `<div class="nut"><span class="n"><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(${c});margin-right:6px"></i>${esc(l)}</span>
      <span class="v"><b>${n0((kc[i] / tot) * 100)} %</b> <span class="muted">· Ø ${gram(avg[k])} g</span></span></div>`).join("")}</div>`;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

// --- Verlauf -----------------------------------------------------------------------

let historyDays = 30;
async function viewHistory() {
  setHeader("Verlauf", `Letzte ${historyDays === 365 ? "12 Monate" : `${historyDays} Tage`}`, "Verlauf");
  const [d, info] = await Promise.all([api(`/api/history?days=${historyDays}`), api("/api/info")]);
  const rows = d.days;
  const closed = rows.filter((x) => x.entries && x.burned && x.date < todayIso());
  const avgBal = closed.length ? d.balance / closed.length : null;
  const kg = settingsCache?.effectiveWeightKg;
  let html = `<div class="toolbar"><div class="segment glass">${[30, 90, 365].map((n) => `<button class="${n === historyDays ? "on" : ""}" data-days="${n}">${n === 365 ? "1 J" : `${n} T`}</button>`).join("")}</div></div>
  <div class="grid">
    <div class="col-12 tiles">
      <div class="tile glass"><div class="t">${icon("bolt")}Serie</div><div class="v">${d.streak}<span class="unit">${d.streak === 1 ? "Tag" : "Tage"}</span></div><div class="s">in Folge erfasst</div></div>
      <div class="tile glass"><div class="t">${icon("calendar")}Erfasst</div><div class="v">${d.loggedDays}<span class="unit">/ ${rows.length}</span></div><div class="s">${d.logged} Tage insgesamt${d.since ? ` seit ${fmtShort(d.since)}${d.since.slice(0, 4)}` : ""}</div></div>
      <div class="tile glass"><div class="t">${icon("flame")}Ø Kalorien</div><div class="v">${n0(d.avg.kcal)}<span class="unit">kcal</span></div><div class="s">an erfassten Tagen</div></div>
      <div class="tile glass"><div class="t">${icon("trend")}Ø Bilanz</div><div class="v">${signed(avgBal)}<span class="unit">kcal</span></div><div class="s">${closed.length ? `pro Tag, ${closed.length} Tage mit Garmin` : "Garmin-Verbrauch –"}</div></div>
    </div>
    <section class="card glass col-12"><div class="card-h"><div class="card-t">${icon("flame")}Gegessen und Budget</div><span class="small muted">kcal pro Tag</span></div><div class="chart" id="h-kcal"></div>
      ${legend([{ label: "Gegessen", color: css("--accent"), box: true }, { label: "Budget (gestrichelt)", color: css("--ink-3") }])}</section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("trend")}Energiebilanz</div><span class="small muted">nur Tage mit Garmin-Verbrauch</span></div><div class="chart" id="h-bal"></div>
      ${legend([{ label: "Gegessen", color: css("--accent") }, { label: "Verbrauch Garmin", color: css("--ink-3") }])}</section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("scale")}Eiweiß</div><span class="small muted">g pro Tag${kg ? ` · Ziel ${n0(kg * settingsCache.proteinPerKg)} g` : ""}</span></div><div class="chart" id="h-prot"></div>
      ${legend([{ label: "Eiweiß", color: css("--protein"), box: true }, { label: "Ziel (gestrichelt)", color: css("--ink-3") }])}</section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("grain")}Makro-Anteile</div><span class="small muted">Ø erfasste Tage</span></div>${macroShare(d.avg)}</section>
    <section class="card glass col-6"><div class="card-h"><div class="card-t">${icon("drop")}Wasser</div><span class="small muted">Liter pro Tag</span></div><div class="chart" id="h-water"></div></section>
    <section class="card glass col-12"><div class="card-h"><div class="card-t">${icon("info")}Datenquellen & Info</div></div>${sourcesInfo(info)}</section>
  </div>
  <button class="sync-btn glass logout" id="logout" type="button">Auf diesem Gerät abmelden</button>`;
  render(html);
  $("#logout").onclick = async () => { await fetch("/api/logout", { method: "POST" }); location.replace("/login.html"); };
  $$("[data-days]").forEach((b) => (b.onclick = () => { historyDays = Number(b.dataset.days); viewHistory().catch(showError); }));

  const base = { n: rows.length, height: 190, xLabel: (i) => fmtShort(rows[i].date), tipTitle: (i) => fmtDay(rows[i].date) };
  // Budgetlinie erst ab dem ersten Tag mit Eintraegen oder Garmin-Verbrauch
  const firstData = Math.max(0, rows.findIndex((x) => x.entries || x.burned));
  chart($("#h-kcal"), { ...base, aria: "Gegessen und Budget",
    bars: [{ label: "Gegessen", color: css("--accent"), values: rows.map((x) => (x.entries ? x.kcal : null)), fmt: (v) => `${n0(v)} kcal` }],
    lines: [{ label: "Budget", color: css("--ink-3"), values: rows.map((x, i) => (i >= firstData ? x.budget : null)), dash: true, fmt: (v) => `${n0(v)} kcal` }] });
  chart($("#h-bal"), { ...base, height: 180, aria: "Energiebilanz",
    lines: [{ label: "Gegessen", color: css("--accent"), values: rows.map((x) => (x.entries && x.burned && x.date < todayIso() ? x.kcal : null)), dots: rows.length <= 31, fmt: (v) => `${n0(v)} kcal` },
      { label: "Verbrauch", color: css("--ink-3"), values: rows.map((x) => (x.date < todayIso() ? x.burned : null)), fmt: (v) => `${n0(v)} kcal` }],
    extraTip: (i) => { const x = rows[i]; return [{ label: "Bilanz", value: x.entries && x.burned ? `${signed(x.kcal - x.burned)} kcal` : "–" }]; } });
  chart($("#h-prot"), { ...base, height: 180, aria: "Eiweiß pro Tag",
    bars: [{ label: "Eiweiß", color: css("--protein"), values: rows.map((x) => (x.entries ? x.protein : null)), fmt: (v) => `${gram(v)} g` }],
    lines: kg ? [{ label: "Ziel", color: css("--ink-3"), values: rows.map(() => kg * settingsCache.proteinPerKg), dash: true, fmt: (v) => `${n0(v)} g` }] : [] });
  chart($("#h-water"), { ...base, height: 180, aria: "Wasser pro Tag", yFmt: (v) => n1(v),
    bars: [{ label: "Wasser", color: css("--accent"), values: rows.map((x) => (x.water ? x.water / 1000 : null)), fmt: (v) => `${n1(v)} l` }] });
}

function sourcesInfo(info) {
  const s = info.sources || {};
  const line = (m, what) => (m ? `${n0(Number(m.count))} ${what}, Stand ${ago(m.imported_at)}` : "noch nicht importiert");
  const g = info.garmin || {};
  return `<div class="source-list">
    <div><b>Bundeslebensmittelschlüssel (BLS) 4.0</b> · ${esc(line(s.bls, "Lebensmittel"))}<br>
      Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe.
      Lizenz <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener">CC BY 4.0</a>, <a href="https://www.blsdb.de" target="_blank" rel="noopener">blsdb.de</a>.</div>
    <div><b>Open Food Facts</b> · ${esc(line(s.off, "Produkte aus Deutschland"))} (fester Stand, neue Produkte selbst erfassen)<br>
      Daten © Open-Food-Facts-Mitwirkende, Lizenz <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">Open Database License (ODbL)</a>,
      Bilder CC BY-SA. <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">openfoodfacts.org</a>. Unbekannte Barcodes werden einzeln live nachgeschlagen.</div>
    <div><b>Eigene Produkte</b> · ${n0((info.own || {}).own || 0)} erfasst, ${n0((info.own || {})["off-live"] || 0)} per Barcode von Open Food Facts geladen · <b>Rezepte</b> · ${n0(info.recipes)}</div>
    <div><b>Garmin-Verbrauch</b> · ${g.enabled ? (g.error ? "Training-Dashboard gerade nicht erreichbar" : g.lastOk ? `über das Training-Dashboard, zuletzt ${new Date(g.lastOk * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr` : "über das Training-Dashboard") : "nicht verbunden – Budget = Ersatzwert"}</div>
  </div>`;
}

// --- Lebensmittel ---------------------------------------------------------------------

// --- Mahlzeiten (Tab): gespeicherte Mahlzeiten, Rezepte, eigene Produkte -------------------

let mealsTab = "templates";
async function viewMeals() {
  setHeader("Mahlzeiten", "Vorlagen und Rezepte", "Mahlzeiten");
  const [t, lists] = await Promise.all([api("/api/templates"), api("/api/lists")]);
  const tabs = [["templates", "Mahlzeiten"], ["recipes", "Rezepte"], ["products", "Produkte"]];
  const addLabel = { templates: "Neue Mahlzeit", recipes: "Neues Rezept", products: "Neues Produkt" }[mealsTab];
  let body = "";
  if (mealsTab === "templates") {
    body = t.templates.length ? `<div class="tpl-grid">${t.templates.map(tplCard).join("")}</div>`
      : `<section class="card glass"><div class="empty-state">Noch keine gespeicherten Mahlzeiten.<br>
          Am schnellsten geht es in <a class="card-link" href="#/heute">Heute</a>: bei einer Mahlzeit mit Einträgen auf „Als Mahlzeit speichern“ tippen.
          Oder hier eine neue zusammenstellen – etwa dein übliches Frühstück.</div></section>`;
  } else if (mealsTab === "recipes") {
    body = `<section class="card glass"><p class="small muted" style="margin:0 0 12px">Ein Rezept ist ein gekochtes Gericht: Zutaten plus Gewicht nach dem Kochen ergeben Nährwerte pro 100 g. Eingetragen wird dann die Menge, die du isst.</p>
      <div class="list">${lists.recipes.length ? lists.recipes.map((f) => foodRow(f)).join("") : '<div class="empty-state">Noch keine Rezepte.</div>'}</div></section>`;
  } else {
    body = `<section class="card glass"><div class="searchbox">${icon("search")}<input class="field" id="p-filter" type="search" placeholder="In meinen Produkten suchen" autocomplete="off"></div>
      <div class="chips" style="margin-top:10px"><button class="chip-btn" id="p-scan">${icon("barcode", 2)}Barcode prüfen</button></div>
      <div class="list" id="p-list" style="margin-top:12px">${lists.own.length ? lists.own.map((f) => foodRow(f)).join("")
        : '<div class="empty-state">Noch keine eigenen Produkte. Was die Suche nicht findet, über „Neues Produkt“ erfassen – mit Barcode wird es beim nächsten Scan sofort erkannt.</div>'}</div></section>`;
  }
  render(`<div class="seg-bar"><div class="segment glass">${tabs.map(([k, l]) => `<button class="${k === mealsTab ? "on" : ""}" data-mtab="${k}">${l}</button>`).join("")}</div>
    <button class="sync-btn glass add-btn" id="m-new" type="button">${icon("plus", 2.2)}${addLabel}</button></div>${body}`);
  $$("[data-mtab]").forEach((b) => (b.onclick = () => { mealsTab = b.dataset.mtab; viewMeals().catch(showError); }));
  $("#m-new").onclick = () => (mealsTab === "templates" ? openTemplateForm() : mealsTab === "recipes" ? openRecipeForm() : openProductForm());
  if ($("#p-filter")) $("#p-filter").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$("#p-list [data-food]").forEach((r) => (r.hidden = q && !r.textContent.toLowerCase().includes(q)));
  };
  if ($("#p-scan")) $("#p-scan").onclick = () => { openSheet(""); renderScan({ meal: null, day: todayIso(), browse: true }); };
}

const tplKcal = (t) => n0(t.totals.kcal);
const tplNames = (t) => t.items.map((i) => i.name.split(",")[0]).join(", ");
function tplRow(t) {
  return `<div class="row" data-tpl="${t.id}" role="button" tabindex="0">
    <span class="ic food">${icon("pot", 1.9)}</span>
    <span style="min-width:0"><div class="ttl">${esc(t.name)}</div><div class="meta"><span>${esc(tplNames(t))}</span></div></span>
    <span class="right"><b>${tplKcal(t)}</b> kcal<br><span class="muted">${t.items.length} Teile</span></span></div>`;
}
function tplCard(t) {
  const kc = MACROS.map(([k]) => (t.totals[k] || 0) * KCAL_PER_G[k]);
  const tot = kc.reduce((a, b) => a + b, 0);
  return `<button class="tpl glass" data-tpl="${t.id}" type="button">
    <div class="tpl-h"><b>${esc(t.name)}</b><span class="small"><b>${tplKcal(t)}</b> <span class="muted">kcal</span></span></div>
    <div class="tpl-items">${esc(tplNames(t))}</div>
    ${tot ? `<div class="stagebar">${MACROS.map(([, l, c], i) => (kc[i] ? `<i style="width:${(kc[i] / tot) * 100}%;background:var(${c})" title="${esc(l)}"></i>` : "")).join("")}</div>` : ""}
    <div class="small muted">${t.meal ? `${esc(MEAL_LABEL[t.meal])} · ` : ""}E ${gram(t.totals.protein)} · KH ${gram(t.totals.carbs)} · F ${gram(t.totals.fat)} g</div></button>`;
}

const unitLabel = (u, food) => (u === "piece" ? (food?.piece?.label || "Stück") : u === "serving" ? "Portion" : u);
function unitOptions(item) {
  const opts = item.units || [[item.unit, unitLabel(item.unit)]];
  return opts.map(([u, l]) => `<option value="${u}" ${u === item.unit ? "selected" : ""}>${esc(l)}</option>`).join("");
}
function foodUnits(f) {
  const base = f.liquid ? "ml" : "g";
  return [[base, base], ...(f.piece ? [["piece", f.piece.label || "Stück"]] : []), ...(f.serving ? [["serving", "Portion"]] : [])];
}
function defaultAmount(f) {
  if (f.last) return { amount: f.last.amount, unit: f.last.unit };
  if (f.piece) return { amount: 1, unit: "piece" };
  if (f.serving && f.serving.g <= 300) return { amount: 1, unit: "serving" };
  return { amount: 100, unit: f.liquid ? "ml" : "g" };
}

/** Gespeicherte Mahlzeit eintragen: Teile an-/abwaehlen, Mengen fuer heute anpassen. */
function openTemplate(t, { ctx = null } = {}) {
  if (!sheet.classList.contains("on")) openSheet("");
  sheet.onclick = null;
  const items = t.items.map((it, i) => ({ ...it, index: i, include: it.available }));
  let meal = ctx?.meal || t.meal || defaultMealNow();
  const day = ctx?.day || (currentTab() === "heute" ? currentDay : todayIso());
  sheet.innerHTML = `${sheetTop(t.name, { back: !!ctx })}
    <div class="segment glass" style="margin-bottom:12px">${MEALS.map(([k, l]) => `<button class="${k === meal ? "on" : ""}" data-tmeal="${k}">${l}</button>`).join("")}</div>
    <div class="list" id="t-items">${items.map((it) => `<div class="tpl-row ${it.available ? "" : "off"}" data-i="${it.index}">
        <input type="checkbox" ${it.include ? "checked" : ""} ${it.available ? "" : "disabled"} aria-label="${esc(it.name)} eintragen">
        <span style="min-width:0"><div class="ttl">${esc(it.name)}</div><div class="sub" data-kcal>${it.available ? `${n0(it.kcal)} kcal` : "nicht mehr verfügbar"}</div></span>
        <input class="field" inputmode="decimal" value="${inputVal(it.amount)}" aria-label="Menge" ${it.available ? "" : "disabled"}>
        <select class="field" aria-label="Einheit" ${it.available ? "" : "disabled"}>${unitOptions(it)}</select></div>`).join("")}</div>
    <div class="preview" id="t-pv"></div>
    <p class="small muted" style="margin:0">Mengen gelten nur für diesen Eintrag. Die gespeicherte Mahlzeit bleibt unverändert.</p>
    <div class="btn-row">${ctx ? "" : `<button class="secondary" id="t-edit">Bearbeiten</button>`}<button class="primary" id="t-log">Eintragen · ${fmtDay(day)}</button></div>
    ${ctx ? "" : `<div style="text-align:center;margin-top:10px"><button class="muted-btn" id="t-del" style="color:var(--critical)">Mahlzeit löschen</button></div>`}`;
  // kcal je Teil aus dem gespeicherten Verhaeltnis kcal/Menge hochrechnen (gleiche Einheit)
  // Werte je Mengeneinheit einmalig festhalten - `items` wird beim Tippen veraendert
  const perUnit = items.map((it) => {
    if (!it.amount) return null;
    const per = Object.fromEntries(["kcal", "protein", "carbs", "fat"].map((k) => [k, it[k] == null ? null : it[k] / it.amount]));
    return { unit: it.unit, f: (k) => per[k] };
  });
  const calc = () => {
    const tot = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    $$(".tpl-row", sheet).forEach((row) => {
      const it = items[Number(row.dataset.i)];
      it.include = row.querySelector("input[type=checkbox]").checked;
      it.amount = num(row.querySelector("input.field").value) || 0;
      it.unit = row.querySelector("select").value;
      row.classList.toggle("off", !it.include);
      const pu = perUnit[it.index];
      const same = pu && pu.unit === it.unit;
      const kcal = same && pu.f("kcal") != null ? pu.f("kcal") * it.amount : null;
      row.querySelector("[data-kcal]").textContent = !it.available ? "nicht mehr verfügbar" : kcal != null ? `${n0(kcal)} kcal` : "–";
      if (it.include && same) for (const k of Object.keys(tot)) tot[k] += (pu.f(k) || 0) * it.amount;
    });
    $("#t-pv").innerHTML = `<div><div class="l">kcal</div><div class="v">${n0(tot.kcal)}</div></div>
      ${MACROS.map(([k, l, c]) => `<div><div class="l"><i style="background:var(${c})"></i>${k === "carbs" ? "KH" : l}</div><div class="v">${gram(tot[k])}<span class="unit">g</span></div></div>`).join("")}`;
    $("#t-log").disabled = !items.some((i) => i.include && i.amount > 0);
    return tot;
  };
  $("#t-items").addEventListener("input", calc);
  $("#t-items").addEventListener("change", calc);
  calc();
  $$("[data-tmeal]", sheet).forEach((b) => (b.onclick = () => { meal = b.dataset.tmeal; $$("[data-tmeal]", sheet).forEach((x) => x.classList.toggle("on", x === b)); }));
  if ($("[data-back]", sheet)) $("[data-back]", sheet).onclick = renderAddHome;
  $("#t-log").onclick = async () => {
    const tot = calc();
    try {
      const r = await post(`/api/templates/${t.id}/log`, { day, meal, items: items.map((i) => ({ index: i.index, include: i.include, amount: i.amount, unit: i.unit })) });
      if (ctx) { ctx.meal = meal; toast(`${t.name} hinzugefügt`); noteAdded(ctx, { ids: r.ids, label: `${t.name} (${r.ids.length})`, kcal: tot.kcal }); return; }
      closeSheet();
      toast(`${t.name} eingetragen`, () => post("/api/entries/delete-many", { ids: r.ids }));
      if (currentTab() !== "heute" || currentDay !== day) location.hash = day === todayIso() ? "#/heute" : `#/heute/${day}`;
      else refresh();
    } catch (e) { fail(e); }
  };
  if ($("#t-edit")) $("#t-edit").onclick = () => openTemplateForm(t);
  if ($("#t-del")) $("#t-del").onclick = async () => {
    try {
      await del(`/api/templates/${t.id}`); closeSheet();
      toast(`${t.name} gelöscht`, () => post(`/api/templates/${t.id}/restore`)); refresh();
    } catch (e) { fail(e); }
  };
}

/** Mahlzeit neu zusammenstellen oder bearbeiten. */
function openTemplateForm(t = null, { items: preset = null } = {}) {
  if (!sheet.classList.contains("on")) openSheet("");
  sheet.onclick = null;
  const items = (preset || t?.items || []).map((it) => ({ ...it }));
  let meal = t?.meal || null;
  sheet.innerHTML = `${sheetTop(t ? "Mahlzeit bearbeiten" : "Neue Mahlzeit")}
    <div class="form">
      <label>Name<input class="field" id="tf-name" maxlength="80" value="${esc(t?.name || "")}" placeholder="z. B. Mein Frühstück"></label>
      <div><div class="small muted" style="font-weight:600;margin-bottom:6px">Passt zu (optional)</div>
        <div class="segment glass" style="width:100%;display:grid">${MEALS.map(([k, l]) => `<button type="button" class="${k === meal ? "on" : ""}" data-fmeal="${k}">${l}</button>`).join("")}</div></div>
      <h3>Bestandteile</h3>
      <div class="list" id="tf-items"></div>
      <div class="searchbox">${icon("search")}<input class="field" id="tf-q" type="search" placeholder="Lebensmittel hinzufügen" autocomplete="off"></div>
      <div id="tf-results"></div>
      <p class="err small" id="tf-err"></p>
    </div>
    <div class="btn-row"><button class="primary" id="tf-save">${t ? "Speichern" : "Mahlzeit speichern"}</button></div>`;
  const draw = () => {
    $("#tf-items").innerHTML = items.length ? items.map((it, i) => `<div class="tpl-row" style="grid-template-columns:minmax(0,1fr) 76px 84px 34px">
        <span style="min-width:0"><div class="ttl">${esc(it.name)}</div></span>
        <input class="field" data-a="${i}" inputmode="decimal" value="${inputVal(it.amount)}" aria-label="Menge">
        <select class="field" data-u="${i}" aria-label="Einheit">${unitOptions(it)}</select>
        <button class="icon-btn sm flat rm" type="button" data-rm="${i}" aria-label="Entfernen">${icon("x", 2)}</button></div>`).join("")
      : '<div class="small muted">Noch leer. Unten suchen und antippen.</div>';
  };
  draw();
  $("#tf-items").addEventListener("input", (e) => { if (e.target.dataset.a != null) items[e.target.dataset.a].amount = num(e.target.value); });
  $("#tf-items").addEventListener("change", (e) => { if (e.target.dataset.u != null) items[e.target.dataset.u].unit = e.target.value; });
  $("#tf-items").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { items.splice(Number(b.dataset.rm), 1); draw(); } });
  $$("[data-fmeal]", sheet).forEach((b) => (b.onclick = () => {
    meal = meal === b.dataset.fmeal ? null : b.dataset.fmeal;
    $$("[data-fmeal]", sheet).forEach((x) => x.classList.toggle("on", x.dataset.fmeal === meal));
  }));
  const box = $("#tf-q");
  liveSearch(box, $("#tf-results"), (f) => foodRow(f, "data-ing"), null, { create: false });
  $("#tf-results").addEventListener("click", async (e) => {
    const row = e.target.closest("[data-ing]");
    if (!row) return;
    try {
      const f = await api(`/api/food/${encodeURIComponent(row.dataset.ing)}`);
      items.push({ ref: f.ref, name: f.name, ...defaultAmount(f), units: foodUnits(f) });
      box.value = ""; $("#tf-results").innerHTML = "";
      draw();
    } catch (err) { fail(err); }
  });
  $("#tf-save").onclick = async () => {
    const body = { name: $("#tf-name").value, meal, items: items.map((i) => ({ ref: i.ref, amount: i.amount, unit: i.unit })) };
    try {
      if (t) await put(`/api/templates/${t.id}`, body); else await post("/api/templates", body);
      closeSheet(); toast("Mahlzeit gespeichert");
      if (currentTab() === "mahlzeiten") refresh(); else { mealsTab = "templates"; location.hash = "#/mahlzeiten"; }
    } catch (e) { $("#tf-err").textContent = e.message; }
  };
}

/** "Als Mahlzeit speichern" aus einer Mahlzeitenkarte in Heute. */
function saveMealAsTemplate(mealKey) {
  const entries = (dayData?.meals[mealKey] || []).filter((e) => e.ref);
  if (!entries.length) { toast("Schnelleinträge lassen sich nicht speichern"); return; }
  const suggestion = entries.slice(0, 2).map((e) => e.name.split(",")[0]).join(" + ") + (entries.length > 2 ? " …" : "");
  openSheet(`${sheetTop("Als Mahlzeit speichern")}
    <div class="form">
      <p class="small ink2" style="margin:0">${entries.map((e) => `${esc(e.name)} · ${esc(amountText(e))}`).join("<br>")}</p>
      <label>Name<input class="field" id="sm-name" maxlength="80" value="${esc(suggestion)}"></label>
      <p class="err small" id="sm-err"></p>
    </div>
    <div class="btn-row"><button class="primary" id="sm-save">Speichern</button></div>`);
  const nameEl = $("#sm-name");
  if (matchMedia("(pointer: fine)").matches) { nameEl.focus(); nameEl.select(); }
  $("#sm-save").onclick = async () => {
    try {
      await post("/api/templates/from-entries", { day: currentDay, meal: mealKey, name: nameEl.value });
      closeSheet();
      toast(`„${nameEl.value}“ gespeichert – unter Mahlzeiten und beim Eintragen`);
    } catch (e) { $("#sm-err").textContent = e.message; }
  };
}

/** Suche waehrend der Eingabe: entprellt, veraltete Antworten werden verworfen. */
function liveSearch(input, out, rowFn, onChange, { create = true, ctx = null } = {}) {
  let timer = null, seq = 0;
  const run = async () => {
    const q = input.value.trim();
    onChange?.();
    const my = ++seq;
    if (q.length < 2) { out.innerHTML = ""; return; }
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (my !== seq) return;
      const add = create ? `<button class="chip-btn meal-add" data-create="${esc(q)}" type="button">${icon("plus", 2.2)}Neues Produkt hinzufügen</button>` : "";
      out.innerHTML = r.results.length
        ? `<div class="results-h">Treffer</div><div class="list">${r.results.map(rowFn).join("")}</div>${create ? `<div class="small muted" style="text-align:center;margin-top:12px">Nicht dabei?</div>${add}` : ""}`
        : `<div class="empty-state" style="padding-bottom:10px">Kein Produkt gefunden für „${esc(q)}“.</div>${add}`;
    } catch (e) { if (my === seq) out.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 180); });
  out.addEventListener("click", (e) => {
    const c = e.target.closest("[data-create]");
    if (!c) return;
    // Ziffernfolge = vermutlich ein Barcode, sonst die Eingabe als Bezeichnung vorbelegen
    const q = c.dataset.create;
    openProductForm(/^\d{8,14}$/.test(q) ? { code: q } : { name: q }, { ctx });
  });
  return run;
}

// --- Sheet ---------------------------------------------------------------------------

const sheet = $("#sheet"), sheetBg = $("#sheet-bg");
function openSheet(html) {
  sheet.innerHTML = html;
  sheet.scrollTop = 0;
  sheet.classList.add("on"); sheetBg.classList.add("on");
  document.body.style.overflow = "hidden";
  fitSheet();
}
function closeSheet() {
  stopScan();
  const wasOpen = sheet.classList.contains("on");
  sheet.classList.remove("on"); sheetBg.classList.remove("on");
  document.body.style.overflow = "";
  document.activeElement?.blur?.();
  hideTip();
  // Wurden im Sheet Eintraege fuer einen anderen Tag gesammelt, dorthin wechseln
  if (wasOpen && addCtx?.added?.length) {
    const d = addCtx.day;
    addCtx.added = [];
    if (currentTab() !== "heute" || currentDay !== d) location.hash = d === todayIso() ? "#/heute" : `#/heute/${d}`;
  }
}
sheetBg.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.classList.contains("on")) closeSheet(); });

// iOS: Die Tastatur verkleinert nur den sichtbaren Bereich (visualViewport), nicht das Layout.
// Das Sheet sitzt deshalb direkt ueber der Tastatur und ist nie hoeher als der sichtbare Teil.
const vv = window.visualViewport;
function fitSheet() {
  if (!vv || innerWidth >= 900 || !sheet.classList.contains("on")) { sheet.style.bottom = ""; sheet.style.maxHeight = ""; return; }
  const keyboard = Math.max(0, innerHeight - vv.height - vv.offsetTop);
  sheet.style.bottom = `${keyboard}px`;
  sheet.style.maxHeight = `${Math.round(Math.min(innerHeight * 0.92, vv.height - (keyboard ? 6 : 0)))}px`;
}
vv?.addEventListener("resize", fitSheet);
vv?.addEventListener("scroll", fitSheet);
// Fokussiertes Feld sichtbar halten (unter dem fixierten Kopf)
sheet.addEventListener("focusin", (e) => {
  if (!e.target.matches("input, select, textarea") || e.target.closest(".sheet-head")) return;
  setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
});

// Nach unten wischen schliesst das Sheet - nur am Kopf (Griff/Titel), damit Scrollen im Inhalt nie schliesst
let dragY = null;
sheet.addEventListener("touchstart", (e) => {
  const head = e.target.closest(".sheet-head");
  dragY = head && !e.target.closest("input,select,textarea,button,.segment") ? e.touches[0].clientY : null;
}, { passive: true });
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
  if (dy > 90) closeSheet();
});

/** Kopf jedes Sheets: Griff, Titel, Schliessen; `head` = weitere fixierte Inhalte (z. B. Suchfeld). */
const sheetTop = (title, { back = false, extra = "", head = "", cls = "" } = {}) => `<div class="sheet-head ${cls}"><div class="grab"></div>
  <div class="sheet-top">${back ? `<button class="icon-btn sm glass" data-back aria-label="Zurück">${icon("left", 2.2)}</button>` : ""}
    <h2>${esc(title)}</h2>${extra}<button class="icon-btn sm glass" data-close aria-label="Schließen">${icon("x", 2.2)}</button></div>${head}</div>`;
sheet.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeSheet(); });

// --- Eintragen ---------------------------------------------------------------------------

let addCtx = null;
function openAdd({ meal = null, day = null } = {}) {
  const d = day || (currentTab() === "heute" ? currentDay : todayIso());
  const m = meal || (d === currentDay && dayData ? dayData.defaultMeal : "snack");
  addCtx = { meal: m, day: d, tab: addCtx?.tab || "recent", query: "", added: [] };
  openSheet("");
  renderAddHome();
}

/** Nach dem Hinzufuegen im Sheet bleiben: merken, Tagesansicht im Hintergrund aktualisieren. */
function noteAdded(ctx, item) {
  ctx.added = ctx.added || [];
  ctx.added.push(item);
  ctx.query = "";
  refresh();
  renderAddHome();
}

function addedStrip(c) {
  if (!c.added?.length) return "";
  const kcal = c.added.reduce((a, x) => a + (x.kcal || 0), 0);
  return `<div class="added"><div class="added-h"><span>${statusBadge("good", `${c.added.length} hinzugefügt`)} <b>${n0(kcal)} kcal</b></span>
      <button class="primary" type="button" id="a-done">Fertig</button></div>
    <div class="added-list">${c.added.map((x, i) => `<span>${esc(x.label)}<button type="button" data-unadd="${i}" aria-label="${esc(x.label)} entfernen">${icon("x", 2.4)}</button></span>`).join("")}</div></div>`;
}

async function renderAddHome() {
  const c = addCtx;
  const dayLabel = c.day === todayIso() ? "" : ` · ${fmtDay(c.day)}`;
  const head = `${addedStrip(c)}
    <div class="segment glass when-idle" style="margin-bottom:10px">${MEALS.map(([k, l]) => `<button class="${k === c.meal ? "on" : ""}" data-meal="${k}">${l}</button>`).join("")}</div>
    <div class="searchbox">${icon("search")}<input class="field" id="a-q" type="search" enterkeyhint="search" placeholder="Suchen, z. B. Haferflocken" autocomplete="off" value="${esc(c.query)}"></div>
    <div class="chips when-idle" style="margin-top:10px">
      <button class="chip-btn" id="a-scan">${icon("barcode", 2)}Scannen</button>
      <button class="chip-btn" id="a-quick">${icon("flame", 2)}Nur kcal</button>
      <button class="chip-btn" id="a-new">${icon("plus", 2.2)}Neues Produkt</button>
    </div>`;
  sheet.innerHTML = `${sheetTop(`${MEAL_LABEL[c.meal]}${dayLabel}`, { head, cls: c.query ? "compact" : "" })}
    <div id="a-results"></div>
    <div id="a-lists" ${c.query ? "hidden" : ""}>
      <div class="segment glass" style="margin-top:12px">${[["recent", "Zuletzt"], ["favorites", "Favoriten"], ["templates", "Mahlzeiten"], ["recipes", "Rezepte"]].map(([k, l]) => `<button class="${k === c.tab ? "on" : ""}" data-atab="${k}">${l}</button>`).join("")}</div>
      <div class="list" id="a-list"><div class="skeleton" style="height:60px"></div></div>
    </div>`;
  fitSheet();
  const head$ = $(".sheet-head", sheet);
  $$("[data-meal]", sheet).forEach((b) => (b.onclick = () => {
    c.meal = b.dataset.meal;
    $$("[data-meal]", sheet).forEach((x) => x.classList.toggle("on", x === b));
    $(".sheet-top h2", sheet).textContent = `${MEAL_LABEL[c.meal]}${dayLabel}`;
  }));
  $("#a-scan").onclick = () => renderScan(c);
  $("#a-quick").onclick = () => renderQuick({ ctx: c });
  $("#a-new").onclick = () => openProductForm({ name: $("#a-q").value.trim() }, { ctx: c });
  if ($("#a-done")) $("#a-done").onclick = closeSheet;
  $$("[data-unadd]", sheet).forEach((b) => (b.onclick = async () => {
    const x = c.added[Number(b.dataset.unadd)];
    try {
      await post("/api/entries/delete-many", { ids: x.ids });
      c.added.splice(Number(b.dataset.unadd), 1);
      toast(`${x.label} entfernt`, () => post("/api/entries/delete-many", { ids: x.ids, undo: true }));
      refresh(); renderAddHome();
    } catch (e) { fail(e); }
  }));
  const box = $("#a-q");
  const run = liveSearch(box, $("#a-results"), (f) => foodRow(f, "data-pick"), () => {
    c.query = box.value;
    $("#a-lists").hidden = !!box.value.trim();
    head$.classList.toggle("compact", !!box.value.trim());
  }, { ctx: c });
  // Bei offener Tastatur zaehlt jeder Pixel: Kopf beim Tippen auf Titel, Leiste und Suchfeld reduzieren
  box.addEventListener("focus", () => { if (innerWidth < 900) head$.classList.add("compact"); });
  box.addEventListener("blur", () => setTimeout(() => { if (!box.value.trim()) head$.classList.remove("compact"); }, 150));
  if (c.query) run();
  else if (matchMedia("(pointer: fine)").matches) box.focus();
  let lists = null;
  const showList = () => {
    const items = (lists && lists[c.tab]) || [];
    const empty = { recent: "Noch nichts eingetragen.", favorites: "Noch keine Favoriten.", recipes: "Noch keine Rezepte.",
      templates: "Noch keine gespeicherten Mahlzeiten. In „Heute“ bei einer Mahlzeit „Als Mahlzeit speichern“ tippen." }[c.tab];
    $("#a-list").innerHTML = items.length ? items.map((f) => (c.tab === "templates" ? tplRow(f) : foodRow(f, "data-pick"))).join("") : `<div class="empty-state">${empty}</div>`;
    $$("[data-atab]", sheet).forEach((b) => b.classList.toggle("on", b.dataset.atab === c.tab));
  };
  $$("[data-atab]", sheet).forEach((b) => (b.onclick = () => { c.tab = b.dataset.atab; showList(); }));
  const found = {};
  sheet.onclick = async (e) => {
    const tpl = e.target.closest("[data-tpl]");
    if (tpl) { const t = (lists?.templates || []).find((x) => String(x.id) === tpl.dataset.tpl); if (t) openTemplate(t, { ctx: c }); return; }
    const row = e.target.closest("[data-pick]");
    if (!row) return;
    const ref = row.dataset.pick;
    try {
      const f = found[ref] || (await api(`/api/food/${encodeURIComponent(ref)}`));
      renderAmount(f, { ctx: c });
    } catch (err) { fail(err); }
  };
  try {
    const [l, t] = await Promise.all([api("/api/lists"), api("/api/templates")]);
    lists = { ...l, templates: t.templates };
    for (const k of ["recent", "favorites", "recipes"]) for (const f of lists[k]) found[f.ref] ||= f;
    if ($("#a-list")) showList();
  } catch (err) { if ($("#a-list")) $("#a-list").innerHTML = `<div class="empty-state">${esc(err.message)}</div>`; }
}

/** Menge waehlen (neuer Eintrag) oder Eintrag bearbeiten. */
function renderAmount(food, { ctx = null, entry = null } = {}) {
  sheet.onclick = null;
  const edit = !!entry;
  const baseUnit = food.liquid ? "ml" : "g";
  const units = [[baseUnit, baseUnit, 1]];
  if (food.piece) units.push(["piece", `Stück · ${n0(food.piece.g)} g`, food.piece.g, food.piece.label]);
  if (food.serving) {
    const lbl = food.serving.label || "Portion";
    // OFF-Labels enthalten oft schon die Grammzahl ("30 g", "1 Riegel (40 g)")
    units.push(["serving", /\d/.test(lbl) ? `Portion ${esc(lbl)}` : `${esc(lbl)} · ${n0(food.serving.g)} g`, food.serving.g, "Portion"]);
  }
  const sensibleServing = food.serving && food.serving.g <= 300;
  let unit, amount;
  if (entry) { unit = entry.unit === "ml" || entry.unit === "g" ? baseUnit : entry.unit; amount = entry.amount; }
  else if (food.last && units.some((u) => u[0] === food.last.unit || (["g", "ml"].includes(food.last.unit) && u[0] === baseUnit))) {
    unit = ["g", "ml"].includes(food.last.unit) ? baseUnit : food.last.unit; amount = food.last.amount;
  } else if (food.piece) { unit = "piece"; amount = 1; }
  else if (sensibleServing) { unit = "serving"; amount = 1; }
  else { unit = baseUnit; amount = 100; }
  const factor = () => units.find((u) => u[0] === unit)?.[2] || 1;
  const meal = entry ? entry.meal : ctx?.meal || "snack";
  const day = entry ? entry.day : ctx?.day || todayIso();
  const img = food.image ? `<img src="${esc(food.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ic food" style="width:48px;height:48px;border-radius:14px;display:grid;place-items:center">${foodIcon(food.kind)}</span>`;
  const p = food.per100;
  sheet.innerHTML = `${sheetTop(edit ? "Eintrag bearbeiten" : "Menge", { back: !edit && !!ctx,
      extra: `<button class="icon-btn sm glass star ${food.favorite ? "on" : ""}" id="fav" aria-label="Favorit" aria-pressed="${!!food.favorite}">${icon("star", 2)}</button>` })}
    <div class="food-head">${img}<div style="min-width:0"><div class="ttl">${esc(food.name)}</div>
      <div class="small muted">${esc([food.brand, KIND_LABEL[food.kind], `${n0(p.kcal)} kcal / 100 ${baseUnit}`].filter(Boolean).join(" · "))} ${nutriscore(food.nutriscore)}</div></div></div>
    <div class="amount-row"><input class="field" id="amt" inputmode="decimal" enterkeyhint="done" value="${inputVal(amount)}" aria-label="Menge"><span class="unit-lbl" id="unit-lbl"></span></div>
    <div class="units">${units.length > 1 ? units.map((u) => `<button class="chip-btn" data-unit="${u[0]}">${u[1]}</button>`).join("") : ""}</div>
    <div class="chips" id="quick" style="margin-top:8px"></div>
    <div class="preview" id="pv"></div>
    <div class="preview sub" id="pv2"></div>
    <div class="form"><div class="form-grid">
      <label>Mahlzeit<select class="field" id="meal">${MEALS.map(([k, l]) => `<option value="${k}" ${k === meal ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Uhrzeit<input class="field" type="time" id="time" value="${esc(entry?.time || nowTime())}"></label>
      ${edit ? `<label style="grid-column:1/-1">Tag<input class="field" type="date" id="day" value="${esc(day)}"></label>` : ""}
    </div></div>
    <div class="btn-row">${edit ? `<button class="secondary danger" id="del">Löschen</button>` : ""}<button class="primary" id="save">${edit ? "Speichern" : "Hinzufügen"}</button></div>
    ${edit && entry.day !== todayIso() ? `<div style="text-align:center;margin-top:10px"><button class="muted-btn" id="again">Heute noch einmal eintragen</button></div>` : ""}`;

  imgFallback(food);
  const amtEl = $("#amt");
  const update = () => {
    const a = num(amtEl.value) || 0;
    const g = a * factor();
    const u = units.find((x) => x[0] === unit);
    $("#unit-lbl").textContent = unit === baseUnit ? baseUnit : unit === "piece" ? (u[3] || "Stück") : "Portion";
    $$("[data-unit]", sheet).forEach((b) => b.classList.toggle("on", b.dataset.unit === unit));
    const v = (k) => (p[k] == null ? null : (p[k] * g) / 100);
    $("#pv").innerHTML = `<div><div class="l">kcal</div><div class="v">${n0(v("kcal"))}</div></div>
      ${MACROS.map(([k, l, c]) => `<div><div class="l"><i style="background:var(${c})"></i>${k === "carbs" ? "KH" : l}</div><div class="v">${gram(v(k))}<span class="unit">g</span></div></div>`).join("")}`;
    $("#pv2").innerHTML = `<div><div class="l">Zucker</div><div class="v">${gram(v("sugar"))} g</div></div>
      <div><div class="l">Ballaststoffe</div><div class="v">${gram(v("fiber"))} g</div></div>
      <div><div class="l">Salz</div><div class="v">${n1(v("salt"))} g</div></div>`;
    const presets = unit === baseUnit ? [50, 100, 150, 200, 250] : [0.5, 1, 2, 3];
    $("#quick").innerHTML = presets.map((x) => `<button class="chip-btn ${x === a ? "on" : ""}" data-q="${x}">${amt(x)}${unit === baseUnit ? ` ${baseUnit}` : ""}</button>`).join("");
    $("#save").disabled = !(a > 0);
  };
  update();
  amtEl.addEventListener("input", update);
  amtEl.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#save").click(); });
  amtEl.addEventListener("focus", () => amtEl.select());
  $$("[data-unit]", sheet).forEach((b) => (b.onclick = () => {
    const g = (num(amtEl.value) || 0) * factor();
    unit = b.dataset.unit;
    const f = factor();
    amtEl.value = inputVal(unit === baseUnit ? Math.round(g) || 100 : Math.max(0.5, Math.round((g / f) * 2) / 2) || 1);
    update();
  }));
  $("#quick").onclick = (e) => { const q = e.target.closest("[data-q]"); if (q) { amtEl.value = inputVal(Number(q.dataset.q)); update(); } };
  $("#fav").onclick = async () => {
    food.favorite = !food.favorite;
    $("#fav").classList.toggle("on", food.favorite);
    $("#fav").setAttribute("aria-pressed", String(food.favorite));
    try { await post("/api/favorite", { ref: food.ref, on: food.favorite }); toast(food.favorite ? "Als Favorit gemerkt" : "Favorit entfernt"); } catch (e) { fail(e); }
  };
  if ($("[data-back]", sheet)) $("[data-back]", sheet).onclick = () => (ctx?.browse ? closeSheet() : renderAddHome());
  $("#save").onclick = async () => {
    const body = { amount: num(amtEl.value), unit, meal: $("#meal").value, time: $("#time").value };
    try {
      if (edit) {
        const newDay = $("#day").value || entry.day;
        await patch(`/api/entries/${entry.id}`, { ...body, day: newDay });
        closeSheet();
        const old = { amount: entry.amount, unit: entry.unit, meal: entry.meal, time: entry.time, day: entry.day };
        toast(newDay !== entry.day ? `Verschoben auf ${fmtDay(newDay)}` : "Gespeichert", () => patch(`/api/entries/${entry.id}`, old));
      } else {
        const r = await post("/api/entries", { ...body, ref: food.ref, day });
        const kcal = p.kcal == null ? 0 : (p.kcal * body.amount * factor()) / 100;
        if (ctx && !ctx.browse) {
          // Im Sheet bleiben: meist folgt direkt das naechste Lebensmittel
          if (body.meal !== ctx.meal) ctx.meal = body.meal;
          toast(`${food.name} hinzugefügt`);
          noteAdded(ctx, { ids: [r.id], label: `${food.name} · ${$("#amt").value} ${$("#unit-lbl").textContent}`, kcal });
          return;
        }
        closeSheet();
        toast(`${food.name} eingetragen`, () => del(`/api/entries/${r.id}`));
        if (currentTab() !== "heute" || currentDay !== day) { location.hash = day === todayIso() ? "#/heute" : `#/heute/${day}`; return; }
      }
      refresh();
    } catch (e) { fail(e); }
  };
  if (edit) {
    $("#del").onclick = () => deleteEntry(entry);
    if ($("#again")) $("#again").onclick = async () => {
      try {
        const r = await post("/api/entries/copy", { ids: [entry.id], day: todayIso() });
        closeSheet(); toast("Für heute eingetragen"); location.hash = "#/heute"; void r;
      } catch (e) { fail(e); }
    };
  }
  if (!edit && matchMedia("(pointer: fine)").matches) amtEl.focus();
}

async function deleteEntry(entry) {
  try {
    await del(`/api/entries/${entry.id}`);
    closeSheet();
    toast(`${entry.name} gelöscht`, () => post(`/api/entries/${entry.id}/restore`));
    refresh();
  } catch (e) { fail(e); }
}

/** Schnelleintrag: nur kcal, Makros optional. Auch zum Bearbeiten. */
function renderQuick({ ctx = null, entry = null } = {}) {
  sheet.onclick = null;
  const edit = !!entry;
  const meal = entry ? entry.meal : ctx?.meal || "snack";
  sheet.innerHTML = `${sheetTop(edit ? "Schnelleintrag bearbeiten" : "Nur kcal", { back: !edit })}
    <div class="form">
      <label>Kalorien<input class="field" id="q-kcal" inputmode="numeric" placeholder="kcal" value="${inputVal(entry?.kcal)}"></label>
      <label>Bezeichnung (optional)<input class="field" id="q-name" maxlength="80" placeholder="z. B. Kantine" value="${esc(entry && entry.name !== "Schnelleintrag" ? entry.name : "")}" ${edit ? "disabled" : ""}></label>
      <div class="form-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        ${MACROS.map(([k, l]) => `<label>${k === "carbs" ? "KH" : l} (g)<input class="field" id="q-${k}" inputmode="decimal" value="${inputVal(entry?.[k])}"></label>`).join("")}
      </div>
      <div class="form-grid">
        <label>Mahlzeit<select class="field" id="q-meal">${MEALS.map(([k, l]) => `<option value="${k}" ${k === meal ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Uhrzeit<input class="field" type="time" id="q-time" value="${esc(entry?.time || nowTime())}"></label>
      </div>
    </div>
    <div class="btn-row">${edit ? `<button class="secondary danger" id="del">Löschen</button>` : ""}<button class="primary" id="save">${edit ? "Speichern" : "Hinzufügen"}</button></div>`;
  if ($("[data-back]", sheet)) $("[data-back]", sheet).onclick = renderAddHome;
  const kcalEl = $("#q-kcal");
  if (matchMedia("(pointer: fine)").matches) kcalEl.focus();
  $("#save").onclick = async () => {
    const kcal = num(kcalEl.value);
    if (!kcal || kcal <= 0) { kcalEl.focus(); return; }
    const macros = Object.fromEntries(MACROS.map(([k]) => [k, num($(`#q-${k}`).value)]));
    try {
      if (edit) {
        await patch(`/api/entries/${entry.id}`, { amount: kcal, ...macros, meal: $("#q-meal").value, time: $("#q-time").value });
        closeSheet(); toast("Gespeichert");
      } else {
        const r = await post("/api/entries", { unit: "kcal", amount: kcal, name: $("#q-name").value, ...macros, meal: $("#q-meal").value, time: $("#q-time").value, day: ctx.day });
        toast(`${n0(kcal)} kcal hinzugefügt`);
        noteAdded(ctx, { ids: [r.id], label: `${$("#q-name").value.trim() || "Schnelleintrag"} · ${n0(kcal)} kcal`, kcal });
        return;
      }
      refresh();
    } catch (e) { fail(e); }
  };
  if (edit) $("#del").onclick = () => deleteEntry(entry);
}

async function openEntry(id) {
  const all = dayData ? Object.values(dayData.meals).flat() : [];
  const entry = all.find((e) => e.id === id);
  if (!entry) return;
  openSheet(`<div class="grab"></div><div class="skeleton"></div>`);
  if (entry.unit === "kcal") { renderQuick({ entry }); return; }
  let food = null;
  try { food = await api(`/api/food/${encodeURIComponent(entry.ref)}`); } catch { /* Lebensmittel geloescht */ }
  if (!food) {
    // Naehrwerte aus dem Eintrag zurueckrechnen, damit er trotzdem bearbeitbar bleibt
    const per100 = {};
    for (const k of ["kcal", "protein", "carbs", "sugar", "fat", "satfat", "fiber", "salt"]) per100[k] = entry.grams && entry[k] != null ? (entry[k] / entry.grams) * 100 : null;
    food = { ref: entry.ref, kind: kindOf(entry.ref), name: entry.name, brand: entry.brand, per100, liquid: entry.unit === "ml",
      piece: entry.unit === "piece" ? { g: entry.grams / entry.amount, label: "Stück" } : null,
      serving: entry.unit === "serving" ? { g: entry.grams / entry.amount, label: "Portion" } : null };
  }
  renderAmount(food, { entry });
}

// --- Barcode-Scanner -----------------------------------------------------------------------
// iOS Safari hat keinen BarcodeDetector -> zxing-wasm (lokal in web/vendor). Kamera braucht HTTPS.

let scanStream = null, scanTimer = null, zxingReady = null;
function loadZXing() {
  if (zxingReady) return zxingReady;
  zxingReady = new Promise((ok, err) => {
    const s = document.createElement("script");
    s.src = "/vendor/zxing-reader.js";
    s.onload = () => {
      window.ZXingWASM.prepareZXingModule({
        overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? "/vendor/zxing_reader.wasm" : prefix + path) },
      });
      ok(window.ZXingWASM);
    };
    s.onerror = () => { zxingReady = null; err(new Error("Scanner konnte nicht geladen werden")); };
    document.head.append(s);
  });
  return zxingReady;
}

function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
}

async function renderScan(ctx) {
  sheet.onclick = null;
  sheet.innerHTML = `${sheetTop("Barcode scannen", { back: !ctx.browse || !!ctx.fillForm })}
    <div class="scanner" id="scanner"><video id="cam" playsinline muted autoplay></video><div class="frame"></div></div>
    <div class="scan-status" id="scan-status">Kamera wird gestartet …</div>
    <form class="amount-row" id="code-form" style="margin-top:8px"><input class="field" id="code" inputmode="numeric" pattern="[0-9]*" placeholder="Barcode eintippen" style="font-size:17px;text-align:left" autocomplete="off"><button class="secondary" type="submit">Suchen</button></form>
    <div id="scan-result"></div>`;
  if ($("[data-back]", sheet)) $("[data-back]", sheet).onclick = () => { stopScan(); if (ctx.fillForm) ctx.fillForm(""); else renderAddHome(); };
  const status = $("#scan-status");
  $("#code-form").onsubmit = (e) => {
    e.preventDefault();
    const c = $("#code").value.replace(/\D/g, "");
    if (c.length < 6) return;
    stopScan();
    if (ctx.fillForm) ctx.fillForm(c); else lookupBarcode(c, ctx);
  };
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $("#scanner").hidden = true;
    status.textContent = "Die Kamera ist nur über HTTPS verfügbar. Barcode bitte eintippen.";
    return;
  }
  let detect;
  try {
    if ("BarcodeDetector" in window) {
      const bd = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      detect = async (canvas) => (await bd.detect(canvas))[0]?.rawValue;
    } else {
      const zx = await loadZXing();
      detect = async (canvas) => {
        const ctx2 = canvas.getContext("2d", { willReadFrequently: true });
        const res = await zx.readBarcodes(ctx2.getImageData(0, 0, canvas.width, canvas.height),
          { formats: ["EAN13", "EAN8", "UPCA", "UPCE"], tryHarder: true, maxNumberOfSymbols: 1 });
        return res.find((r) => r.isValid)?.text;
      };
    }
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    $("#scanner").hidden = true;
    status.textContent = e.name === "NotAllowedError" ? "Kein Kamerazugriff erlaubt. Barcode bitte eintippen." : `Kamera nicht verfügbar (${e.message}). Barcode bitte eintippen.`;
    return;
  }
  if (!sheet.classList.contains("on") || !$("#cam")) { stopScan(); return; }
  const video = $("#cam");
  video.srcObject = scanStream;
  await video.play().catch(() => {});
  status.textContent = "Barcode in den Rahmen halten";
  const canvas = document.createElement("canvas");
  let busy = false;
  scanTimer = setInterval(async () => {
    if (busy || !video.videoWidth) return;
    busy = true;
    try {
      // Mittleren Streifen auswerten (dort ist der Rahmen) - schneller und genauer
      const vw = video.videoWidth, vh = video.videoHeight;
      const sw = vw * 0.8, sh = vh * 0.45;
      canvas.width = Math.min(960, sw); canvas.height = (canvas.width / sw) * sh;
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
      const code = await detect(canvas);
      if (code && scanTimer) {
        stopScan();
        navigator.vibrate?.(40);
        if (ctx.fillForm) ctx.fillForm(code); else lookupBarcode(code, ctx);
      }
    } catch { /* naechster Frame */ }
    busy = false;
  }, 220);
}

async function lookupBarcode(code, ctx) {
  const status = $("#scan-status"), out = $("#scan-result");
  if ($("#scanner")) $("#scanner").hidden = true;
  if (status) status.textContent = `${code} – suche …`;
  try {
    const r = await api(`/api/barcode/${encodeURIComponent(code)}`);
    if (r.status === "ok") {
      if (ctx.browse) { openFoodDetail(r.food.ref, r.food); return; }
      renderAmount(r.food, { ctx });
      if (r.live) toast("Von Open Food Facts geladen und lokal gespeichert");
      return;
    }
    const msg = {
      unknown: "Dieses Produkt ist noch nicht erfasst – weder lokal noch bei Open Food Facts.",
      rate_limited: "Open Food Facts begrenzt die Abfragen. Bitte in einer Minute erneut versuchen.",
      offline: "Open Food Facts ist gerade nicht erreichbar.",
      invalid: "Ungültiger Barcode.",
    }[r.status] || "Nicht gefunden.";
    if (status) status.textContent = `${code}`;
    out.innerHTML = `<div class="empty-state" style="padding-bottom:10px">${esc(msg)}</div>
      <button class="primary" id="scan-create" type="button">Neues Produkt hinzufügen</button>
      <div style="text-align:center;margin-top:8px"><button class="muted-btn" id="scan-again">Erneut scannen</button></div>`;
    $("#scan-create").onclick = () => openProductForm({ code: r.code || code }, { ctx: ctx.browse ? null : ctx });
    $("#scan-again").onclick = () => renderScan(ctx);
  } catch (e) {
    if (out) out.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}

// --- Lebensmittel-Detail, eigene Lebensmittel, Rezepte --------------------------------------

async function openFoodDetail(ref, preloaded = null) {
  if (!sheet.classList.contains("on")) openSheet(`<div class="grab"></div><div class="skeleton"></div>`);
  sheet.onclick = null;
  let f;
  try { f = preloaded || (await api(`/api/food/${encodeURIComponent(ref)}`)); } catch (e) { sheet.innerHTML = `${sheetTop("Lebensmittel")}<div class="empty-state">${esc(e.message)}</div>`; return; }
  const p = f.per100, u = f.liquid ? "ml" : "g";
  const row = (l, v, unit = "g", sub = false) => `<tr><td>${sub ? `<span class="muted">davon</span> ${esc(l)}` : esc(l)}</td><td>${v == null ? "–" : unit === "kcal" ? n0(v) : n1(v)} ${unit}</td></tr>`;
  const own = f.ref.startsWith("own:") || f.ref.startsWith("cap:");
  const correctable = f.ref.startsWith("off:");
  const img = f.image ? `<img src="${esc(f.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ic food" style="width:48px;height:48px;border-radius:14px;display:grid;place-items:center">${foodIcon(f.kind)}</span>`;
  sheet.innerHTML = `${sheetTop("Lebensmittel", { extra: `<button class="icon-btn sm glass star ${f.favorite ? "on" : ""}" id="fav" aria-label="Favorit">${icon("star", 2)}</button>` })}
    <div class="food-head">${img}<div style="min-width:0"><div class="ttl">${esc(f.name)}</div>
      <div class="small muted">${esc([f.brand, KIND_LABEL[f.kind], f.quantity, f.code].filter(Boolean).join(" · "))} ${nutriscore(f.nutriscore)}</div></div></div>
    <div class="section" style="margin-top:0"><h3>Nährwerte pro 100 ${u}</h3><div class="table-wrap"><table class="t"><tbody>
      ${row("Energie", p.kcal, "kcal")}${row("Eiweiß", p.protein)}${row("Kohlenhydrate", p.carbs)}${row("Zucker", p.sugar, "g", true)}
      ${row("Fett", p.fat)}${row("gesättigte Fettsäuren", p.satfat, "g", true)}${row("Ballaststoffe", p.fiber)}${row("Salz", p.salt)}
    </tbody></table></div></div>
    ${f.piece || f.serving ? `<div class="section"><h3>Portionen</h3><div class="small ink2">${[f.piece ? `1 ${esc(f.piece.label)} = ${n0(f.piece.g)} g (${n0((p.kcal * f.piece.g) / 100)} kcal)` : "", f.serving ? `1 ${esc(f.serving.label)} = ${n1(f.serving.g)} g (${n0((p.kcal * f.serving.g) / 100)} kcal)` : ""].filter(Boolean).join("<br>")}</div></div>` : ""}
    ${f.items ? `<div class="section"><h3>Zutaten · ${n0(f.totalG)} g gesamt</h3><div class="small ink2">${f.items.map((i) => `${esc(i.name)} · ${n0(i.grams)} g`).join("<br>")}</div></div>` : ""}
    <div class="tiny muted" style="margin-top:14px">${f.kind === "bls" ? "Quelle: BLS 4.0, Max Rubner-Institut, CC BY 4.0"
      : f.ref.startsWith("off:") ? "Quelle: Open Food Facts, ODbL"
      : f.kind === "off" ? "Quelle: Open Food Facts (per Barcode geladen, lokal gespeichert)"
      : f.kind === "cap" ? `Eigenes Produkt${f.overridesOff ? " · ersetzt den Eintrag aus Open Food Facts" : ""}` : ""}</div>
    <div class="btn-row">${own ? `<button class="secondary" id="edit">Bearbeiten</button><button class="secondary danger" id="rm">Löschen</button>` : ""}
      ${correctable ? `<button class="secondary" id="fix">Werte korrigieren</button>` : ""}<button class="primary" id="use">Eintragen</button></div>`;
  imgFallback(f);
  $("#fav").onclick = async () => {
    f.favorite = !f.favorite; $("#fav").classList.toggle("on", f.favorite);
    try { await post("/api/favorite", { ref: f.ref, on: f.favorite }); toast(f.favorite ? "Als Favorit gemerkt" : "Favorit entfernt"); if (currentTab() === "mahlzeiten") refresh(); } catch (e) { fail(e); }
  };
  $("#use").onclick = () => {
    const d = todayIso();
    addCtx = { meal: dayData && currentDay === d ? dayData.defaultMeal : defaultMealNow(), day: d, tab: "recent", query: "", browse: true };
    renderAmount(f, { ctx: addCtx });
  };
  if (correctable) $("#fix").onclick = () => openProductForm({ ...f, ref: null }, { correct: true });
  if (own) {
    const ref = encodeURIComponent(f.ref);
    $("#edit").onclick = () => (f.kind === "recipe" ? openRecipeForm(f) : openProductForm(f));
    $("#rm").onclick = async () => {
      try {
        await del(`/api/food/${ref}`); closeSheet();
        toast(`${f.name} gelöscht`, () => post(`/api/food/${ref}/restore`)); refresh();
      } catch (e) { fail(e); }
    };
  }
}

/** Produktbilder kommen von OFF; faellt eins aus, das Quell-Icon zeigen. */
function imgFallback(food) {
  const img = $(".food-head img", sheet);
  if (!img) return;
  img.addEventListener("error", () => {
    img.outerHTML = `<span class="ic food" style="width:48px;height:48px;border-radius:14px;display:grid;place-items:center">${foodIcon(food.kind)}</span>`;
  }, { once: true });
}

function defaultMealNow() {
  const h = new Date().getHours();
  return h >= 4 && h < 11 ? "breakfast" : h >= 11 && h < 15 ? "lunch" : h >= 17 && h < 22 ? "dinner" : "snack";
}

/**
 * Neues Produkt erfassen oder ein eigenes Produkt bearbeiten (captured.db).
 * Aufbau wie die Naehrwerttabelle auf der Verpackung. `correct` = Werte eines
 * OFF-Produkts korrigieren: gleicher Barcode, der eigene Eintrag hat danach Vorrang.
 */
function openProductForm(food = {}, { ctx = null, correct = false } = {}) {
  if (!sheet.classList.contains("on")) openSheet("");
  sheet.onclick = null;
  const editing = !!food.ref && food.ref.startsWith("cap:");
  const p = food.per100 || {};
  const fld = (id, label, v, attrs = 'inputmode="decimal"') => `<label>${label}<input class="field" id="pf-${id}" ${attrs} value="${esc(v ?? "")}"></label>`;
  const title = editing ? "Produkt bearbeiten" : correct ? "Werte korrigieren" : "Neues Produkt";
  sheet.innerHTML = `${sheetTop(title, { back: !!ctx })}
    <form class="form" id="pf" novalidate>
      ${correct ? `<p class="hint">Die korrigierten Werte werden als eigenes Produkt mit demselben Barcode gespeichert und haben ab jetzt Vorrang vor Open Food Facts.</p>` : ""}
      ${fld("name", "Bezeichnung", food.name, 'maxlength="160" autocomplete="off"')}
      <div class="form-grid">${fld("brand", "Marke", food.brand, 'maxlength="80" autocomplete="off" placeholder="optional"')}
        <label>Barcode<div class="amount-row" style="grid-template-columns:minmax(0,1fr) auto;gap:6px"><input class="field" id="pf-code" inputmode="numeric" autocomplete="off" placeholder="optional" value="${esc(food.code || "")}" ${correct ? "readonly" : ""}>
          ${correct ? "" : `<button class="icon-btn sm flat" type="button" id="pf-scan" aria-label="Barcode scannen">${icon("barcode", 2)}</button>`}</div></label></div>
      <div class="form-grid">${fld("quantity", "Packungsgröße", food.quantity, 'maxlength="40" placeholder="z. B. 500 g"')}
        <label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="pf-liquid" ${food.liquid ? "checked" : ""}>Getränk / flüssig (ml)</label></div>
      <h3 id="pf-per">Nährwerte pro 100 ${food.liquid ? "ml" : "g"}</h3>
      <div class="form-grid">${fld("kj", "Energie (kJ)", inputVal(p.kcal != null ? p.kcal * 4.184 : null))}${fld("kcal", "Energie (kcal)", inputVal(p.kcal))}</div>
      <div class="form-grid">${fld("fat", "Fett (g)", inputVal(p.fat))}${fld("satfat", "davon gesättigte Fettsäuren (g)", inputVal(p.satfat))}
        ${fld("carbs", "Kohlenhydrate (g)", inputVal(p.carbs))}${fld("sugar", "davon Zucker (g)", inputVal(p.sugar))}
        ${fld("fiber", "Ballaststoffe (g)", inputVal(p.fiber))}${fld("protein", "Eiweiß (g)", inputVal(p.protein))}
        ${fld("salt", "Salz (g)", inputVal(p.salt))}</div>
      <div id="pf-check"></div>
      <h3>Portion und Stück (optional)</h3>
      <div class="form-grid four">
        ${fld("serving_g", "Portion (g)", inputVal(food.serving?.g))}${fld("serving_label", "Bezeichnung", food.serving?.label, 'maxlength="40" placeholder="z. B. 1 Riegel"')}
        ${fld("piece_g", "Stück (g)", inputVal(food.piece?.g))}${fld("piece_label", "Bezeichnung", food.piece?.label, 'maxlength="40" placeholder="z. B. Scheibe"')}
      </div>
      <p class="err small" id="pf-err"></p>
    </form>
    <div class="btn-row"><button class="primary" id="pf-save">${editing || correct ? "Speichern" : "Produkt anlegen"}</button></div>`;
  if ($("[data-back]", sheet)) $("[data-back]", sheet).onclick = renderAddHome;
  const $f = (id) => $(`#pf-${id}`);
  const v = (id) => num($f(id).value);
  if (!food.name && matchMedia("(pointer: fine)").matches) $f("name").focus();

  // kJ und kcal gegenseitig ausfuellen, solange das andere Feld nicht selbst getippt wurde
  let typed = { kj: !!food.per100, kcal: !!food.per100 };
  $f("kj").addEventListener("input", () => { typed.kj = true; if (!typed.kcal || !$f("kcal").value) { const k = v("kj"); $f("kcal").value = k == null ? "" : inputVal(Math.round(k / 4.184)); typed.kcal = false; } check(); });
  $f("kcal").addEventListener("input", () => { typed.kcal = true; if (!typed.kj || !$f("kj").value) { const k = v("kcal"); $f("kj").value = k == null ? "" : inputVal(Math.round(k * 4.184)); typed.kj = false; } check(); });
  $f("liquid").addEventListener("change", () => { $("#pf-per").textContent = `Nährwerte pro 100 ${$f("liquid").checked ? "ml" : "g"}`; });

  // Plausibilitaet wie beim Aufbau von off.db: kcal ~ 4*E + 4*KH + 9*F + 2*Ballaststoffe
  const check = () => {
    const kcal = v("kcal"), f = v("fat"), c = v("carbs"), pr = v("protein");
    const errs = [];
    if (v("satfat") != null && f != null && v("satfat") > f) errs.push("Gesättigte Fettsäuren sind mehr als Fett gesamt.");
    if (v("sugar") != null && c != null && v("sugar") > c) errs.push("Zucker ist mehr als Kohlenhydrate gesamt.");
    if ((f || 0) + (c || 0) + (pr || 0) + (v("fiber") || 0) > 101) errs.push("Die Nährwerte ergeben zusammen mehr als 100 g.");
    let warn = "";
    if (kcal != null && (f != null || c != null || pr != null)) {
      const calc = 4 * (pr || 0) + 4 * (c || 0) + 9 * (f || 0) + 2 * (v("fiber") || 0);
      if (calc > 20 && Math.abs(kcal - calc) / calc > 0.25) warn = `Die kcal passen nicht zu den Makros (erwartet etwa ${n0(calc)} kcal). Bitte mit der Packung vergleichen. Oft ist kJ statt kcal eingetragen.`;
    }
    $("#pf-check").innerHTML = errs.length ? `<p class="small">${statusBadge("critical", "Fehler")} ${esc(errs.join(" "))}</p>`
      : warn ? `<p class="small">${statusBadge("warn", "Prüfen")} ${esc(warn)}</p>` : "";
    return errs;
  };
  $("#pf").addEventListener("input", check);
  check();

  if ($f("scan")) $f("scan").onclick = () => {
    const draft = collect();
    renderScan({ ...(ctx || {}), browse: !ctx, fillForm: (code) => openProductForm({ ...food, ...draft, code, per100: draft.per100 }, { ctx }) });
  };
  const collect = () => ({
    name: $f("name").value, brand: $f("brand").value, code: $f("code").value, quantity: $f("quantity").value,
    liquid: $f("liquid").checked,
    per100: Object.fromEntries(["kcal", "protein", "carbs", "sugar", "fat", "satfat", "fiber", "salt"].map((k) => [k, v(k)])),
    serving_g: v("serving_g"), serving_label: $f("serving_label").value || "Portion",
    piece_g: v("piece_g"), piece_label: $f("piece_label").value || "Stück",
    image: food.image, nutriscore: food.nutriscore,
  });
  $("#pf").onsubmit = (e) => { e.preventDefault(); $("#pf-save").click(); };
  $("#pf-save").onclick = async () => {
    const body = collect();
    if (!body.name.trim()) { $("#pf-err").textContent = "Bitte eine Bezeichnung eingeben."; $f("name").focus(); return; }
    if (body.per100.kcal == null) { $("#pf-err").textContent = "Bitte Energie in kcal oder kJ eingeben."; $f("kcal").focus(); return; }
    if (check().length) { $("#pf-err").textContent = "Bitte die markierten Werte prüfen."; return; }
    try {
      const r = editing ? await put(`/api/product/${food.ref.split(":")[1]}`, body) : await post("/api/product", body);
      const f = await api(`/api/food/${encodeURIComponent(r.ref)}`);
      toast(editing ? "Produkt gespeichert" : correct ? "Korrektur gespeichert" : "Produkt angelegt");
      if (ctx) { renderAmount(f, { ctx }); return; }
      openFoodDetail(f.ref, f);
      if (currentTab() === "mahlzeiten") refresh();
    } catch (e) { $("#pf-err").textContent = e.message; }
  };
}

async function openRecipeForm(recipe = null) {
  if (!sheet.classList.contains("on")) openSheet("");
  sheet.onclick = null;
  const items = [];
  if (recipe?.items) {
    for (const it of recipe.items) {
      try { const f = await api(`/api/food/${encodeURIComponent(it.ref)}`); items.push({ ref: it.ref, name: it.name, grams: it.grams, per100: f.per100 }); }
      catch { /* Zutat nicht mehr vorhanden */ }
    }
  }
  sheet.innerHTML = `${sheetTop(recipe ? "Rezept bearbeiten" : "Neues Rezept")}
    <div class="form">
      <label>Name<input class="field" id="r-name" maxlength="160" value="${esc(recipe?.name || "")}" placeholder="z. B. Overnight Oats"></label>
      <h3>Zutaten</h3>
      <div class="list" id="r-items"></div>
      <div class="searchbox">${icon("search")}<input class="field" id="r-q" type="search" placeholder="Zutat suchen und hinzufügen" autocomplete="off"></div>
      <div id="r-results"></div>
      <div class="form-grid">
        <label>Gewicht nach dem Kochen (g)<input class="field" id="r-total" inputmode="decimal" value="${inputVal(recipe?.totalG)}" placeholder="Summe der Zutaten"></label>
        <label>Portionen<input class="field" id="r-portions" inputmode="decimal" value="${inputVal(recipe?.portions)}" placeholder="optional"></label>
      </div>
      <p class="hint">Die Nährwerte pro 100 g ergeben sich aus der Summe der Zutaten geteilt durch das Gesamtgewicht. Wasser, das beim Kochen verdampft oder aufgenommen wird, wird über das Gewicht nach dem Kochen berücksichtigt.</p>
      <div class="preview" id="r-pv"></div>
      <p class="err small" id="r-err"></p>
    </div>
    <div class="btn-row"><button class="primary" id="r-save">${recipe ? "Speichern" : "Rezept anlegen"}</button></div>`;
  const draw = () => {
    $("#r-items").innerHTML = items.length ? items.map((it, i) => `<div class="ing"><span class="ttl">${esc(it.name)}</span>
      <input class="field" data-g="${i}" inputmode="decimal" value="${inputVal(it.grams)}" aria-label="Gramm"><button class="icon-btn sm flat" data-rm="${i}" aria-label="Entfernen">${icon("x", 2)}</button></div>`).join("")
      : '<div class="small muted">Noch keine Zutaten.</div>';
    calc();
  };
  const calc = () => {
    const raw = items.reduce((a, it) => a + (it.grams || 0), 0);
    const total = num($("#r-total").value) || raw;
    const portions = num($("#r-portions").value);
    const sum = (k) => items.reduce((a, it) => a + ((it.per100[k] || 0) * (it.grams || 0)) / 100, 0);
    const per = (k) => (total ? (sum(k) / total) * 100 : null);
    $("#r-pv").innerHTML = `<div><div class="l">kcal / 100 g</div><div class="v">${n0(per("kcal"))}</div></div>
      <div><div class="l">Gesamt</div><div class="v">${n0(sum("kcal"))}<span class="unit">kcal</span></div></div>
      <div><div class="l">Gewicht</div><div class="v">${n0(total)}<span class="unit">g</span></div></div>
      <div><div class="l">Portion</div><div class="v">${portions ? n0(sum("kcal") / portions) : "–"}<span class="unit">kcal</span></div></div>`;
  };
  draw();
  $("#r-items").addEventListener("input", (e) => { const i = e.target.dataset.g; if (i != null) { items[i].grams = num(e.target.value) || 0; calc(); } });
  $("#r-items").addEventListener("click", (e) => { const b = e.target.closest("[data-rm]"); if (b) { items.splice(Number(b.dataset.rm), 1); draw(); } });
  $("#r-total").addEventListener("input", calc);
  $("#r-portions").addEventListener("input", calc);
  const box = $("#r-q");
  liveSearch(box, $("#r-results"), (f) => foodRow(f, "data-ing"), null, { create: false });
  $("#r-results").addEventListener("click", async (e) => {
    const row = e.target.closest("[data-ing]");
    if (!row) return;
    try {
      const f = await api(`/api/food/${encodeURIComponent(row.dataset.ing)}`);
      items.push({ ref: f.ref, name: f.name, grams: f.piece?.g || (f.serving?.g <= 300 ? f.serving.g : null) || 100, per100: f.per100 });
      box.value = ""; $("#r-results").innerHTML = "";
      draw();
    } catch (err) { fail(err); }
  });
  $("#r-save").onclick = async () => {
    const body = { name: $("#r-name").value, items: items.map((i) => ({ ref: i.ref, grams: i.grams })), total_g: num($("#r-total").value), portions: num($("#r-portions").value) };
    try {
      if (recipe) await put(`/api/recipe/${recipe.ref.split(":")[1]}`, body); else await post("/api/recipe", body);
      closeSheet(); toast("Rezept gespeichert"); refresh();
    } catch (e) { $("#r-err").textContent = e.message; }
  };
}

// --- Einstellungen -----------------------------------------------------------------------

let settingsCache = null;
async function loadSettings() {
  try { settingsCache = await api("/api/settings"); } catch { /* spaeter erneut */ }
  return settingsCache;
}

async function openSettings() {
  openSheet(`<div class="grab"></div><div class="skeleton"></div>`);
  const s = await loadSettings();
  if (!s) { sheet.innerHTML = `${sheetTop("Einstellungen")}<div class="empty-state">Keine Verbindung</div>`; return; }
  const fld = (id, label, v, hint = "") => `<label>${label}<input class="field" id="s-${id}" inputmode="decimal" value="${inputVal(v)}" ${hint ? `placeholder="${esc(hint)}"` : ""}></label>`;
  sheet.innerHTML = `${sheetTop("Einstellungen")}
    <div class="form">
      <h3>Ziel</h3>
      <div class="segment glass">${[["lose", "Abnehmen"], ["maintain", "Halten"], ["gain", "Aufbauen"]].map(([k, l]) => `<button class="${k === s.goal ? "on" : ""}" data-goal="${k}">${l}</button>`).join("")}</div>
      <div class="form-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        ${fld("off-lose", "Abnehmen (kcal)", s.goalOffset.lose)}${fld("off-maintain", "Halten (kcal)", s.goalOffset.maintain)}${fld("off-gain", "Aufbauen (kcal)", s.goalOffset.gain)}
      </div>
      <p class="hint">Budget = Garmin-Verbrauch ± Ziel. Heute: Ruheumsatz (Ø der letzten 7 abgeschlossenen Tage) plus die bisherigen Aktivkalorien, das Budget wächst also nach dem Training. Ohne Garmin-Daten gilt das Ersatzbudget.</p>
      <h3>Makros</h3>
      <div class="form-grid">
        ${fld("weightKg", "Körpergewicht (kg)", s.weightKg, `${n1(s.effectiveWeightKg)} (Garmin-Profil)`)}
        ${fld("fallbackBudget", "Ersatzbudget (kcal)", s.fallbackBudget)}
        ${fld("proteinPerKg", "Eiweiß (g pro kg)", s.proteinPerKg)}${fld("fatPerKg", "Fett (g pro kg)", s.fatPerKg)}
      </div>
      <p class="hint">Kohlenhydrate = Rest des Budgets. An Trainingstagen wachsen sie automatisch mit.</p>
      <h3>Weitere Ziele</h3>
      <div class="form-grid four">
        ${fld("fiberGoal", "Ballaststoffe (g)", s.fiberGoal)}${fld("sugarMax", "Zucker max. (g)", s.sugarMax)}${fld("saltMax", "Salz max. (g)", s.saltMax)}${fld("waterGoalMl", "Wasser (ml)", s.waterGoalMl)}
      </div>
      <div class="form-grid">${fld("waterPerTrainingHour", "Wasser extra pro Trainingsstunde (ml)", s.waterPerTrainingHour)}
        <label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="s-evening" ${s.eveningHint !== false ? "checked" : ""}>Hinweis ab 17 Uhr</label></div>
      <p class="hint">Das Wasserziel wächst an Trainingstagen um diesen Wert pro Stunde (Trainingszeit aus Garmin, 0 = aus). Der Hinweis am Abend zeigt, was noch offen ist, und schlägt passende Favoriten, zuletzt Gegessenes und gespeicherte Mahlzeiten vor.</p>
      <p class="err small" id="s-err"></p>
    </div>
    <div class="btn-row"><button class="primary" id="s-save">Speichern</button></div>`;
  let goal = s.goal;
  $$("[data-goal]", sheet).forEach((b) => (b.onclick = () => { goal = b.dataset.goal; $$("[data-goal]", sheet).forEach((x) => x.classList.toggle("on", x === b)); }));
  $("#s-save").onclick = async () => {
    const v = (id) => $(`#s-${id}`).value;
    const body = { goal, goalOffset: { lose: num(v("off-lose")) ?? -300, maintain: num(v("off-maintain")) ?? 0, gain: num(v("off-gain")) ?? 250 } };
    for (const k of ["weightKg", "fallbackBudget", "proteinPerKg", "fatPerKg", "fiberGoal", "sugarMax", "saltMax", "waterGoalMl", "waterPerTrainingHour"]) body[k] = num(v(k));
    body.eveningHint = $("#s-evening").checked;
    try { settingsCache = await put("/api/settings", body); closeSheet(); toast("Einstellungen gespeichert"); refresh(); }
    catch (e) { $("#s-err").textContent = e.message; }
  };
}

// --- Globale Klicks ------------------------------------------------------------------------

document.addEventListener("click", (e) => {
  if (e.target.closest(".sheet")) return;
  const entry = e.target.closest("[data-entry]");
  if (entry) { openEntry(Number(entry.dataset.entry)); return; }
  const add = e.target.closest("[data-add-meal]");
  if (add) { openAdd({ meal: add.dataset.addMeal, day: currentDay }); return; }
  const food = e.target.closest("[data-food]");
  if (food) { openFoodDetail(food.dataset.food); return; }
  const tpl = e.target.closest("[data-tpl]");
  if (tpl) { api(`/api/templates/${tpl.dataset.tpl}`).then((t) => openTemplate(t)).catch(fail); return; }
  const day = e.target.closest("[data-day]");
  if (day) location.hash = day.dataset.day === todayIso() ? "#/heute" : `#/heute/${day.dataset.day}`;
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.target.matches?.("[data-entry],[data-food],[data-day],[data-pick],[data-ing],[data-tpl],[data-suggest]")) return;
  e.preventDefault(); e.target.click();
});
$("#add").addEventListener("click", () => openAdd({}));
$("#settings").addEventListener("click", openSettings);

// --- Router ------------------------------------------------------------------------------

function setHeader(title, sub, tabTitle = title) {
  $("#title").textContent = title;
  $("#subtitle").textContent = sub || "";
  document.title = `${tabTitle} · Kalorien`;
}
function render(html) {
  hideTip();
  const y = window.scrollY;
  const same = viewEl.dataset.route === location.hash;
  viewEl.innerHTML = `<div class="view${same ? " still" : ""}">${html}</div>`;
  viewEl.dataset.route = location.hash;
  if (same) window.scrollTo({ top: y });
}
const currentTab = () => ((location.hash || "#/heute").slice(2).split("/")[0] || "heute");
function showError(err) {
  render(`<div class="banner glass">${icon("alert")}<span>Keine Verbindung zum Tracker. Im Heimnetz oder per VPN verbunden? <span class="muted">(${esc(err.message)})</span></span></div>`);
}

async function route() {
  const parts = (location.hash || "#/heute").slice(2).split("/");
  const tab = parts[0] || "heute";
  $$(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === (tab === "lebensmittel" ? "mahlzeiten" : tab)));
  for (const c of charts) if (!c.el.isConnected) charts.delete(c);
  if (!viewEl.children.length) viewEl.innerHTML = '<div class="grid"><div class="skeleton col-8"></div><div class="skeleton col-4"></div><div class="skeleton col-12"></div></div>';
  try {
    if (!settingsCache) await loadSettings();
    if (tab === "woche") await viewWeek();
    else if (tab === "mahlzeiten" || tab === "lebensmittel") await viewMeals();
    else if (tab === "verlauf") await viewHistory();
    else await viewToday(parts[1]);
  } catch (err) { showError(err); }
}
const refresh = () => route();
window.addEventListener("hashchange", () => { closeSheet(); route(); window.scrollTo({ top: 0 }); });

// Beim Zurueckkehren in die App aktualisieren (neuer Tag, Garmin-Verbrauch gestiegen)
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (Date.now() - hiddenAt > 120000 && !sheet.classList.contains("on")) route();
});

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
route();
