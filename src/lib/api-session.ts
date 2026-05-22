import {
  setAuthTokenGetter,
  setExtraHeadersGetter,
} from "@workspace/api-client-react";

const AUTH_TOKEN_KEY = "ajn_auth_token";
const CART_SESSION_KEY = "ajn_cart_session_id";

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

export function configureApiSession(): void {
  setAuthTokenGetter(() => getAuthToken());
  setExtraHeadersGetter(() => ({
    "x-session-id": getCartSessionId(),
  }));
}
