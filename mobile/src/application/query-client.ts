import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/infrastructure/http-client";

/**
 * Shared QueryClient. We do not retry auth failures (a 401/403 means re-login,
 * not a transient error) and keep data fresh-ish for a field app on flaky
 * networks.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && (error.isUnauthorized || error.status === 404)) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
