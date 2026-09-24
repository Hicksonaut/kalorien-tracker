// Service Worker: App-Shell offline, API "network first" mit letztem Stand als Fallback.
// Schreibende Aufrufe (POST/PATCH/DELETE) laufen immer direkt ans Netz.
const SHELL = "kt-shell-v3";
const API = "kt-api-v3";
const SHELL_FILES = ["/", "/styles.css", "/app.js", "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/apple-touch-icon.png", "/vendor/zxing-reader.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== SHELL && k !== API).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname === "/login.html" || url.pathname.startsWith("/api/login")) return;
  if (url.pathname.startsWith("/api/search") || url.pathname.startsWith("/api/barcode")) return;
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(API).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => caches.match(e.request).then((r) => r || Response.error()))
    );
    return;
  }
  // Shell: erst Netz (damit Updates sofort da sind), offline aus dem Cache
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("/")))
  );
});
