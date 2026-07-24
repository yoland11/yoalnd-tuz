import { createAuthApi } from "@/infrastructure/auth-api";
import { createHttpClient } from "@/infrastructure/http-client";
import { secureTokenStore } from "@/infrastructure/secure-store";

/**
 * Composition root (lightweight DI). Everything that needs the HTTP client or
 * auth service imports the singletons from here, so wiring lives in exactly one
 * place and tests can swap the implementations.
 */

let unauthorizedHandler: (() => void) | null = null;

/** Registered by the AuthProvider so a 401/403 anywhere forces a sign-out. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export const tokens = secureTokenStore;

export const http = createHttpClient({
  tokens,
  onUnauthorized: () => unauthorizedHandler?.(),
});

export const authApi = createAuthApi({ http, tokens });
