import * as SecureStore from "expo-secure-store";

/**
 * Encrypted token storage backed by the device keystore (Keychain / Keystore).
 * The session token is the only secret the app persists — never a password.
 *
 * This is the single source of truth for "am I authenticated"; the HTTP client
 * reads from here on every request via the injected token getter.
 */
const SESSION_TOKEN_KEY = "ajn_staff_session_token";

export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

export const secureTokenStore: TokenStore = {
  async get() {
    try {
      return await SecureStore.getItemAsync(SESSION_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string) {
    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async clear() {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  },
};
