/* eslint-env serviceworker */
/* global clients */

/**
 * TrinkDuell Service Worker.
 *
 * Ziel: beim zweiten Aufruf lädt die App aus dem lokalen Cache statt über
 * Netlify. Das Bundle sind rund 540 KB brotli — spürbar, wenn man auf einer
 * Party im überlasteten Mobilfunknetz steht.
 *
 * Die drei Strategien unterscheiden sich bewusst, weil die Inhalte
 * unterschiedlich altern:
 *
 *   1. Gehashte Build-Assets (/_expo/static/...) — cache-first, für immer.
 *      Der Dateiname enthält den Inhalts-Hash, ein geänderter Inhalt hat also
 *      einen anderen Namen. Diese Datei kann nie veralten.
 *
 *   2. Navigationen (HTML) — network-first mit Cache-Fallback. Andersherum
 *      würde ein Deploy erst nach dem nächsten Neustart ankommen, und die
 *      Nutzer säßen auf einer alten App, ohne es zu merken.
 *
 *   3. Alles andere gleiche Herkunft (Bilder, Fonts) — stale-while-revalidate:
 *      sofort aus dem Cache anzeigen, im Hintergrund aktualisieren.
 *
 * Die API wird NIE angefasst. Ein zwischengespeicherter Feed oder Punktestand
 * wäre schlimmer als gar keiner — die App hat für Offline bereits eine eigene
 * Logik (siehe executeApiCall in src/services/api.ts), die hier nicht durch
 * heimlich alte Antworten unterlaufen werden darf.
 */

const VERSION = "v1";
const STATIC_CACHE = `trinkduell-static-${VERSION}`;
const PAGES_CACHE = `trinkduell-pages-${VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, PAGES_CACHE];

self.addEventListener("install", (event) => {
  // Sofort übernehmen statt auf das Schließen aller Tabs zu warten.
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("trinkduell-") && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function isHashedBuildAsset(url) {
  return url.pathname.startsWith("/_expo/static/");
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Auch offline soll die App starten: irgendeine gecachte Seite ist
    // besser als der Browser-Fehlerbildschirm, denn die App selbst kann
    // mit fehlendem Netz umgehen.
    const fallback = await cache.match("/");
    if (fallback) return fallback;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || network.then((r) => r || fetch(request));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Nur GET. Ein zwischengespeichertes POST wäre schlicht falsch.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Fremde Herkunft (allen voran api.trinkduell.com) unangetastet lassen.
  if (url.origin !== self.location.origin) return;

  // Range-Requests (Video/Audio) vertragen sich nicht mit der Cache-API.
  if (request.headers.has("range")) return;

  if (isHashedBuildAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGES_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
});
