// AJN Service Worker — PWA shell, offline fallback, and Web Push.
const VERSION = "ajn-pwa-v6";
const APP_SHELL = [
  "/",
  "/store",
  "/track",
  "/login",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/admin/login",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  // Next.js owns chunk caching. Caching its dev/runtime modules here can pair a
  // stale module factory with fresh application code and prevent the staff app
  // from loading at all.
  if (url.pathname.startsWith("/_next/")) return;
  // Never keep authenticated pages in Cache Storage on a shared device.
  if (
    url.pathname.startsWith("/admin/") ||
    url.pathname === "/staff" ||
    url.pathname.startsWith("/staff/") ||
    url.pathname === "/profile" ||
    url.pathname.startsWith("/profile/") ||
    url.pathname === "/account" ||
    url.pathname.startsWith("/account/")
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/offline.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (isCacheable(response)) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    }),
  );
});

function isCacheable(response) {
  if (!response || response.status !== 200 || response.type !== "basic") return false;
  const cacheControl = response.headers.get("cache-control") || "";
  return !/(?:no-store|private)/i.test(cacheControl);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "AJN", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "AJN";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/icon-192.png",
    tag: data.tag || `ajn-${Date.now()}`,
    dir: "rtl",
    lang: "ar",
    data: {
      href: data.href || "/",
      notificationId: data.id || null,
      type: data.type || "general",
    },
    vibrate: [120, 60, 120],
    requireInteraction: Boolean(data.requireInteraction),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data && event.notification.data.href ? event.notification.data.href : "/", self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client && client.url === targetUrl) return client.focus();
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
