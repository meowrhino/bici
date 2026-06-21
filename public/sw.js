// Service worker de bici — PWA instalable + offline básico.
//
// Estrategia por tipo de petición:
//   • navegaciones (HTML)        → network-first, con respaldo a caché y a "/"
//   • /api/* (GET)               → network-first (datos frescos online,
//                                  últimos conocidos si no hay red)
//   • resto same-origin (css/js/
//     iconos/imágenes de /r2)    → stale-while-revalidate (rápido + se
//                                  refresca en segundo plano)
//
// Las peticiones que no son GET y las cross-origin pasan directas a la red.
// Subir CACHE_VERSION invalida las cachés antiguas en el evento `activate`.

const CACHE_VERSION = "bici-v1";

// Mínimo para que la app arranque sin conexión. El resto de estáticos se
// cachean solos la primera vez que se cargan online (stale-while-revalidate).
const PRECACHE = [
  "/",
  "/compose",
  "/places",
  "/manifest.webmanifest",
  "/icons/favicon-32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Resiliente: si una URL falla no rompe toda la instalación.
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || fetch(request);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POST/PUT/DELETE → red directa
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // solo same-origin

  // Navegaciones HTML → network-first con respaldo a caché.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await networkFirst(request);
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          return (
            (await cache.match(request)) ||
            (await cache.match("/")) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // API → network-first (online manda; offline usa lo último cacheado).
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Estáticos (css/js/iconos/imágenes de /r2) → stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});
