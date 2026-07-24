import type { HttpClient } from "./http-client";
import type { TokenStore } from "./secure-store";
import { type AuthUser, AuthUserSchema, LoginResponseSchema } from "@/domain/entities";

/**
 * Authentication service over the platform's /staff/auth/* endpoints.
 *
 * Login exchanges username + password for a bearer token, which is persisted to
 * SecureStore; every later request reuses it via the HTTP client's token getter.
 * The password itself is never stored.
 */
export interface AuthApi {
  login(username: string, password: string): Promise<AuthUser>;
  me(): Promise<AuthUser>;
  logout(): Promise<void>;
}

export function createAuthApi(deps: {
  http: HttpClient;
  tokens: TokenStore;
}): AuthApi {
  return {
    async login(username, password) {
      const raw = await deps.http.post<unknown>("/staff/auth/login", {
        username: username.trim(),
        password,
      });
      const result = LoginResponseSchema.parse(raw);
      await deps.tokens.set(result.token);
      return result.user;
    },

    async me() {
      const raw = await deps.http.get<{ user: unknown }>("/staff/auth/me");
      return AuthUserSchema.parse(raw.user);
    },

    async logout() {
      try {
        await deps.http.post("/staff/auth/logout");
      } finally {
        await deps.tokens.clear();
      }
    },
  };
}
