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
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };
  if (extra.apiBaseUrl) return extra.apiBaseUrl.replace(/\/+$/, "");

  return "http://localhost:3000";
}

export const env = {
  apiBaseUrl: resolveBaseUrl(),
} as const;
