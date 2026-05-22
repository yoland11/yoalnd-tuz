// AJN Service Worker — app shell + offline fallback. Versioned cache so deploys evict cleanly.
const VERSION = "ajn-v1";
const APP_SHELL = ["./", "./offline.html", "./manifest.webmanifest", "./favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API responses, admin pages, or HMR. Strip SW scope so checks work
  // whether the app is served at the root or under a BASE_URL subpath like /app/.
  const scopePath = new URL(self.registration.scope).pathname.replace(/\/$/, "");
  const rel = scopePath && url.pathname.startsWith(scopePath + "/")
    ? url.pathname.slice(scopePath.length)
    : url.pathname;
  if (rel.startsWith("/api/") || rel.startsWith("/admin")) return;

  // Navigation requests: network-first with offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./offline.html").then((r) => r || new Response("offline", { status: 503 }))),
    );
    return;
  }
  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    }),
  );
});
