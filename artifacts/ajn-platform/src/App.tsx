import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout/Layout";
import Home from "@/pages/home";
import Services from "@/pages/services/index";
import ServiceRequest from "@/pages/services/id";
import Store from "@/pages/store/index";
import ProductDetail from "@/pages/store/id";
import Cart from "@/pages/cart";
import Checkout from "@/pages/checkout";
import Track from "@/pages/track";
import Gallery from "@/pages/gallery";
import Account from "@/pages/account";
import Admin from "@/pages/admin/index";
import Invoice from "@/pages/admin/invoice";

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
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
