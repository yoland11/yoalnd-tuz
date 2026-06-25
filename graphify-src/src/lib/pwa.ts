export async function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        window.dispatchEvent(new CustomEvent("ajn-pwa-update-ready"));
      }
    });
  });
  return registration;
}

export function applyPwaUpdate() {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" });
  }
  window.location.reload();
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export async function getPushPublicKey() {
  const res = await fetch("/api/notifications/vapid-public-key", { credentials: "include" });
  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  return data?.publicKey || "";
}

export async function subscribeToPushNotifications() {
  if (typeof window === "undefined" || !("Notification" in window) || !("PushManager" in window)) {
    throw new Error("المتصفح لا يدعم الإشعارات");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("لم يتم السماح بالإشعارات");
  const publicKey = await getPushPublicKey();
  if (!publicKey) throw new Error("مفاتيح Push غير مفعلة في البيئة");
  const registration = await registerServiceWorker();
  if (!registration) throw new Error("تعذر تسجيل Service Worker");
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const res = await fetch("/api/notifications/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(subscription),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "تعذر تفعيل الإشعارات");
  return data;
}
