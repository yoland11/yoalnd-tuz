import { useEffect, useState } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import {
  fetchAdminMe, logoutAdmin, hasPerm,
  type AdminMe, type Permission,
} from "./_lib";
import { AdminLayout, NoPermission, ADMIN_NAV } from "./_layout";
import AdminLogin from "./login";
import DashboardPage from "./dashboard";
import OrdersPage from "./orders";
import ServicesPage from "./services";
import ProductsPage from "./products";
import CategoriesPage from "./categories";
import GalleryPage from "./gallery";
import DeliveryPage from "./delivery";
import CustomersPage from "./customers";
import CrewsPage from "./crews";
import StaffPage from "./staff";
import AccountingPage from "./accounting";
import WhatsappPage from "./whatsapp";
import BackupPage from "./backup";
import SettingsPage from "./settings";

function Guard({ me, perm, children }: { me: AdminMe; perm: Permission; children: React.ReactNode }) {
  if (!hasPerm(me, perm)) return <NoPermission />;
  return <>{children}</>;
}

export default function Admin() {
  const [location] = useLocation();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let alive = true;
    fetchAdminMe().then(u => {
      if (!alive) return;
      setMe(u);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  // Login route is always reachable
  if (location === "/admin/login") return <AdminLogin />;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // Not logged in → redirect to login
  if (!me) return <Redirect to="/admin/login" />;

  // /admin → /admin/dashboard
  if (location === "/admin" || location === "/admin/") return <Redirect to="/admin/dashboard" />;

  async function handleLogout() {
    await logoutAdmin();
    setMe(null);
    setLocation("/admin/login");
  }

  return (
    <AdminLayout me={me} onLogout={handleLogout}>
      <Switch>
        <Route path="/admin/dashboard" >{() => <Guard me={me} perm="dashboard"><DashboardPage /></Guard>}</Route>
        <Route path="/admin/orders"    >{() => <Guard me={me} perm="orders"   ><OrdersPage     /></Guard>}</Route>
        <Route path="/admin/services"  >{() => <Guard me={me} perm="services" ><ServicesPage   /></Guard>}</Route>
        <Route path="/admin/products"  >{() => <Guard me={me} perm="products" ><ProductsPage   /></Guard>}</Route>
        <Route path="/admin/categories">{() => <Guard me={me} perm="products" ><CategoriesPage /></Guard>}</Route>
        <Route path="/admin/gallery"   >{() => <Guard me={me} perm="gallery"  ><GalleryPage    /></Guard>}</Route>
        <Route path="/admin/delivery"  >{() => <Guard me={me} perm="delivery" ><DeliveryPage   /></Guard>}</Route>
        <Route path="/admin/customers" >{() => <Guard me={me} perm="customers"><CustomersPage  /></Guard>}</Route>
        <Route path="/admin/crews"     >{() => <Guard me={me} perm="staff"    ><CrewsPage      /></Guard>}</Route>
        <Route path="/admin/staff"     >{() => <Guard me={me} perm="staff"    ><StaffPage      /></Guard>}</Route>
        <Route path="/admin/accounting">{() => <Guard me={me} perm="accounting"><AccountingPage/></Guard>}</Route>
        <Route path="/admin/whatsapp"  >{() => <Guard me={me} perm="whatsapp" ><WhatsappPage   /></Guard>}</Route>
        <Route path="/admin/backup"    >{() => <Guard me={me} perm="backup"   ><BackupPage     /></Guard>}</Route>
        <Route path="/admin/settings"  >{() => <Guard me={me} perm="settings" ><SettingsPage   /></Guard>}</Route>
        <Route>{() => <NoPermission />}</Route>
      </Switch>
    </AdminLayout>
  );
}
