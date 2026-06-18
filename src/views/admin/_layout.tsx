import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Package, ShoppingBag, Image as ImageIcon, Truck,
  Settings, LogOut, Users, Tag, UserCog, Sparkles, Wallet, MessageCircle, Database, Archive,
  Receipt, ShoppingCart, BarChart3, PenTool, Monitor, History, Barcode, Printer,
  Percent, Trophy, AlertTriangle, ChevronDown, Home, Store, Boxes, Megaphone, ShieldCheck,
  CheckSquare, CalendarDays, Inbox, Activity, QrCode, UserCheck,
  Bell, Menu, X,
} from "lucide-react";
import { adminFetch, hasPerm, type AdminMe, type Permission } from "./_lib";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { AdminNotificationsBell } from "./notifications-bell";

type NavItem = { href: string; label: string; icon: any; perm: Permission | null; adminOnly?: boolean; external?: boolean };
type NavAction = { label: string; icon: any; action: "logout" };
type NavEntry = NavItem | NavAction;
type NavGroup = { id: string; label: string; icon: any; items: NavEntry[] };

const NAV: NavItem[] = [
  { href: "/admin/dashboard",      label: "الرئيسية",          icon: LayoutDashboard, perm: "dashboard" },
  { href: "/admin/notifications",  label: "الإشعارات",         icon: Bell,            perm: "dashboard" },
  { href: "/admin/orders",         label: "الطلبات والحجوزات", icon: ShoppingBag,    perm: "orders" },
  { href: "/admin/calendar",       label: "تقويم الحجوزات",     icon: CalendarDays,   perm: "orders" },
  { href: "/admin/archive",        label: "الأرشيف",           icon: Archive,        perm: "orders" },
  { href: "/admin/services",       label: "الخدمات",            icon: Sparkles,        perm: "services" },
  { href: "/admin/koshas",         label: "إدارة الكوشات",       icon: Sparkles,        perm: "services" },
  { href: "/admin/kosha-bookings", label: "حجوزات الكوشات",      icon: CalendarDays,    perm: "orders" },
  { href: "/admin/products",       label: "المتجر",             icon: Package,         perm: "products" },
  { href: "/admin/categories",     label: "التصنيفات",          icon: Tag,             perm: "products" },
  { href: "/admin/barcodes",       label: "طباعة الباركود",     icon: Barcode,         perm: "products" },
  { href: "/admin/inventory-alerts",label: "تنبيهات المخزون",   icon: AlertTriangle,   perm: "products" },
  { href: "/admin/pos",             label: "نقطة البيع POS",    icon: Monitor,         perm: "invoices" },
  { href: "/admin/sales",          label: "فواتير المبيعات",   icon: Receipt,         perm: "invoices" },
  { href: "/admin/purchases",      label: "فواتير الشراء",      icon: ShoppingCart,    perm: "accounting" },
  { href: "/admin/reports",        label: "التقارير",           icon: BarChart3,       perm: "accounting" },
  { href: "/admin/reports/daily",  label: "التقرير اليومي",      icon: Receipt,         perm: "accounting" },
  { href: "/admin/finance",        label: "لوحة المالية",        icon: BarChart3,       perm: "accounting" },
  { href: "/admin/finance/daily-report", label: "تقرير الصندوق اليومي", icon: Receipt, perm: "accounting" },
  { href: "/admin/finance/reconciliation", label: "جرد الصندوق اليومي", icon: Wallet, perm: "accounting" },
  { href: "/admin/expenses",       label: "المصاريف",           icon: ShoppingCart,    perm: "accounting" },
  { href: "/admin/expenses/categories", label: "تصنيفات المصاريف", icon: Tag,          perm: "accounting" },
  { href: "/admin/finance/reports", label: "التقارير المالية",    icon: BarChart3,       perm: "accounting" },
  { href: "/admin/coupons",        label: "الكوبونات",          icon: Percent,         perm: "accounting" },
  { href: "/admin/gallery",        label: "الصور والملفات",     icon: ImageIcon,       perm: "gallery" },
  { href: "/admin/delivery",       label: "التوصيل",            icon: Truck,           perm: "delivery" },
  { href: "/admin/customers",      label: "العملاء",            icon: Users,           perm: "customers" },
  { href: "/admin/loyalty",        label: "نقاط الولاء",        icon: Trophy,          perm: "customers" },
  { href: "/admin/crews",          label: "إدارة الكادر",       icon: UserCog,         perm: "staff" },
  { href: "/admin/staff",          label: "الموظفون",           icon: UserCog,         perm: "staff" },
  { href: "/admin/activity-log",   label: "سجل النشاط",         icon: History,         perm: "staff" },
  { href: "/admin/tasks",          label: "المهام الداخلية",    icon: CheckSquare,     perm: "tasks" },
  { href: "/admin/attendance",     label: "الحضور والانصراف",   icon: UserCheck,       perm: "tasks" },
  { href: "/admin/messages",       label: "رسائل الزبائن",      icon: Inbox,           perm: "customers" },
  { href: "/admin/customer-activity",label: "نشاط الزبائن",     icon: Activity,        perm: "customers" },
  { href: "/admin/qr-orders",      label: "QR الطلبات",         icon: QrCode,          perm: "orders" },
  { href: "/admin/accounting",     label: "الحسابات",            icon: Wallet,          perm: "accounting" },
  { href: "/admin/whatsapp",       label: "الواتساب",           icon: MessageCircle,   perm: "whatsapp" },
  { href: "/admin/backup",         label: "النسخ الاحتياطي",     icon: Database,        perm: "backup", adminOnly: true },
  { href: "/admin/invoice-designer",label: "مصمم الفاتورة",     icon: PenTool,         perm: "settings", adminOnly: true },
  { href: "/admin/settings/printer",label: "إعدادات الطابعة",   icon: Printer,         perm: "settings", adminOnly: true },
  { href: "/admin/settings",       label: "الإعدادات",          icon: Settings,        perm: "settings", adminOnly: true },
];

const NAV_BY_HREF = new Map(NAV.map((item) => [item.href, item]));

function navItem(href: string): NavItem {
  const item = NAV_BY_HREF.get(href);
  if (!item) throw new Error(`Missing admin nav item: ${href}`);
  return item;
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    label: "الرئيسية",
    icon: Home,
    items: [navItem("/admin/dashboard"), navItem("/admin/notifications")],
  },
  {
    id: "store",
    label: "إدارة المتجر",
    icon: ShoppingBag,
    items: [
      navItem("/admin/orders"),
      navItem("/admin/calendar"),
      navItem("/admin/qr-orders"),
      navItem("/admin/archive"),
      navItem("/admin/services"),
      navItem("/admin/koshas"),
      navItem("/admin/kosha-bookings"),
      navItem("/admin/products"),
      navItem("/admin/categories"),
      navItem("/admin/gallery"),
      navItem("/admin/delivery"),
      navItem("/admin/customers"),
    ],
  },
  {
    id: "sales",
    label: "المبيعات والفواتير",
    icon: Receipt,
    items: [
      navItem("/admin/pos"),
      navItem("/admin/sales"),
      navItem("/admin/purchases"),
      navItem("/admin/coupons"),
    ],
  },
  {
    id: "inventory",
    label: "المخزون",
    icon: Boxes,
    items: [
      navItem("/admin/inventory-alerts"),
      navItem("/admin/barcodes"),
    ],
  },
  {
    id: "management",
    label: "الإدارة",
    icon: ShieldCheck,
    items: [
      navItem("/admin/crews"),
      navItem("/admin/staff"),
      navItem("/admin/activity-log"),
      navItem("/admin/tasks"),
      navItem("/admin/attendance"),
    ],
  },
  {
    id: "finance",
    label: "الإدارة المالية",
    icon: Wallet,
    items: [
      navItem("/admin/finance"),
      navItem("/admin/finance/daily-report"),
      navItem("/admin/finance/reconciliation"),
      navItem("/admin/expenses"),
      navItem("/admin/expenses/categories"),
      navItem("/admin/finance/reports"),
    ],
  },
  {
    id: "reports",
    label: "التقارير والحسابات",
    icon: BarChart3,
    items: [
      navItem("/admin/reports/daily"),
      navItem("/admin/reports"),
      navItem("/admin/accounting"),
    ],
  },
  {
    id: "marketing",
    label: "التسويق والعملاء",
    icon: Megaphone,
    items: [
      navItem("/admin/loyalty"),
      navItem("/admin/messages"),
      navItem("/admin/customer-activity"),
      navItem("/admin/whatsapp"),
    ],
  },
  {
    id: "system",
    label: "النظام",
    icon: Settings,
    items: [
      navItem("/admin/backup"),
      navItem("/admin/invoice-designer"),
      navItem("/admin/settings/printer"),
      navItem("/admin/settings"),
    ],
  },
  {
    id: "site",
    label: "الموقع",
    icon: Store,
    items: [
      { href: "/", label: "رجوع إلى الموقع", icon: Home, perm: null, external: true },
      { href: "/store", label: "فتح المتجر", icon: Store, perm: null, external: true },
      { href: "/koshas", label: "فتح الكوشات", icon: Sparkles, perm: null, external: true },
    ],
  },
  {
    id: "account",
    label: "الحساب",
    icon: LogOut,
    items: [
      { label: "خروج", icon: LogOut, action: "logout" },
    ],
  },
];

const ADMIN_NAV_ACCORDION_STORAGE_KEY = "ajn-admin-sidebar-open-groups";
const ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY = "ajn-admin-sidebar-hidden";

function isNavItem(item: NavEntry): item is NavItem {
  return "href" in item;
}

function canSeeItem(me: AdminMe, item: NavEntry) {
  if (!isNavItem(item)) return true;
  if (item.adminOnly && me.role !== "admin") return false;
  return hasPerm(me, item.perm);
}

function itemIsActive(location: string, item: NavEntry) {
  return isNavItem(item) && !item.external && (location === item.href || location.startsWith(item.href + "/"));
}

function groupHasActiveItem(location: string, group: NavGroup) {
  return group.items.some((item) => itemIsActive(location, item));
}

function readOpenGroups(activeGroupId: string | null) {
  if (typeof window === "undefined") return activeGroupId ? [activeGroupId] : ["home"];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ADMIN_NAV_ACCORDION_STORAGE_KEY) ?? "[]");
    const next = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    if (activeGroupId && !next.includes(activeGroupId)) next.push(activeGroupId);
    return next.length ? next : activeGroupId ? [activeGroupId] : ["home"];
  } catch {
    return activeGroupId ? [activeGroupId] : ["home"];
  }
}

export function AdminLayout({
  children,
  onLogout,
  me,
}: {
  children: ReactNode;
  onLogout: () => void;
  me: AdminMe;
}) {
  const [location] = useLocation();
  const { data: settings } = usePublicSettings();
  const { data: inventoryAlertCount } = useQuery({
    queryKey: ["admin", "inventory-alert-count"],
    queryFn: () => adminFetch<{ count: number }>("/admin/inventory-alerts?count=1"),
    enabled: hasPerm(me, "products"),
    staleTime: 60_000,
  });
  const { data: messageCount } = useQuery({
    queryKey: ["admin", "messages-count"],
    queryFn: () => adminFetch<{ count: number }>("/admin/messages?count=1"),
    enabled: hasPerm(me, "customers"),
    staleTime: 30_000,
  });

  const lowStockCount = inventoryAlertCount?.count ?? 0;
  const newMessageCount = messageCount?.count ?? 0;
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSidebarHidden(window.localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY) === "1");
  }, []);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location]);

  function toggleDesktopSidebar() {
    setSidebarHidden((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-background flex overflow-x-hidden" dir="rtl">
      <aside className={`${sidebarHidden ? "hidden" : "hidden md:flex"} w-60 shrink-0 bg-card border-l border-border/30 flex-col py-6 px-3 fixed right-0 top-0 h-full z-10`} style={{ backgroundColor: "hsl(var(--sidebar))" }}>
        <div className="px-3 mb-6 min-w-0 overflow-hidden">
          <div className="mb-3 flex h-14 w-full items-center overflow-hidden">
            <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={112} height={48} decoding="async" className="h-12 w-28 max-w-full shrink-0 object-contain" />
          </div>
          <p className="text-xs text-muted-foreground">لوحة الإدارة</p>
          <h2 className="truncate text-lg font-bold text-foreground">{settings?.site_name ?? "مجموعة علي جان"}</h2>
          <p className="truncate text-[11px] text-primary mt-2">
            {me.fullName || me.username}
            {me.role === "admin" && <span className="text-muted-foreground"> · مدير رئيسي</span>}
          </p>
        </div>
        <AdminSidebarNav
          groups={NAV_GROUPS}
          me={me}
          location={location}
          lowStockCount={lowStockCount}
          newMessageCount={newMessageCount}
          onLogout={onLogout}
          className="flex-1 overflow-y-auto pr-0.5 pl-1"
        />
      </aside>
      <button
        type="button"
        onClick={toggleDesktopSidebar}
        className={`hidden md:inline-flex fixed top-5 z-30 h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card border border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all ${
          sidebarHidden ? "right-6" : "right-[calc(15rem+1rem)]"
        }`}
        aria-label={sidebarHidden ? "إظهار القائمة" : "إخفاء القائمة"}
      >
        <Menu className="w-4 h-4" />
      </button>
      <div className="hidden md:flex fixed left-6 top-5 z-30 h-10 shrink-0 items-center">
        <AdminNotificationsBell />
      </div>
      <div className="md:hidden fixed top-0 inset-x-0 z-20 bg-card/95 border-b border-border/30 backdrop-blur" dir="rtl" style={{ backgroundColor: "hsl(var(--sidebar) / 0.95)" }}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 overflow-hidden px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="فتح القائمة"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden">
              <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={40} height={40} decoding="async" className="h-9 w-10 max-w-full shrink-0 object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">لوحة الإدارة</p>
              <p className="truncate text-sm font-semibold text-foreground">{settings?.site_name ?? "مجموعة علي جان"}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <AdminNotificationsBell />
            <button onClick={onLogout} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive" aria-label="تسجيل الخروج">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40" dir="rtl">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            aria-label="إغلاق القائمة"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <aside className="absolute right-0 top-0 h-full w-72 max-w-[86vw] bg-card border-l border-border/30 shadow-2xl flex flex-col py-5 px-3" style={{ backgroundColor: "hsl(var(--sidebar))" }}>
            <div className="px-3 mb-4 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={96} height={44} decoding="async" className="h-11 w-24 shrink-0 object-contain mb-2" />
                <p className="text-xs text-muted-foreground">لوحة الإدارة</p>
                <h2 className="truncate text-base font-bold text-foreground">{settings?.site_name ?? "مجموعة علي جان"}</h2>
              </div>
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                aria-label="إغلاق القائمة"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <AdminSidebarNav
              groups={NAV_GROUPS}
              me={me}
              location={location}
              lowStockCount={lowStockCount}
              newMessageCount={newMessageCount}
              onLogout={onLogout}
              onNavigate={() => setMobileSidebarOpen(false)}
              className="flex-1 overflow-y-auto pr-0.5 pl-1"
              compact
            />
          </aside>
        </div>
      )}
      <main className={`flex-1 min-w-0 overflow-x-hidden p-4 pt-20 md:p-6 md:pt-20 max-w-[1400px] w-full ${sidebarHidden ? "md:mr-0" : "md:mr-60"}`}>{children}</main>
    </div>
  );
}

function AdminSidebarNav({
  groups,
  me,
  location,
  lowStockCount,
  newMessageCount,
  onLogout,
  onNavigate,
  className = "",
  compact = false,
}: {
  groups: NavGroup[];
  me: AdminMe;
  location: string;
  lowStockCount: number;
  newMessageCount: number;
  onLogout: () => void;
  onNavigate?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const visibleGroups = useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canSeeItem(me, item)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, me]);
  const activeGroupId = visibleGroups.find((group) => groupHasActiveItem(location, group))?.id ?? null;
  const [openGroups, setOpenGroups] = useState<string[]>(() => readOpenGroups(activeGroupId));

  useEffect(() => {
    setOpenGroups((current) => {
      const next = activeGroupId && !current.includes(activeGroupId) ? [...current, activeGroupId] : current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ADMIN_NAV_ACCORDION_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, [activeGroupId]);

  function toggleGroup(groupId: string) {
    setOpenGroups((current) => {
      const isOpen = current.includes(groupId);
      const next = isOpen && groupId !== activeGroupId
        ? current.filter((item) => item !== groupId)
        : isOpen
          ? current
          : [...current, groupId];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ADMIN_NAV_ACCORDION_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }

  return (
    <nav className={`space-y-1 ${className}`} aria-label="قائمة لوحة الإدارة">
      {visibleGroups.map((group) => {
        const isOpen = openGroups.includes(group.id);
        const active = group.id === activeGroupId;
        const GroupIcon = group.icon;
        return (
          <div key={group.id} className="rounded-xl">
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={isOpen}
              className={`w-full flex min-w-0 items-center gap-3 px-3 rounded-lg text-sm transition-colors ${
                compact ? "py-2" : "py-2.5"
              } ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <GroupIcon className="w-4 h-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-right font-medium">{group.label}</span>
              <ChevronDown className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
            </button>
            <div className={`grid transition-all duration-200 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
              <div className="overflow-hidden">
                <div className="mt-1 space-y-1 border-r border-border/30 mr-5 pr-2">
                  {group.items.map((item) => (
                    <AdminSidebarEntry
                      key={isNavItem(item) ? item.href : item.label}
                      item={item}
                      location={location}
                      lowStockCount={lowStockCount}
                      newMessageCount={newMessageCount}
                      onLogout={onLogout}
                      onNavigate={onNavigate}
                      compact={compact}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function AdminSidebarEntry({
  item,
  location,
  lowStockCount,
  newMessageCount,
  onLogout,
  onNavigate,
  compact,
}: {
  item: NavEntry;
  location: string;
  lowStockCount: number;
  newMessageCount: number;
  onLogout: () => void;
  onNavigate?: () => void;
  compact: boolean;
}) {
  const ItemIcon = item.icon;
  const baseClass = `w-full flex min-w-0 items-center gap-2.5 rounded-lg text-sm transition-colors ${
    compact ? "px-3 py-2" : "px-3 py-2.5"
  }`;
  if (!isNavItem(item)) {
    return (
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          onLogout();
        }}
        className={`${baseClass} text-muted-foreground hover:text-destructive hover:bg-destructive/10`}
      >
        <ItemIcon className="w-4 h-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-right">{item.label}</span>
      </button>
    );
  }

  const active = itemIsActive(location, item);
  const content = (
    <>
      <ItemIcon className="w-4 h-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-right">{item.label}</span>
      {item.href === "/admin/inventory-alerts" && lowStockCount > 0 && (
        <span className="shrink-0 rounded-full bg-status-warning/15 px-2 py-0.5 text-[10px] text-status-warning">
          {lowStockCount.toLocaleString("ar-IQ")}
        </span>
      )}
      {item.href === "/admin/messages" && newMessageCount > 0 && (
        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
          {newMessageCount.toLocaleString("ar-IQ")}
        </span>
      )}
    </>
  );

  if (item.external) {
    return (
      <a href={item.href} onClick={onNavigate} className={`${baseClass} text-muted-foreground hover:bg-muted hover:text-foreground`}>
        {content}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`${baseClass} ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
    >
      {content}
    </Link>
  );
}

export function EmptyState({ message }: { message?: string }) {
  return (
    <div className="text-center py-16 text-muted-foreground">
      {message ?? "لا توجد بيانات"}
    </div>
  );
}

export function NoPermission() {
  return (
    <div className="text-center py-24" dir="rtl">
      <h2 className="text-xl font-bold text-foreground mb-2">ليس لديك صلاحية</h2>
      <p className="text-muted-foreground text-sm">يرجى التواصل مع المدير لمنحك الوصول لهذا القسم.</p>
    </div>
  );
}

export { NAV as ADMIN_NAV };
