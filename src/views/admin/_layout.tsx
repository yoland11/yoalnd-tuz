import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Package, ShoppingBag, Image as ImageIcon, Truck,
  Settings, LogOut, Users, Tag, UserCog, Sparkles, Wallet, MessageCircle, Database, Archive,
  Receipt, ShoppingCart, BarChart3, PenTool, Monitor, History, Barcode, Printer,
  Percent, Trophy, AlertTriangle, ChevronDown, Home, Store, Boxes, Megaphone, ShieldCheck,
} from "lucide-react";
import { adminFetch, hasPerm, type AdminMe, type Permission } from "./_lib";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

type NavItem = { href: string; label: string; icon: any; perm: Permission | null; adminOnly?: boolean; external?: boolean };
type NavAction = { label: string; icon: any; action: "logout" };
type NavEntry = NavItem | NavAction;
type NavGroup = { id: string; label: string; icon: any; items: NavEntry[] };

const NAV: NavItem[] = [
  { href: "/admin/dashboard",      label: "الرئيسية",          icon: LayoutDashboard, perm: "dashboard" },
  { href: "/admin/orders",         label: "الطلبات والحجوزات", icon: ShoppingBag,    perm: "orders" },
  { href: "/admin/archive",        label: "الأرشيف",           icon: Archive,        perm: "orders" },
  { href: "/admin/services",       label: "الخدمات",            icon: Sparkles,        perm: "services" },
  { href: "/admin/products",       label: "المتجر",             icon: Package,         perm: "products" },
  { href: "/admin/categories",     label: "التصنيفات",          icon: Tag,             perm: "products" },
  { href: "/admin/barcodes",       label: "طباعة الباركود",     icon: Barcode,         perm: "products" },
  { href: "/admin/inventory-alerts",label: "تنبيهات المخزون",   icon: AlertTriangle,   perm: "products" },
  { href: "/admin/pos",             label: "نقطة البيع POS",    icon: Monitor,         perm: "invoices" },
  { href: "/admin/sales",          label: "فواتير المبيعات",   icon: Receipt,         perm: "invoices" },
  { href: "/admin/purchases",      label: "فواتير الشراء",      icon: ShoppingCart,    perm: "accounting" },
  { href: "/admin/reports",        label: "التقارير",           icon: BarChart3,       perm: "accounting" },
  { href: "/admin/coupons",        label: "الكوبونات",          icon: Percent,         perm: "accounting" },
  { href: "/admin/gallery",        label: "الصور والملفات",     icon: ImageIcon,       perm: "gallery" },
  { href: "/admin/delivery",       label: "التوصيل",            icon: Truck,           perm: "delivery" },
  { href: "/admin/customers",      label: "العملاء",            icon: Users,           perm: "customers" },
  { href: "/admin/loyalty",        label: "نقاط الولاء",        icon: Trophy,          perm: "customers" },
  { href: "/admin/crews",          label: "إدارة الكادر",       icon: UserCog,         perm: "staff" },
  { href: "/admin/staff",          label: "الموظفون",           icon: UserCog,         perm: "staff" },
  { href: "/admin/activity-log",   label: "سجل النشاط",         icon: History,         perm: "staff" },
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
    items: [navItem("/admin/dashboard")],
  },
  {
    id: "store",
    label: "إدارة المتجر",
    icon: ShoppingBag,
    items: [
      navItem("/admin/orders"),
      navItem("/admin/archive"),
      navItem("/admin/services"),
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
    ],
  },
  {
    id: "reports",
    label: "التقارير والحسابات",
    icon: BarChart3,
    items: [
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

  const lowStockCount = inventoryAlertCount?.count ?? 0;

  return (
    <div className="min-h-screen bg-background flex" dir="rtl">
      <aside className="hidden md:flex w-60 bg-card border-l border-border/30 flex-col py-6 px-3 fixed right-0 top-0 h-full z-10">
        <div className="px-3 mb-6">
          <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={112} height={48} decoding="async" className="h-12 w-28 object-contain mb-3" />
          <p className="text-xs text-muted-foreground">لوحة الإدارة</p>
          <h2 className="text-lg font-bold text-foreground">{settings?.site_name ?? "مجموعة علي جان"}</h2>
          <p className="text-[11px] text-primary mt-2">
            {me.fullName || me.username}
            {me.role === "admin" && <span className="text-muted-foreground"> · مدير رئيسي</span>}
          </p>
        </div>
        <AdminSidebarNav
          groups={NAV_GROUPS}
          me={me}
          location={location}
          lowStockCount={lowStockCount}
          onLogout={onLogout}
          className="flex-1 overflow-y-auto pr-0.5 pl-1"
        />
      </aside>
      <div className="md:hidden fixed top-0 inset-x-0 z-20 bg-card/95 border-b border-border/30 backdrop-blur" dir="rtl">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={40} height={40} decoding="async" className="h-9 w-9 object-contain" />
            <div>
              <p className="text-xs text-muted-foreground">لوحة الإدارة</p>
              <p className="text-sm font-semibold text-foreground">{settings?.site_name ?? "مجموعة علي جان"}</p>
            </div>
          </div>
          <button onClick={onLogout} className="p-2 rounded-lg text-muted-foreground hover:text-destructive">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
        <AdminSidebarNav
          groups={NAV_GROUPS}
          me={me}
          location={location}
          lowStockCount={lowStockCount}
          onLogout={onLogout}
          className="max-h-[44vh] overflow-y-auto px-3 pb-3"
          compact
        />
      </div>
      <main className="flex-1 p-4 pt-28 md:pt-6 md:mr-60 md:p-6 max-w-[1400px] w-full">{children}</main>
    </div>
  );
}

function AdminSidebarNav({
  groups,
  me,
  location,
  lowStockCount,
  onLogout,
  className = "",
  compact = false,
}: {
  groups: NavGroup[];
  me: AdminMe;
  location: string;
  lowStockCount: number;
  onLogout: () => void;
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
              className={`w-full flex items-center gap-3 px-3 rounded-lg text-sm transition-colors ${
                compact ? "py-2" : "py-2.5"
              } ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
            >
              <GroupIcon className="w-4 h-4" />
              <span className="font-medium">{group.label}</span>
              <ChevronDown className={`w-4 h-4 mr-auto transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
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
                      onLogout={onLogout}
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
  onLogout,
  compact,
}: {
  item: NavEntry;
  location: string;
  lowStockCount: number;
  onLogout: () => void;
  compact: boolean;
}) {
  const ItemIcon = item.icon;
  const baseClass = `w-full flex items-center gap-2.5 rounded-lg text-sm transition-colors ${
    compact ? "px-3 py-2" : "px-3 py-2.5"
  }`;
  if (!isNavItem(item)) {
    return (
      <button
        type="button"
        onClick={onLogout}
        className={`${baseClass} text-muted-foreground hover:text-destructive hover:bg-destructive/10`}
      >
        <ItemIcon className="w-4 h-4" />
        {item.label}
      </button>
    );
  }

  const active = itemIsActive(location, item);
  const content = (
    <>
      <ItemIcon className="w-4 h-4" />
      <span>{item.label}</span>
      {item.href === "/admin/inventory-alerts" && lowStockCount > 0 && (
        <span className="mr-auto rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
          {lowStockCount.toLocaleString("ar-IQ")}
        </span>
      )}
    </>
  );

  if (item.external) {
    return (
      <a href={item.href} className={`${baseClass} text-muted-foreground hover:bg-muted hover:text-foreground`}>
        {content}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
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
