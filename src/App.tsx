"use client";

import { useEffect } from "react";
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
import Account from "@/views/account";
import Admin from "@/views/admin/index";
import Invoice from "@/views/admin/invoice";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Admin routes - separate from main layout */}
      <Route path="/admin/invoice/:id" component={Invoice} />
      <Route path="/admin/:rest*" component={Admin} />
      <Route path="/admin" component={Admin} />
      
      {/* Main app routes wrapped in Layout */}
      <Route path="*">
        <Layout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/services" component={Services} />
            <Route path="/services/:id" component={ServiceRequest} />
            <Route path="/store" component={Store} />
            <Route path="/store/:id" component={ProductDetail} />
            <Route path="/cart" component={Cart} />
            <Route path="/checkout" component={Checkout} />
            <Route path="/track" component={Track} />
            <Route path="/gallery" component={Gallery} />
            <Route path="/account" component={Account} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
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
