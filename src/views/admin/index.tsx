import { lazy, Suspense, useEffect, useState } from "react";
import { Switch, Route, useLocation, Redirect } from "wouter";
import { Loader2 } from "lucide-react";
import {
  fetchAdminMe,
  logoutAdmin,
  hasPerm,
  getCachedAdminMe,
  type AdminMe,
  type Permission,
} from "./_lib";
import { AdminLayout, NoPermission, ADMIN_NAV } from "./_layout";
import AdminLogin from "./login";

const DashboardPage = lazy(() => import("./dashboard"));
const NotificationsPage = lazy(() => import("./notifications"));
const OrdersPage = lazy(() => import("./orders"));
const CalendarPage = lazy(() => import("./calendar"));
const QrOrdersPage = lazy(() => import("./qr-orders"));
const ArchivePage = lazy(() => import("./archive"));
const ServicesPage = lazy(() => import("./services"));
const AdminKoshasPage = lazy(() => import("./koshas"));
const KoshaPackagesPage = lazy(() => import("./kosha-packages"));
const AdminKoshaBookingsPage = lazy(() =>
  import("./koshas").then((module) => ({
    default: module.AdminKoshaBookingsPage,
  })),
);
const KoshaCollectionsPage = lazy(() => import("./kosha-collections"));
const ProductsPage = lazy(() => import("./products"));
const CategoriesPage = lazy(() => import("./categories"));
const BarcodesPage = lazy(() => import("./barcodes"));
const PrintLabelsPage = lazy(() => import("./print-labels"));
const AssetNewPage = lazy(() => import("./asset-new"));
const InventoryAlertsPage = lazy(() => import("./inventory-alerts"));
const InventoryValueReportPage = lazy(() => import("./inventory-value-report"));
const ProductionPage = lazy(() => import("./production"));
const ProductionReportsPage = lazy(() => import("./production-reports"));
const POSPage = lazy(() => import("./pos"));
const SalesPage = lazy(() => import("./sales"));
const PurchasesPage = lazy(() => import("./purchases"));
const ReportsPage = lazy(() => import("./reports"));
const DailyFinancialReportPage = lazy(() => import("./daily-report"));
const DailyCashReportsPage = lazy(() =>
  import("./daily-cash").then((module) => ({
    default: module.DailyCashReportsPage,
  })),
);
const DailyCashReconciliationPage = lazy(() =>
  import("./daily-cash").then((module) => ({
    default: module.DailyCashReconciliationPage,
  })),
);
const CouponsPage = lazy(() => import("./coupons"));
const GalleryPage = lazy(() => import("./gallery"));
const DeliveryPage = lazy(() => import("./delivery"));
const CustomersPage = lazy(() => import("./customers"));
const LoyaltyPage = lazy(() => import("./loyalty"));
const CrewsPage = lazy(() => import("./crews"));
const StaffPage = lazy(() => import("./staff"));
const ActivityLogPage = lazy(() => import("./activity-log"));
const TasksPage = lazy(() => import("./tasks"));
const AttendancePage = lazy(() => import("./attendance"));
const MessagesPage = lazy(() => import("./messages"));
const CustomerActivityPage = lazy(() => import("./customer-activity"));
const AccountingPage = lazy(() => import("./accounting"));
const FinanceDashboardPage = lazy(() =>
  import("./finance").then((module) => ({
    default: module.FinanceDashboardPage,
  })),
);
const FinanceReportsPage = lazy(() =>
  import("./finance").then((module) => ({
    default: module.FinanceReportsPage,
  })),
);
const MasterCashBoxPage = lazy(() => import("./master-cash"));
const FinancialRequestPage = lazy(() =>
  import("./master-cash").then((module) => ({
    default: module.FinancialRequestPage,
  })),
);
const ExpensesPage = lazy(() => import("./expenses"));
const ExpenseCategoriesPage = lazy(() =>
  import("./expenses").then((module) => ({
    default: module.ExpenseCategoriesPage,
  })),
);
const WhatsappPage = lazy(() => import("./whatsapp"));
const TelegramSettingsPage = lazy(() => import("./telegram"));
const BackupPage = lazy(() => import("./backup"));
const SettingsPage = lazy(() => import("./settings"));
const PrinterSettingsPage = lazy(() => import("./printer-settings"));
const InvoiceDesignerPage = lazy(() => import("./invoice-designer"));
const ApprovalCenterPage = lazy(() => import("./operations"));
const DocumentCenterPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.DocumentCenterPage,
  })),
);
const LiveOperationsPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.LiveOperationsPage,
  })),
);
const SmartSearchPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.SmartSearchPage,
  })),
);
const BusinessAnalyticsPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.BusinessAnalyticsPage,
  })),
);
const WarehouseTransfersPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.WarehouseTransfersPage,
  })),
);
const AssetsPage = lazy(() =>
  import("./operations").then((module) => ({ default: module.AssetsPage })),
);
const AssetMovementsPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.AssetMovementsPage,
  })),
);
const MaintenanceSchedulerPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.MaintenanceSchedulerPage,
  })),
);
const PurchaseComparisonPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.PurchaseComparisonPage,
  })),
);
const DisasterRecoveryPage = lazy(() =>
  import("./operations").then((module) => ({
    default: module.DisasterRecoveryPage,
  })),
);
const TimelinesPage = lazy(() =>
  import("./operations").then((module) => ({ default: module.TimelinesPage })),
);
const EnterpriseCommandCenterPage = lazy(() => import("./enterprise"));
const ReportDesignerPage = lazy(() =>
  import("./report-designer").then((module) => ({
    default: module.ReportDesignerPage,
  })),
);
const SyncCenterPage = lazy(() => import("./sync-center"));
const GraduationAdminPage = lazy(() => import("./graduation"));

function Guard({
  me,
  perm,
  anyPerm,
  children,
}: {
  me: AdminMe;
  perm?: Permission;
  anyPerm?: Permission[];
  children: React.ReactNode;
}) {
  const allowed = anyPerm
    ? anyPerm.some((p) => hasPerm(me, p))
    : hasPerm(me, perm ?? null);
  if (!allowed) return <NoPermission />;
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
  const cached = getCachedAdminMe();
  const [me, setMe] = useState<AdminMe | null>(() =>
    cached !== undefined ? cached : null,
  );
  const [loading, setLoading] = useState(() => cached === undefined);
  const [, setLocation] = useLocation();

  useEffect(() => {
    // If we already have a cached result, skip the network round-trip on mount
    if (getCachedAdminMe() !== undefined) return;
    let alive = true;
    fetchAdminMe().then((u) => {
      if (!alive) return;
      setMe(u);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Login route is always reachable. Lift the authenticated user into state so the app
  // renders immediately after login (no manual refresh needed).
  if (location === "/admin/login")
    return (
      <AdminLogin
        onAuthed={(u) => {
          setMe(u);
          setLoading(false);
        }}
      />
    );

  if (loading) {
    return (
      <div
        className="min-h-dvh bg-background flex items-center justify-center"
        dir="rtl"
      >
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // Not logged in → redirect to login
  if (!me) return <Redirect to="/admin/login" />;

  // /admin → /admin/dashboard
  if (location === "/admin" || location === "/admin/")
    return <Redirect to="/admin/dashboard" />;

  async function handleLogout() {
    await logoutAdmin();
    setMe(null);
    setLocation("/admin/login");
  }

  return (
    <AdminLayout me={me} onLogout={handleLogout}>
      <Suspense fallback={<AdminPageLoader />}>
        <Switch>
          <Route path="/admin/dashboard">
            {() => (
              <Guard me={me} perm="dashboard">
                <DashboardPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/command-center">
            {() => (
              <Guard me={me} perm="dashboard">
                <EnterpriseCommandCenterPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/notifications">
            {() => (
              <Guard me={me} perm="dashboard">
                <NotificationsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/orders">
            {() => (
              <Guard me={me} perm="orders">
                <OrdersPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/calendar">
            {() => (
              <Guard me={me} perm="orders">
                <CalendarPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/qr-orders">
            {() => (
              <Guard me={me} perm="orders">
                <QrOrdersPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/archive">
            {() => (
              <Guard me={me} perm="orders">
                <ArchivePage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/services">
            {() => (
              <Guard me={me} perm="services">
                <ServicesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/koshas/new">
            {() => (
              <Guard me={me} perm="services">
                <AdminKoshasPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/koshas/:id/edit">
            {() => (
              <Guard me={me} perm="services">
                <AdminKoshasPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/koshas">
            {() => (
              <Guard me={me} perm="services">
                <AdminKoshasPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/koshas/:section">
            {() => (
              <Guard me={me} perm="services">
                <AdminKoshasPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/kosha-packages">
            {() => (
              <Guard me={me} perm="services">
                <KoshaPackagesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/kosha-bookings">
            {() => (
              <Guard me={me} perm="orders">
                <AdminKoshaBookingsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/kosha-collections">
            {() => (
              <Guard me={me} perm="accounting">
                <KoshaCollectionsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/graduation/:section">
            {() => (
              <Guard me={me} perm="graduation">
                <GraduationAdminPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/graduation">
            {() => (
              <Guard me={me} perm="graduation">
                <GraduationAdminPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/products">
            {() => (
              <Guard me={me} perm="products">
                <ProductsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/categories">
            {() => (
              <Guard me={me} perm="products">
                <CategoriesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/barcodes">
            {() => (
              <Guard me={me} perm="products">
                <BarcodesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/print-labels">
            {() => (
              <Guard me={me} perm="products">
                <PrintLabelsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/production/reports">
            {() => (
              <Guard me={me} anyPerm={["production_view", "products"]}>
                <ProductionReportsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/production">
            {() => (
              <Guard me={me} anyPerm={["production_view", "products"]}>
                <ProductionPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/inventory-alerts">
            {() => (
              <Guard me={me} perm="products">
                <InventoryAlertsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/inventory-value">
            {() => (
              <Guard me={me} perm="products">
                <InventoryValueReportPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/pos">
            {() => (
              <Guard me={me} perm="invoices">
                <POSPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/sales">
            {() => (
              <Guard me={me} perm="invoices">
                <SalesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/purchases">
            {() => (
              <Guard me={me} perm="accounting">
                <PurchasesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/reports/daily">
            {() => (
              <Guard me={me} perm="accounting">
                <DailyFinancialReportPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/reports">
            {() => (
              <Guard me={me} perm="accounting">
                <ReportsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/finance">
            {() => (
              <Guard me={me} perm="accounting">
                <FinanceDashboardPage me={me} />
              </Guard>
            )}
          </Route>
          <Route path="/admin/finance/daily-report">
            {() => (
              <Guard me={me} perm="accounting">
                <DailyCashReportsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/finance/reconciliation">
            {() => (
              <Guard me={me} perm="accounting">
                <DailyCashReconciliationPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/finance/master-cash">
            {() => (
              <Guard me={me} perm="accounting">
                <MasterCashBoxPage me={me} />
              </Guard>
            )}
          </Route>
          <Route path="/admin/finance/request">
            {() => (
              <Guard me={me} perm="tasks">
                <FinancialRequestPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/expenses/new">
            {() => (
              <Guard me={me} perm="accounting">
                <ExpensesPage startNew />
              </Guard>
            )}
          </Route>
          <Route path="/admin/expenses/categories">
            {() => (
              <Guard me={me} perm="accounting">
                <ExpenseCategoriesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/expenses">
            {() => (
              <Guard me={me} perm="accounting">
                <ExpensesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/finance/expenses">
            {() => (
              <Guard me={me} perm="accounting">
                <ExpensesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/finance/reports">
            {() => (
              <Guard me={me} perm="accounting">
                <FinanceReportsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/daily-cash-reports">
            {() => <Redirect to="/admin/finance/daily-report" />}
          </Route>
          <Route path="/admin/daily-cash-reconciliation">
            {() => <Redirect to="/admin/finance/reconciliation" />}
          </Route>
          <Route path="/admin/coupons">
            {() => (
              <Guard me={me} perm="accounting">
                <CouponsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/gallery">
            {() => (
              <Guard me={me} perm="gallery">
                <GalleryPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/delivery">
            {() => (
              <Guard me={me} perm="delivery">
                <DeliveryPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/customers">
            {() => (
              <Guard me={me} perm="customers">
                <CustomersPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/loyalty">
            {() => (
              <Guard me={me} perm="customers">
                <LoyaltyPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/crews">
            {() => (
              <Guard me={me} perm="staff">
                <CrewsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/staff">
            {() => (
              <Guard me={me} perm="staff">
                <StaffPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/activity-log">
            {() => (
              <Guard me={me} perm="staff">
                <ActivityLogPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/tasks">
            {() => (
              <Guard me={me} perm="tasks">
                <TasksPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/attendance">
            {() => (
              <Guard me={me} perm="tasks">
                <AttendancePage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/approvals">
            {() => (
              <Guard me={me} perm="tasks">
                <ApprovalCenterPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/documents">
            {() => (
              <Guard me={me} perm="orders">
                <DocumentCenterPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/live-operations">
            {() => (
              <Guard me={me} perm="dashboard">
                <LiveOperationsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/smart-search">
            {() => (
              <Guard me={me} perm="dashboard">
                <SmartSearchPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/timelines">
            {() => (
              <Guard me={me} perm="dashboard">
                <TimelinesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/messages">
            {() => (
              <Guard me={me} perm="customers">
                <MessagesPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/customer-activity">
            {() => (
              <Guard me={me} perm="customers">
                <CustomerActivityPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/accounting">
            {() => (
              <Guard me={me} perm="accounting">
                <AccountingPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/business-analytics">
            {() => (
              <Guard me={me} perm="accounting">
                <BusinessAnalyticsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/warehouse-transfers">
            {() => (
              <Guard me={me} perm="products">
                <WarehouseTransfersPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/assets/new">
            {() => (
              <Guard me={me} perm="products">
                <AssetNewPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/assets">
            {() => (
              <Guard me={me} perm="products">
                <AssetsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/asset-movements">
            {() => (
              <Guard me={me} perm="products">
                <AssetMovementsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/maintenance-scheduler">
            {() => (
              <Guard me={me} perm="products">
                <MaintenanceSchedulerPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/purchase-comparison">
            {() => (
              <Guard me={me} perm="accounting">
                <PurchaseComparisonPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/whatsapp">
            {() => (
              <Guard me={me} perm="whatsapp">
                <WhatsappPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/backup">
            {() => (
              <Guard me={me} perm="backup">
                <BackupPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/disaster-recovery">
            {() => (
              <Guard me={me} perm="backup">
                <DisasterRecoveryPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/invoice-designer">
            {() => (
              <Guard me={me} perm="settings">
                <InvoiceDesignerPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/report-designer">
            {() => (
              <Guard me={me} perm="settings">
                <ReportDesignerPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/sync-center">
            {() => (
              <Guard me={me} perm="settings">
                <SyncCenterPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/settings/printer">
            {() => (
              <Guard me={me} perm="settings">
                <PrinterSettingsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/settings/telegram">
            {() => (
              <Guard me={me} perm="settings">
                <TelegramSettingsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/printer-settings">
            {() => (
              <Guard me={me} perm="settings">
                <PrinterSettingsPage />
              </Guard>
            )}
          </Route>
          <Route path="/admin/settings">
            {() => (
              <Guard me={me} perm="settings">
                <SettingsPage />
              </Guard>
            )}
          </Route>
          <Route>{() => <NoPermission />}</Route>
        </Switch>
      </Suspense>
    </AdminLayout>
  );
}
