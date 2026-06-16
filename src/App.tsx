"use client";

import { Component, lazy, Suspense, useEffect, type ReactNode } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/views/not-found";
import { Layout } from "@/components/layout/Layout";
import Home from "@/views/home";
import Services from "@/views/services/index";
import ServiceRequest from "@/views/services/id";
import Store from "@/views/store/index";
import Cart from "@/views/cart";
import Login from "@/views/login";
import { registerServiceWorker } from "@/lib/pwa";
import { ThemeVariables } from "@/components/theme-variables";

// Admin — lazy (large bundle, staff-only)
const Admin = lazy(() => import("@/views/admin/index"));
const Invoice = lazy(() => import("@/views/admin/invoice"));

// Customer routes — lazy (heavy components: ModelViewer, charts, tracking logic)
const ProductDetail = lazy(() => import("@/views/store/id"));
const Track = lazy(() => import("@/views/track"));
const Checkout = lazy(() => import("@/views/checkout"));
const Gallery = lazy(() => import("@/views/gallery"));
const Favorites = lazy(() => import("@/views/favorites"));
const Profile = lazy(() => import("@/views/profile"));
const Account = lazy(() => import("@/views/account"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Minimal spinner shown while lazy chunks load
const PageSpinner = () => (
  <div className="min-h-[50vh] flex items-center justify-center" dir="rtl">
    <div className="h-7 w-7 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

const AdminSpinner = () => (
  <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
    <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
  </div>
);

// Recovers from ChunkLoadError caused by stale cached HTML referencing new deploy chunks
class ChunkErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(error: Error) {
    if (error.name === "ChunkLoadError" || /loading chunk/i.test(error.message)) {
      return { failed: true };
    }
    return null;
  }
  componentDidCatch(error: Error) {
    if (error.name === "ChunkLoadError" || /loading chunk/i.test(error.message)) {
      // Force a hard reload to fetch fresh chunks from the new deployment
      window.location.reload();
    }
  }
  render() {
    if (this.state.failed) return <PageSpinner />;
    return this.props.children;
  }
}

function Router() {
  return (
    <Switch>
      {/* Admin routes — lazy, outside Layout */}
      <Route path="/admin/invoice/:id">
        <Suspense fallback={<AdminSpinner />}>
          <Invoice />
        </Suspense>
      </Route>
      <Route path="/admin/reports/daily">
        <Suspense fallback={<AdminSpinner />}>
          <Admin />
        </Suspense>
      </Route>
      <Route path="/admin/reports/:rest*">
        <Suspense fallback={<AdminSpinner />}>
          <Admin />
        </Suspense>
      </Route>
      <Route path="/admin/finance/:rest*">
        <Suspense fallback={<AdminSpinner />}>
          <Admin />
        </Suspense>
      </Route>
      <Route path="/admin/expenses/:rest*">
        <Suspense fallback={<AdminSpinner />}>
          <Admin />
        </Suspense>
      </Route>
      <Route path="/admin/:rest*">
        <Suspense fallback={<AdminSpinner />}>
          <Admin />
        </Suspense>
      </Route>
      <Route path="/admin">
        <Suspense fallback={<AdminSpinner />}>
          <Admin />
        </Suspense>
      </Route>

      {/* Customer routes wrapped in Layout */}
      <Route path="*">
        <Layout>
          <ChunkErrorBoundary>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/services" component={Services} />
              <Route path="/services/:id" component={ServiceRequest} />
              <Route path="/store" component={Store} />
              <Route path="/store/category/:categorySlug/:subcategorySlug" component={Store} />
              <Route path="/store/category/:categorySlug" component={Store} />
              <Route path="/store/:id">
                <Suspense fallback={<PageSpinner />}><ProductDetail /></Suspense>
              </Route>
              <Route path="/cart" component={Cart} />
              <Route path="/checkout">
                <Suspense fallback={<PageSpinner />}><Checkout /></Suspense>
              </Route>
              <Route path="/favorites">
                <Suspense fallback={<PageSpinner />}><Favorites /></Suspense>
              </Route>
              <Route path="/track/:token">
                <Suspense fallback={<PageSpinner />}><Track /></Suspense>
              </Route>
              <Route path="/track">
                <Suspense fallback={<PageSpinner />}><Track /></Suspense>
              </Route>
              <Route path="/gallery">
                <Suspense fallback={<PageSpinner />}><Gallery /></Suspense>
              </Route>
              <Route path="/login" component={Login} />
              <Route path="/profile">
                <Suspense fallback={<PageSpinner />}><Profile /></Suspense>
              </Route>
              <Route path="/account">
                <Suspense fallback={<PageSpinner />}><Account /></Suspense>
              </Route>
              <Route component={NotFound} />
            </Switch>
          </ChunkErrorBoundary>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        registerServiceWorker().catch(() => {
          /* SW registration is non-fatal */
        });
      });
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeVariables />
      <TooltipProvider>
        <WouterRouter>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
