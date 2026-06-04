"use client";

import { lazy, Suspense, useEffect } from "react";
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
import ProductDetail from "@/views/store/id";
import Cart from "@/views/cart";
import Checkout from "@/views/checkout";
import Track from "@/views/track";
import Gallery from "@/views/gallery";
import Login from "@/views/login";
import Profile from "@/views/profile";
import { registerServiceWorker } from "@/lib/pwa";

const Admin = lazy(() => import("@/views/admin/index"));
const Invoice = lazy(() => import("@/views/admin/invoice"));

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

function Router() {
  const adminFallback = (
    <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
      <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
    </div>
  );

  return (
    <Switch>
      {/* Admin routes - separate from main layout */}
      <Route path="/admin/invoice/:id">
        <Suspense fallback={adminFallback}>
          <Invoice />
        </Suspense>
      </Route>
      <Route path="/admin/:rest*">
        <Suspense fallback={adminFallback}>
          <Admin />
        </Suspense>
      </Route>
      <Route path="/admin">
        <Suspense fallback={adminFallback}>
          <Admin />
        </Suspense>
      </Route>
      
      {/* Main app routes wrapped in Layout */}
      <Route path="*">
        <Layout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/services" component={Services} />
            <Route path="/services/:id" component={ServiceRequest} />
            <Route path="/store" component={Store} />
            <Route path="/store/category/:categorySlug/:subcategorySlug" component={Store} />
            <Route path="/store/category/:categorySlug" component={Store} />
            <Route path="/store/:id" component={ProductDetail} />
            <Route path="/cart" component={Cart} />
            <Route path="/checkout" component={Checkout} />
            <Route path="/track" component={Track} />
            <Route path="/gallery" component={Gallery} />
            <Route path="/login" component={Login} />
            <Route path="/profile" component={Profile} />
            <Route path="/account" component={Profile} />
            <Route component={NotFound} />
          </Switch>
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
