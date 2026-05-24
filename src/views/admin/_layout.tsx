import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Package, ShoppingBag, Image as ImageIcon, Truck,
  Settings, LogOut, Users, Tag, UserCog, Sparkles, Wallet, MessageCircle, Database, Archive,
} from "lucide-react";
import { hasPerm, type AdminMe, type Permission } from "./_lib";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";

type NavItem = { href: string; label: string; icon: any; perm: Permission };

const NAV: NavItem[] = [
  { href: "/admin/dashboard",  label: "الرئيسية",          icon: LayoutDashboard, perm: "dashboard" },
  { href: "/admin/orders",     label: "الطلبات والحجوزات", icon: ShoppingBag,    perm: "orders" },
  { href: "/admin/archive",    label: "الأرشيف",           icon: Archive,        perm: "orders" },
  { href: "/admin/services",   label: "الخدمات",            icon: Sparkles,        perm: "services" },
  { href: "/admin/products",   label: "المتجر",             icon: Package,         perm: "products" },
  { href: "/admin/categories", label: "التصنيفات",          icon: Tag,             perm: "products" },
  { href: "/admin/gallery",    label: "الصور والملفات",     icon: ImageIcon,       perm: "gallery" },
  { href: "/admin/delivery",   label: "التوصيل",            icon: Truck,           perm: "delivery" },
  { href: "/admin/customers",  label: "العملاء",            icon: Users,           perm: "customers" },
  { href: "/admin/crews",      label: "إدارة الكادر",       icon: UserCog,         perm: "staff" },
  { href: "/admin/staff",      label: "الموظفون",           icon: UserCog,         perm: "staff" },
  { href: "/admin/accounting", label: "الحسابات",            icon: Wallet,          perm: "accounting" },
  { href: "/admin/whatsapp",   label: "الواتساب",           icon: MessageCircle,   perm: "whatsapp" },
  { href: "/admin/backup",     label: "النسخ الاحتياطي",     icon: Database,        perm: "backup" },
  { href: "/admin/settings",   label: "الإعدادات",          icon: Settings,        perm: "settings" },
];

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

  const visibleNav = NAV.filter(item => hasPerm(me, item.perm));

  return (
    <div className="min-h-screen bg-background flex" dir="rtl">
      <aside className="hidden md:flex w-60 bg-card border-l border-border/30 flex-col py-6 px-3 fixed right-0 top-0 h-full z-10 overflow-y-auto">
        <div className="px-3 mb-6">
          <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={112} height={48} decoding="async" className="h-12 w-28 object-contain mb-3" />
          <p className="text-xs text-muted-foreground">لوحة الإدارة</p>
          <h2 className="text-lg font-bold text-foreground">{settings?.site_name ?? "مجموعة علي جان"}</h2>
          <p className="text-[11px] text-primary mt-2">
            {me.fullName || me.username}
            {me.role === "admin" && <span className="text-muted-foreground"> · مدير رئيسي</span>}
          </p>
        </div>
        <nav className="flex-1 space-y-1">
          {visibleNav.map(item => {
            const active = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href}>
                <a
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </a>
              </Link>
            );
          })}
        </nav>
        <button
          onClick={onLogout}
          className="flex items-center gap-3 px-3 py-2.5 text-sm text-muted-foreground hover:text-destructive transition-colors mt-4"
        >
          <LogOut className="w-4 h-4" />
          خروج
        </button>
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
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3">
          {visibleNav.map(item => {
            const active = location === item.href || location.startsWith(item.href + "/");
            return (
              <Link key={item.href} href={item.href}>
                <a className={`shrink-0 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${active ? "bg-primary/10 text-primary" : "bg-background/60 text-muted-foreground"}`}>
                  <item.icon className="w-3.5 h-3.5" />
                  {item.label}
                </a>
              </Link>
            );
          })}
        </nav>
      </div>
      <main className="flex-1 p-4 pt-28 md:pt-6 md:mr-60 md:p-6 max-w-[1400px] w-full">{children}</main>
    </div>
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
