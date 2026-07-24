import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthUser } from "@/domain/entities";
import { authApi, setUnauthorizedHandler, tokens } from "./container";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const queryClient = useQueryClient();

  const signOut = useCallback(async () => {
    setUser(null);
    setStatus("unauthenticated");
    queryClient.clear();
  }, [queryClient]);

  // Any request that comes back 401/403 forces a clean sign-out.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void tokens.clear();
      void signOut();
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // On cold start, restore the session if a stored token still validates.
  useEffect(() => {
    let active = true;
    (async () => {
      const token = await tokens.get();
      if (!token) {
        if (active) setStatus("unauthenticated");
        return;
      }
      try {
        const me = await authApi.me();
        if (active) {
          setUser(me);
          setStatus("authenticated");
        }
      } catch {
        await tokens.clear();
        if (active) setStatus("unauthenticated");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const me = await authApi.login(username, password);
    setUser(me);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    await signOut();
  }, [signOut]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
