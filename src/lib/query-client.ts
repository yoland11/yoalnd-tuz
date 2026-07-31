import { QueryClient } from "@tanstack/react-query";

// Single shared React Query client for the whole app. Exported from its own
// module (instead of living inside App.tsx) so non-React code — notably
// logoutAdmin() in src/views/admin/_lib.ts — can clear it on sign-out/switch.
// Clearing the cache on logout is what stops a previous employee's private
// cached data (bookings, dashboards) from lingering after an account switch.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
