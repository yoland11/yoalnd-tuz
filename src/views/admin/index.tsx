import { lazy, Suspense, useEffect, useState } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import {
  fetchAdminMe, logoutAdmin, hasPerm,
  type AdminMe, type Permission,
} from "./_lib";
import { AdminLayout, NoPermission, ADMIN_NAV } from "./_layout";
import AdminLogin from "./login";

const DashboardPage = lazy(() => import("./dashboard"));
const OrdersPage = lazy(() => import("./orders"));
const ArchivePage = lazy(() => import("./archive"));
const ServicesPage = lazy(() => import("./services"));
const ProductsPage = lazy(() => import("./products"));
const CategoriesPage = lazy(() => import("./categories"));
const SalesPage = lazy(() => import("./sales"));
const PurchasesPage = lazy(() => import("./purchases"));
const ReportsPage = lazy(() => import("./reports"));
const GalleryPage = lazy(() => import("./gallery"));
const DeliveryPage = lazy(() => import("./delivery"));
const CustomersPage = lazy(() => import("./customers"));
const CrewsPage = lazy(() => import("./crews"));
const StaffPage = lazy(() => import("./staff"));
const AccountingPage = lazy(() => import("./accounting"));
const WhatsappPage = lazy(() => import("./whatsapp"));
const BackupPage = lazy(() => import("./backup"));
const SettingsPage = lazy(() => import("./settings"));

function Guard({ me, perm, children }: { me: AdminMe; perm: Permission; children: React.ReactNode }) {
  if (!hasPerm(me, perm)) return <NoPermission />;
  return <>{children}</>;
}

function AdminPageLoader() {
  return (
    <div className="min-h-[320px] flex items-center justify-center" dir="rtl">
      <Loader2 className="w-7 h-7 text-primary animate-spin" />
    </div>
  );
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
      <Suspense fallback={<AdminPageLoader />}>
        <Switch>
          <Route path="/admin/dashboard" >{() => <Guard me={me} perm="dashboard"><DashboardPage /></Guard>}</Route>
          <Route path="/admin/orders"    >{() => <Guard me={me} perm="orders"   ><OrdersPage     /></Guard>}</Route>
          <Route path="/admin/archive"   >{() => <Guard me={me} perm="orders"   ><ArchivePage    /></Guard>}</Route>
          <Route path="/admin/services"  >{() => <Guard me={me} perm="services" ><ServicesPage   /></Guard>}</Route>
          <Route path="/admin/products"  >{() => <Guard me={me} perm="products"   ><ProductsPage   /></Guard>}</Route>
          <Route path="/admin/categories">{() => <Guard me={me} perm="products"  ><CategoriesPage /></Guard>}</Route>
          <Route path="/admin/sales"     >{() => <Guard me={me} perm="invoices"  ><SalesPage      /></Guard>}</Route>
          <Route path="/admin/purchases" >{() => <Guard me={me} perm="accounting"><PurchasesPage  /></Guard>}</Route>
          <Route path="/admin/reports"   >{() => <Guard me={me} perm="accounting"><ReportsPage    /></Guard>}</Route>
          <Route path="/admin/gallery"   >{() => <Guard me={me} perm="gallery"   ><GalleryPage    /></Guard>}</Route>
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
      </Suspense>
    </AdminLayout>
  );
}
