import {
  setAuthTokenGetter,
  setExtraHeadersGetter,
} from "@workspace/api-client-react";

const AUTH_TOKEN_KEY = "ajn_auth_token";
const CART_SESSION_KEY = "ajn_cart_session_id";
const DEVICE_ID_KEY = "ajn_device_id";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ajn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function getAuthToken(): string | null {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function getCartSessionId(): string {
  if (!canUseStorage()) return "anonymous";
  const existing = window.localStorage.getItem(CART_SESSION_KEY);
  if (existing) return existing;

  const sessionId = newSessionId();
  window.localStorage.setItem(CART_SESSION_KEY, sessionId);
  return sessionId;
}

// Stable, non-secret device identifier shared with adminFetch (see
// src/views/admin/_lib.ts). Kept here too so generated-client requests carry the
// same x-device-id for session/device tracking.
function getDeviceId(): string {
  if (!canUseStorage()) return "";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = newSessionId();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function configureApiSession(): void {
  setAuthTokenGetter(() => getAuthToken());
  setExtraHeadersGetter(() => {
    const headers: Record<string, string> = {
      "x-session-id": getCartSessionId(),
    };
    const deviceId = getDeviceId();
    if (deviceId) headers["x-device-id"] = deviceId;
    return headers;
  });
}
