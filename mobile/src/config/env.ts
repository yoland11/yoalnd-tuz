import Constants from "expo-constants";

/**
 * Resolves the AJN platform base URL. Precedence:
 *   1. EXPO_PUBLIC_API_BASE_URL (build/runtime env — recommended)
 *   2. expo.extra.apiBaseUrl in app.json (fallback default)
 *
 * The mobile app never embeds business logic or secrets; it only needs to know
 * which AJN server to talk to. All auth/permission decisions stay server-side.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  const server = (fromEnv || extra.apiBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  return server.endsWith("/api") ? server : server + "/api";
}

export const env = {
  apiBaseUrl: resolveBaseUrl(),
} as const;
