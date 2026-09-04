import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Image as ImageIcon,
  Truck,
  Settings,
  LogOut,
  Users,
  UserRound,
  Tag,
  UserCog,
  Sparkles,
  Mail,
  Wallet,
  MessageCircle,
  Database,
  Archive,
  Receipt,
  ShoppingCart,
  BarChart3,
  PenTool,
  Monitor,
  History,
  ScanLine,
  Barcode,
  Printer,
  WalletCards,
  Percent,
  Trophy,
  AlertTriangle,
  ChevronDown,
  Home,
  Store,
  Boxes,
  Megaphone,
  ShieldCheck,
  CheckSquare,
  CalendarDays,
  Inbox,
  Activity,
  Camera,
  Trash2,
  QrCode,
  UserCheck,
  Bell,
  Bot,
  BrainCircuit,
  CircleDollarSign,
  Menu,
  PackageCheck,
  Search as SearchIconCompat,
  X,
  FileText,
  RefreshCw,
  GraduationCap,
  Ruler,
  Scissors,
  Flower2,
  Factory,
  Lock,
  SlidersHorizontal,
  Speaker,
  ChefHat,
  Plus,
} from "lucide-react";
import { adminFetch, hasPerm, type AdminMe, type Permission } from "./_lib";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { AdminNotificationsBell } from "./notifications-bell";
import { AdminGlobalSearch } from "./global-search";

export type NavItem = {
  href: string;
  label: string;
  icon: any;
  perm: Permission | null;
  anyPerm?: Permission[];
  adminOnly?: boolean;
  external?: boolean;
};
type NavAction = { label: string; icon: any; action: "logout" };
type NavEntry = NavItem | NavAction;
type NavGroup = { id: string; label: string; icon: any; items: NavEntry[] };

export const NAV: NavItem[] = [
  {
    href: "/admin/dashboard",
    label: "الرئيسية",
    icon: LayoutDashboard,
    perm: "dashboard",
  },
  {
    href: "/admin/workspace",
    label: "مساحة العمل",
    icon: Sparkles,
    perm: "dashboard",
  },
  {
    href: "/admin/command-center",
    label: "مركز القيادة",
    icon: Monitor,
    perm: "dashboard",
  },
  {
    href: "/admin/notifications",
    label: "الإشعارات",
    icon: Bell,
    perm: "dashboard",
  },
  {
    href: "/admin/graduation",
    label: "مركز تجهيزات التخرج",
    icon: GraduationCap,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/bookings",
    label: "الحجوزات",
    icon: CalendarDays,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/orders",
    label: "طلبات التخرج",
    icon: ShoppingBag,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/individual",
    label: "الطلبات الفردية",
    icon: UserRound,
    perm: "graduation.view",
  },
  {
    href: "/admin/graduation/groups",
    label: "الطلبات الجماعية",
    icon: Users,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/students",
    label: "الطلاب",
    icon: Users,
    perm: "graduation.view",
  },
  {
    href: "/admin/graduation/templates",
    label: "مكتبة النماذج",
    icon: Sparkles,
    perm: "graduation.view",
  },
  {
    href: "/admin/graduation/gallery",
    label: "معرض الصور والفيديوهات",
    icon: ImageIcon,
    perm: "graduation.preview.manage",
  },
  {
    href: "/admin/graduation/packages",
    label: "باقات التخرج",
    icon: ShoppingBag,
    perm: "graduation.package.manage",
  },
  {
    href: "/admin/graduation/customers",
    label: "عملاء التخرج",
    icon: Users,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/configurator",
    label: "مُعدّ التصميم",
    icon: Sparkles,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/measurements",
    label: "القياسات",
    icon: Ruler,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/production",
    label: "الإنتاج",
    icon: Boxes,
    perm: "graduation_production",
  },
  {
    href: "/admin/graduation/production-wall",
    label: "حائط الإنتاج",
    icon: Boxes,
    perm: "graduation.production.update",
  },
  {
    href: "/admin/graduation/tailoring",
    label: "الخياطة",
    icon: Scissors,
    perm: "graduation_production",
  },
  {
    href: "/admin/graduation/tailors",
    label: "الخياطون",
    icon: Scissors,
    perm: "graduation_production",
  },
  {
    href: "/admin/graduation/printing",
    label: "الطباعة",
    icon: Printer,
    perm: "graduation_printing",
  },
  {
    href: "/admin/graduation/embroidery",
    label: "التطريز",
    icon: PenTool,
    perm: "graduation_embroidery",
  },
  {
    href: "/admin/graduation/packaging",
    label: "محطة التغليف",
    icon: Boxes,
    perm: "graduation.packaging.scan",
  },
  {
    href: "/admin/graduation/delivery",
    label: "التسليم",
    icon: Truck,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/warehouse",
    label: "مخزن التخرج",
    icon: Boxes,
    perm: "graduation_warehouse",
  },
  {
    href: "/admin/graduation/materials",
    label: "المواد والاحتياج",
    icon: Boxes,
    perm: "graduation.inventory.view",
  },
  {
    href: "/admin/graduation/invoices",
    label: "فواتير التخرج",
    icon: Receipt,
    perm: "graduation_cashier",
  },
  {
    href: "/admin/graduation/reports",
    label: "تقارير التخرج",
    icon: BarChart3,
    perm: "graduation",
  },
  {
    href: "/admin/graduation/settings",
    label: "إعدادات التخرج",
    icon: Settings,
    perm: "graduation_manager",
  },
  { href: "/admin/research", label: "مركز الأبحاث", icon: GraduationCap, perm: "research.view" },
  { href: "/admin/research/new", label: "طلب بحث جديد", icon: Plus, perm: "research.create" },
  { href: "/admin/research/orders", label: "طلبات الأبحاث", icon: FileText, perm: "research.view" },
  { href: "/admin/research/library", label: "مكتبة الأبحاث", icon: Database, perm: "research.view" },
  { href: "/admin/research/sources", label: "مكتبة المصادر", icon: SearchIconCompat, perm: "research.sources.manage" },
  { href: "/admin/research/ai", label: "المساعد الذكي", icon: Bot, perm: "research.ai.use" },
  { href: "/admin/research/writers", label: "الكتّاب", icon: Users, perm: "research.assign" },
  { href: "/admin/research/supervisors", label: "المشرفون", icon: UserCheck, perm: "research.assign" },
  { href: "/admin/research/universities", label: "الجامعات", icon: GraduationCap, perm: "research.settings.manage" },
  { href: "/admin/research/templates", label: "قوالب الأبحاث", icon: FileText, perm: "research.settings.manage" },
  { href: "/admin/research/plagiarism", label: "تقارير الاستلال", icon: ShieldCheck, perm: "research.plagiarism.manage" },
  { href: "/admin/research/citations", label: "التوثيق والمراجع", icon: Receipt, perm: "research.citations.manage" },
  { href: "/admin/research/portal", label: "بوابة العميل", icon: UserRound, perm: "research.view" },
  { href: "/admin/research/reports", label: "تقارير الأبحاث", icon: BarChart3, perm: "research.reports.view" },
  { href: "/admin/research/settings", label: "إعدادات الأبحاث", icon: Settings, perm: "research.settings.manage" },
  {
    href: "/admin/bookings",
    label: "مركز الحجوزات",
    icon: CalendarDays,
    perm: "orders",
  },
  {
    href: "/admin/sound-center",
    label: "مركز حجوزات الصوتيات",
    icon: Speaker,
    perm: "orders",
  },
  {
    href: "/admin/orders",
    label: "إدارة الطلبات",
    icon: Receipt,
    perm: "orders",
  },
  {
    href: "/admin/calendar",
    label: "تقويم الحجوزات",
    icon: CalendarDays,
    perm: "orders",
  },
  { href: "/admin/archive", label: "الأرشيف", icon: Archive, perm: "orders" },
  {
    href: "/admin/services",
    label: "الخدمات",
    icon: Sparkles,
    perm: "services",
  },
  {
    href: "/admin/koshas",
    label: "إدارة الكوشات",
    icon: Sparkles,
    perm: "services",
  },
  {
    href: "/admin/kosha-packages",
    label: "إدارة الباقات",
    icon: PackageCheck,
    perm: "services",
  },
  {
    href: "/admin/vehicles",
    label: "المركبات",
    icon: Truck,
    perm: "dashboard",
  },
  {
    href: "/admin/kosha-bookings",
    label: "حجوزات الكوشات",
    icon: CalendarDays,
    perm: "orders",
  },
  {
    href: "/admin/kosha-collections",
    label: "تحصيلات الكوشات",
    icon: CircleDollarSign,
    perm: "accounting",
  },
  { href: "/admin/products", label: "المتجر", icon: Package, perm: "products" },
  { href: "/admin/products-lookup", label: "البحث عن منتج", icon: ScanLine, perm: "products", anyPerm: ["products", "invoices", "accounting"] },
  { href: "/admin/bouquet-designer", label: "إدارة مصمم الباقات", icon: Flower2, perm: "bouquet.admin.view", anyPerm: ["bouquet.components.create", "bouquet.components.edit", "bouquet.accessories.manage", "bouquet.templates.manage", "products"] },
  {
    href: "/admin/categories",
    label: "التصنيفات",
    icon: Tag,
    perm: "products",
  },
  {
    href: "/admin/barcodes",
    label: "طباعة الباركود",
    icon: Barcode,
    perm: "products",
  },
  {
    href: "/admin/print-labels",
    label: "طباعة الملصقات",
    icon: QrCode,
    perm: "products",
  },
  {
    href: "/admin/production",
    label: "أوامر الإنتاج",
    icon: Factory,
    perm: "production_view",
    anyPerm: ["production_view", "products"],
  },
  {
    href: "/admin/production/reports",
    label: "تقارير الإنتاج",
    icon: BarChart3,
    perm: "production_view",
    anyPerm: ["production_view", "products"],
  },
  {
    href: "/admin/reserved-stock",
    label: "المخزون المحجوز",
    icon: Lock,
    perm: "products",
  },
  {
    href: "/admin/inventory-alerts",
    label: "تنبيهات المخزون",
    icon: AlertTriangle,
    perm: "products",
  },
  {
    href: "/admin/inventory-value",
    label: "تقرير قيمة المخزون",
    icon: WalletCards,
    perm: "products",
  },
  {
    href: "/admin/pos",
    label: "نقطة البيع POS",
    icon: Monitor,
    perm: "invoices",
  },
  {
    href: "/admin/sales",
    label: "فواتير المبيعات",
    icon: Receipt,
    perm: "invoices",
  },
  {
    href: "/admin/purchases",
    label: "فواتير الشراء",
    icon: ShoppingCart,
    perm: "accounting",
  },
  {
    href: "/admin/reports",
    label: "التقارير",
    icon: BarChart3,
    perm: "accounting",
  },
  {
    href: "/admin/reports/daily",
    label: "التقرير اليومي",
    icon: Receipt,
    perm: "accounting",
  },
  {
    href: "/admin/finance",
    label: "لوحة المالية",
    icon: BarChart3,
    perm: "accounting",
  },
  {
    href: "/admin/installments",
    label: "إدارة الأقساط",
    icon: WalletCards,
    perm: "installments.view",
  },
  {
    href: "/admin/finance/master-cash",
    label: "الصندوق الرئيسي",
    icon: CircleDollarSign,
    perm: "accounting",
  },
  {
    href: "/admin/suppliers",
    label: "الموردون",
    icon: Truck,
    perm: "accounting",
  },
  {
    href: "/admin/employee-advances",
    label: "سلف الموظفين",
    icon: Wallet,
    perm: "accounting",
  },
  {
    href: "/admin/hr/salaries",
    label: "رواتب الموظفين",
    icon: Wallet,
    perm: "hr",
  },
  {
    href: "/admin/executive",
    label: "لوحة القيادة التنفيذية",
    icon: Monitor,
    perm: "executive",
  },
  {
    href: "/admin/executive/ai-event-brain",
    label: "عقل الفعاليات",
    icon: BrainCircuit,
    perm: "ai_dashboard_view",
    anyPerm: ["executive", "ai_dashboard_view"],
  },
  {
    href: "/admin/finance/request",
    label: "طلب حركة مالية",
    icon: Wallet,
    perm: "tasks",
  },
  {
    href: "/admin/finance/daily-report",
    label: "تقرير الصندوق اليومي",
    icon: Receipt,
    perm: "accounting",
  },
  {
    href: "/admin/finance/reconciliation",
    label: "جرد الصندوق اليومي",
    icon: Wallet,
    perm: "accounting",
  },
  {
    href: "/admin/expenses",
    label: "المصاريف",
    icon: ShoppingCart,
    perm: "accounting",
  },
  {
    href: "/admin/expenses/categories",
    label: "تصنيفات المصاريف",
    icon: Tag,
    perm: "accounting",
  },
  {
    href: "/admin/finance/reports",
    label: "التقارير المالية",
    icon: BarChart3,
    perm: "accounting",
  },
  {
    href: "/admin/coupons",
    label: "الكوبونات",
    icon: Percent,
    perm: "accounting",
  },
  {
    href: "/admin/gallery",
    label: "الصور والملفات",
    icon: ImageIcon,
    perm: "gallery",
  },
  { href: "/admin/delivery", label: "التوصيل", icon: Truck, perm: "delivery" },
  { href: "/admin/delivery-orders", label: "طلبات التوصيل", icon: Truck, perm: "delivery" },
  {
    href: "/admin/customers",
    label: "العملاء",
    icon: Users,
    perm: "customers",
  },
  {
    href: "/admin/customer-hub",
    label: "البحث الذكي عن العملاء",
    icon: Users,
    perm: "customers",
  },
  {
    href: "/admin/loyalty",
    label: "نقاط الولاء",
    icon: Trophy,
    perm: "customers",
  },
  { href: "/admin/crews", label: "إدارة الكادر", icon: UserCog, perm: "staff" },
  { href: "/admin/staff", label: "الموظفون", icon: UserCog, perm: "staff" },
  { href: "/admin/employee-performance", label: "أداء الموظفين", icon: Trophy, perm: "staff" },
  { href: "/admin/invitations", label: "استوديو الدعوات", icon: Mail, perm: "koshas" },
  { href: "/admin/catering", label: "تجهيز حفلات الطعام", icon: ChefHat, perm: "catering_view", anyPerm: ["catering_manage", "catering_kitchen", "catering_delivery", "catering_cashier", "catering_supervisor", "catering_warehouse"] },
  {
    href: "/admin/activity-log",
    label: "سجل النشاط",
    icon: History,
    perm: "staff",
  },
  {
    href: "/admin/tasks",
    label: "المهام الداخلية",
    icon: CheckSquare,
    perm: "tasks",
  },
  {
    href: "/admin/attendance",
    label: "الحضور والانصراف",
    icon: UserCheck,
    perm: "tasks",
  },
  {
    href: "/admin/approvals",
    label: "مركز الموافقات",
    icon: ShieldCheck,
    perm: "tasks",
  },
  {
    href: "/admin/documents",
    label: "مركز المستندات",
    icon: ImageIcon,
    perm: "orders",
  },
  {
    href: "/admin/live-operations",
    label: "العمليات المباشرة",
    icon: Monitor,
    perm: "dashboard",
  },
  {
    href: "/admin/smart-search",
    label: "البحث الذكي",
    icon: SearchIconCompat,
    perm: "dashboard",
  },
  {
    href: "/admin/timelines",
    label: "التايملاين",
    icon: Activity,
    perm: "dashboard",
  },
  {
    href: "/admin/messages",
    label: "رسائل الزبائن",
    icon: Inbox,
    perm: "customers",
  },
  {
    href: "/admin/customer-activity",
    label: "نشاط الزبائن",
    icon: Activity,
    perm: "customers",
  },
  {
    href: "/admin/qr-orders",
    label: "QR الطلبات",
    icon: QrCode,
    perm: "orders",
  },
  {
    href: "/admin/accounting",
    label: "الحسابات",
    icon: Wallet,
    perm: "accounting",
  },
  {
    href: "/admin/business-analytics",
    label: "تحليلات الأعمال",
    icon: BarChart3,
    perm: "accounting",
  },
  {
    href: "/admin/warehouse-transfers",
    label: "تحويل المخازن",
    icon: Boxes,
    perm: "products",
  },
  {
    href: "/admin/assets",
    label: "الأصول",
    icon: Package,
    perm: "products",
  },
  {
    href: "/admin/assets/sales",
    label: "مبيعات الأصول",
    icon: CircleDollarSign,
    perm: "asset.view_sales",
  },
  {
    href: "/admin/assets/new",
    label: "إضافة أصل جديد",
    icon: PackageCheck,
    perm: "products",
  },
  {
    href: "/admin/assets/custody-groups",
    label: "مجموعات عهدة الموظفين",
    icon: Users,
    perm: "custody_groups_view",
  },
  {
    href: "/admin/asset-gate",
    label: "بوابة مسح الأصول",
    icon: ScanLine,
    perm: "products",
  },
  {
    href: "/admin/asset-reports",
    label: "تقارير الأصول",
    icon: BarChart3,
    perm: "products",
  },
  {
    href: "/admin/assets/depreciation",
    label: "إهلاك الأصول",
    icon: Package,
    perm: "products",
  },
  {
    href: "/admin/assets/depreciation-categories",
    label: "فئات الإهلاك",
    icon: SlidersHorizontal,
    perm: "depreciation_categories_view",
  },
  {
    href: "/admin/asset-movements",
    label: "حركة الأصول والمخزن",
    icon: ScanLine,
    perm: "products",
  },
  {
    href: "/admin/maintenance-scheduler",
    label: "جدولة الصيانة",
    icon: AlertTriangle,
    perm: "products",
  },
  {
    href: "/admin/purchase-comparison",
    label: "مقارنة المشتريات",
    icon: ShoppingCart,
    perm: "accounting",
  },
  {
    href: "/admin/whatsapp",
    label: "الواتساب",
    icon: MessageCircle,
    perm: "whatsapp",
  },
  {
    href: "/admin/document-scanner",
    label: "مسح المستمسكات",
    icon: ScanLine,
    perm: "doc_scanner_view",
  },
  {
    href: "/admin/document-library",
    label: "المستمسكات المحفوظة",
    icon: FileText,
    perm: "doc_scanner_view_saved",
  },
  {
    href: "/admin/system-health",
    label: "صحة النظام",
    icon: Activity,
    perm: "system_health",
  },
  {
    href: "/admin/photography-operations",
    label: "عمليات التصوير",
    icon: Camera,
    perm: "photography",
  },
  {
    href: "/admin/recycle-bin",
    label: "سلة المحذوفات",
    icon: Trash2,
    perm: "recycle_bin_view",
  },
  {
    href: "/admin/backup",
    label: "النسخ الاحتياطي",
    icon: Database,
    perm: "backup",
    adminOnly: true,
  },
  {
    href: "/admin/disaster-recovery",
    label: "الطوارئ والاسترجاع",
    icon: Database,
    perm: "backup",
    adminOnly: true,
  },
  {
    href: "/admin/invoice-designer",
    label: "مصمم الفاتورة",
    icon: PenTool,
    perm: "settings",
    adminOnly: true,
  },
  {
    href: "/admin/report-designer",
    label: "مصمم التقارير REPX",
    icon: FileText,
    perm: "settings",
    adminOnly: true,
  },
  {
    href: "/admin/sync-center",
    label: "مركز المزامنة",
    icon: RefreshCw,
    perm: "settings",
    adminOnly: true,
  },
  {
    href: "/admin/settings/printer",
    label: "إعدادات الطابعة",
    icon: Printer,
    perm: "settings",
    adminOnly: true,
  },
  {
    href: "/admin/print-queue",
    label: "طابور الطباعة",
    icon: Printer,
    perm: "print.queue.view",
  },
  {
    href: "/admin/settings/telegram",
    label: "إعدادات Telegram",
    icon: Bot,
    perm: "settings",
    adminOnly: true,
  },
  {
    href: "/admin/settings",
    label: "الإعدادات",
    icon: Settings,
    perm: "settings",
    adminOnly: true,
  },
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
    items: [
      navItem("/admin/workspace"),
      navItem("/admin/dashboard"),
      navItem("/admin/command-center"),
      navItem("/admin/notifications"),
    ],
  },
  {
    id: "graduation",
    label: "تجهيزات التخرج",
    icon: GraduationCap,
    items: [
      navItem("/admin/graduation"),
      navItem("/admin/graduation/orders"),
      navItem("/admin/graduation/individual"),
      navItem("/admin/graduation/groups"),
      navItem("/admin/graduation/students"),
      navItem("/admin/graduation/templates"),
      navItem("/admin/graduation/gallery"),
      navItem("/admin/graduation/packages"),
      navItem("/admin/graduation/customers"),
      navItem("/admin/graduation/configurator"),
      navItem("/admin/graduation/measurements"),
      navItem("/admin/graduation/production"),
      navItem("/admin/graduation/production-wall"),
      navItem("/admin/graduation/tailoring"),
      navItem("/admin/graduation/tailors"),
      navItem("/admin/graduation/printing"),
      navItem("/admin/graduation/embroidery"),
      navItem("/admin/graduation/packaging"),
      navItem("/admin/graduation/delivery"),
      navItem("/admin/graduation/materials"),
      navItem("/admin/graduation/reports"),
      navItem("/admin/graduation/settings"),
    ],
  },
  {
    id: "research",
    label: "AJN Research Center",
    icon: GraduationCap,
    items: [
      navItem("/admin/research"), navItem("/admin/research/new"), navItem("/admin/research/orders"),
      navItem("/admin/research/library"), navItem("/admin/research/sources"), navItem("/admin/research/ai"),
      navItem("/admin/research/writers"), navItem("/admin/research/supervisors"), navItem("/admin/research/universities"),
      navItem("/admin/research/templates"), navItem("/admin/research/plagiarism"), navItem("/admin/research/citations"),
      navItem("/admin/research/portal"), navItem("/admin/research/reports"), navItem("/admin/research/settings"),
    ],
  },
  {
    id: "store",
    label: "إدارة المتجر",
    icon: ShoppingBag,
    items: [
      navItem("/admin/bookings"),
      navItem("/admin/sound-center"),
      navItem("/admin/orders"),
      navItem("/admin/calendar"),
      navItem("/admin/qr-orders"),
      navItem("/admin/archive"),
      navItem("/admin/services"),
      navItem("/admin/koshas"),
      navItem("/admin/kosha-packages"),
      navItem("/admin/kosha-bookings"),
      navItem("/admin/invitations"),
      navItem("/admin/catering"),
      navItem("/admin/products"),
      navItem("/admin/bouquet-designer"),
      navItem("/admin/categories"),
      navItem("/admin/gallery"),
      navItem("/admin/delivery"),
      navItem("/admin/customers"),
      navItem("/admin/customer-hub"),
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
      navItem("/admin/production"),
      navItem("/admin/production/reports"),
      navItem("/admin/reserved-stock"),
      navItem("/admin/inventory-alerts"),
      navItem("/admin/inventory-value"),
      navItem("/admin/barcodes"),
      navItem("/admin/print-labels"),
      navItem("/admin/warehouse-transfers"),
      navItem("/admin/assets/new"),
      navItem("/admin/asset-gate"),
      navItem("/admin/asset-reports"),
      navItem("/admin/assets"),
      navItem("/admin/assets/depreciation-categories"),
      navItem("/admin/asset-movements"),
      navItem("/admin/maintenance-scheduler"),
      navItem("/admin/vehicles"),
    ],
  },
  {
    id: "hr",
    label: "الموارد البشرية",
    icon: Users,
    items: [
      navItem("/admin/staff"),
      navItem("/admin/attendance"),
      navItem("/admin/hr/salaries"),
      navItem("/admin/employee-advances"),
      navItem("/admin/employee-performance"),
      navItem("/admin/reports"),
    ],
  },
  {
    id: "management",
    label: "الإدارة",
    icon: ShieldCheck,
    items: [
      navItem("/admin/crews"),
      navItem("/admin/executive"),
      navItem("/admin/executive/ai-event-brain"),
      navItem("/admin/activity-log"),
      navItem("/admin/tasks"),
      navItem("/admin/approvals"),
      navItem("/admin/documents"),
      navItem("/admin/live-operations"),
      navItem("/admin/smart-search"),
      navItem("/admin/timelines"),
    ],
  },
  {
    id: "finance",
    label: "الإدارة المالية",
    icon: Wallet,
    items: [
      navItem("/admin/finance"),
      navItem("/admin/installments"),
      navItem("/admin/finance/master-cash"),
      navItem("/admin/finance/request"),
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
      navItem("/admin/inventory-value"),
      navItem("/admin/accounting"),
      navItem("/admin/business-analytics"),
      navItem("/admin/purchase-comparison"),
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
      navItem("/admin/document-scanner"),
      navItem("/admin/backup"),
      navItem("/admin/disaster-recovery"),
      navItem("/admin/invoice-designer"),
      navItem("/admin/report-designer"),
      navItem("/admin/sync-center"),
      navItem("/admin/settings/printer"),
      navItem("/admin/print-queue"),
      navItem("/admin/settings/telegram"),
      navItem("/admin/settings"),
    ],
  },
  {
    id: "site",
    label: "الموقع",
    icon: Store,
    items: [
      {
        href: "/",
        label: "رجوع إلى الموقع",
        icon: Home,
        perm: null,
        external: true,
      },
      {
        href: "/store",
        label: "فتح المتجر",
        icon: Store,
        perm: null,
        external: true,
      },
      {
        href: "/koshas",
        label: "فتح الكوشات",
        icon: Sparkles,
        perm: null,
        external: true,
      },
      {
        href: "/graduation",
        label: "فتح تجهيزات التخرج",
        icon: GraduationCap,
        perm: null,
        external: true,
      },
    ],
  },
  {
    id: "account",
    label: "الحساب",
    icon: LogOut,
    items: [{ label: "خروج", icon: LogOut, action: "logout" }],
  },
];

const ADMIN_NAV_ACCORDION_STORAGE_KEY = "ajn-admin-sidebar-open-groups";
const ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY = "ajn-admin-sidebar-hidden";

function isNavItem(item: NavEntry): item is NavItem {
  return "href" in item;
}

export function canSeeItem(me: AdminMe, item: NavEntry) {
  if (!isNavItem(item)) return true;
  if (item.adminOnly && me.role !== "admin") return false;
  if (item.anyPerm) return item.anyPerm.some((p) => hasPerm(me, p));
  return hasPerm(me, item.perm);
}

function itemIsActive(location: string, item: NavEntry) {
  return (
    isNavItem(item) &&
    !item.external &&
    (location === item.href || location.startsWith(item.href + "/"))
  );
}

function groupHasActiveItem(location: string, group: NavGroup) {
  return group.items.some((item) => itemIsActive(location, item));
}

function readOpenGroups(activeGroupId: string | null) {
  if (typeof window === "undefined")
    return activeGroupId ? [activeGroupId] : ["home"];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(ADMIN_NAV_ACCORDION_STORAGE_KEY) ?? "[]",
    );
    const next = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    if (activeGroupId && !next.includes(activeGroupId))
      next.push(activeGroupId);
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
    queryFn: () =>
      adminFetch<{ count: number }>("/admin/inventory-alerts?count=1"),
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
    setSidebarHidden(
      window.localStorage.getItem(ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY) === "1",
    );
  }, []);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location]);

  function toggleDesktopSidebar() {
    setSidebarHidden((current) => {
      const next = !current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          ADMIN_SIDEBAR_COLLAPSED_STORAGE_KEY,
          next ? "1" : "0",
        );
      }
      return next;
    });
  }

  return (
    <div className="admin-mobile-shell min-h-dvh min-w-0 bg-background flex overflow-x-hidden max-md:overflow-x-clip" dir="rtl">
      <aside
        className={`admin-premium-sidebar hidden md:flex fixed right-3 top-3 bottom-3 z-20 shrink-0 flex-col overflow-hidden rounded-[22px] border border-[#e8e1da] bg-[#fffdfa] shadow-[0_14px_45px_rgba(47,35,26,0.08)] transition-[width] duration-200 ${sidebarHidden ? "w-[88px]" : "w-[344px]"}`}
      >
        {sidebarHidden ? (
          <div className="flex h-full flex-col items-center gap-4 px-3 py-4">
            <button type="button" onClick={toggleDesktopSidebar} className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#eee5dc] bg-white p-2 shadow-sm" aria-label="توسيع القائمة">
              <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={42} height={42} decoding="async" className="h-10 w-10 object-contain" />
            </button>
            <AdminSidebarNav groups={NAV_GROUPS} me={me} location={location} lowStockCount={lowStockCount} newMessageCount={newMessageCount} onLogout={onLogout} onExpand={toggleDesktopSidebar} collapsed className="flex-1 overflow-y-auto" />
            <Link href="/admin/account" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fbf3ef] text-primary transition-colors hover:bg-[#f7e7df]" aria-label="الحساب والأجهزة" title={me.fullName || me.username}>
              <UserRound className="h-5 w-5" />
            </Link>
          </div>
        ) : (
          <>
            <SidebarBrand settings={settings} me={me} onCollapse={toggleDesktopSidebar} />
            <AdminSidebarNav groups={NAV_GROUPS} me={me} location={location} lowStockCount={lowStockCount} newMessageCount={newMessageCount} onLogout={onLogout} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" />
            <SidebarProfile me={me} onLogout={onLogout} />
          </>
        )}
      </aside>
      <div className="hidden md:flex fixed left-6 top-5 z-30 h-10 shrink-0 items-center gap-2">
        <AdminGlobalSearch />
        <AdminNotificationsBell />
      </div>
      <div
        className="admin-mobile-header md:hidden fixed top-0 inset-x-0 z-20 bg-card/95 border-b border-border/30 backdrop-blur pt-safe"
        dir="rtl"
        style={{ backgroundColor: "hsl(var(--sidebar) / 0.95)" }}
      >
        <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
              aria-label="فتح القائمة"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden h-10 w-12 shrink-0 items-center justify-center overflow-hidden min-[390px]:flex">
              <img
                src={logoSrc(settings)}
                alt={settings?.site_name ?? "AJN"}
                width={40}
                height={40}
                decoding="async"
                className="h-9 w-10 max-w-full shrink-0 object-contain"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="hidden text-[11px] text-muted-foreground min-[360px]:block">لوحة الإدارة</p>
              <p className="truncate text-sm font-semibold leading-tight text-foreground">
                {settings?.site_name ?? "مجموعة علي جان"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AdminGlobalSearch />
            <AdminNotificationsBell />
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
          <aside
            className="absolute right-0 top-0 flex h-[100dvh] w-[88vw] max-w-[390px] flex-col border-l border-[#e8e1da] bg-[#fffdfa] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl"
          >
            <div className="px-3 mb-4 flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <img
                  src={logoSrc(settings)}
                  alt={settings?.site_name ?? "AJN"}
                  width={96}
                  height={44}
                  decoding="async"
                  className="h-11 w-24 shrink-0 object-contain mb-2"
                />
                <p className="text-xs text-muted-foreground">لوحة الإدارة</p>
                <h2 className="truncate text-base font-bold text-foreground">
                  {settings?.site_name ?? "مجموعة علي جان"}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link href="/admin/account" onClick={() => setMobileSidebarOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground active:bg-muted" aria-label="الحساب والأجهزة"><UserRound className="h-5 w-5" /></Link>
                <button type="button" onClick={onLogout} className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground active:bg-destructive/10 active:text-destructive" aria-label="تسجيل الخروج"><LogOut className="h-5 w-5" /></button>
                <button type="button" onClick={() => setMobileSidebarOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground active:bg-muted" aria-label="إغلاق القائمة"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <AdminSidebarNav
              groups={NAV_GROUPS}
              me={me}
              location={location}
              lowStockCount={lowStockCount}
              newMessageCount={newMessageCount}
              onLogout={onLogout}
              onNavigate={() => setMobileSidebarOpen(false)}
              className="flex-1 overflow-y-auto px-1"
              compact
            />
          </aside>
        </div>
      )}
      <main
        className={`flex-1 min-w-0 overflow-x-hidden px-3 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[calc(4.75rem+env(safe-area-inset-top))] min-[390px]:px-4 max-md:overflow-x-clip md:p-6 md:pt-20 max-w-[1600px] w-full transition-[margin] duration-200 ${sidebarHidden ? "md:mr-[112px]" : "md:mr-[368px]"}`}
      >
        {children}
      </main>
    </div>
  );
}

function SidebarBrand({
  settings,
  me,
  onCollapse,
}: {
  settings: ReturnType<typeof usePublicSettings>["data"];
  me: AdminMe;
  onCollapse: () => void;
}) {
  return (
    <div className="relative overflow-hidden border-b border-[#eee5dc] px-5 pb-4 pt-5">
      <div className="pointer-events-none absolute -right-8 top-0 h-28 w-28 rounded-full bg-[#f9e9e2]/70 blur-2xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={118} height={48} decoding="async" className="h-12 w-28 object-contain object-right" />
          <p className="mt-2 text-[11px] font-medium tracking-wide text-[#a47d56]">AJN GROUP</p>
          <p className="truncate text-sm font-semibold text-[#1e293b]">{settings?.site_name ?? "مجموعة علي جان نهاد"}</p>
        </div>
        <button type="button" onClick={onCollapse} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#eee5dc] bg-white text-slate-600 shadow-sm transition-colors hover:bg-[#fbf3ef] hover:text-primary" aria-label="طي القائمة">
          <ChevronDown className="h-4 w-4 -rotate-90" />
        </button>
      </div>
      <Link href="/admin/account" className="relative mt-3 flex items-center gap-2 rounded-xl bg-[#fbf6f1] px-3 py-2 text-xs text-slate-600 transition-colors hover:bg-[#f7ece5]" title="الحساب والأجهزة">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-primary"><UserRound className="h-3.5 w-3.5" /></span>
        <span className="truncate">{me.fullName || me.username}{me.role === "admin" ? " · مدير النظام" : ""}</span>
      </Link>
    </div>
  );
}

function SidebarProfile({ me, onLogout }: { me: AdminMe; onLogout: () => void }) {
  const initials = (me.fullName || me.username || "A").trim().slice(0, 2);
  return (
    <div className="border-t border-[#eee5dc] bg-[#fffaf6] p-3">
      <div className="flex items-center gap-3 rounded-2xl border border-[#eee5dc] bg-white p-2.5 shadow-sm">
        <Link href="/admin/account" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f6e7df] text-sm font-bold text-primary" aria-label="الحساب والأجهزة">{initials}</Link>
        <Link href="/admin/account" className="min-w-0 flex-1" title="الحساب والأجهزة">
          <p className="truncate text-sm font-semibold text-[#1e293b]">{me.fullName || me.username}</p>
          <p className="mt-0.5 text-[11px] text-slate-500">{me.role === "admin" ? "مدير النظام" : "موظف"} <span className="mr-1 text-emerald-600">● متصل</span></p>
        </Link>
        <button type="button" onClick={onLogout} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-red-50 hover:text-destructive" aria-label="تسجيل الخروج" title="تسجيل الخروج"><LogOut className="h-4 w-4" /></button>
      </div>
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
  collapsed = false,
  onExpand,
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
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const visibleGroups = useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => canSeeItem(me, item)),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, me]);
  const activeGroupId =
    visibleGroups.find((group) => groupHasActiveItem(location, group))?.id ??
    null;
  const [openGroups, setOpenGroups] = useState<string[]>(() =>
    readOpenGroups(activeGroupId),
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    setOpenGroups((current) => {
      const next =
        activeGroupId && !current.includes(activeGroupId)
          ? [...current, activeGroupId]
          : current;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          ADMIN_NAV_ACCORDION_STORAGE_KEY,
          JSON.stringify(next),
        );
      }
      return next;
    });
  }, [activeGroupId]);

  function toggleGroup(groupId: string) {
    setOpenGroups((current) => {
      const isOpen = current.includes(groupId);
      const next =
        isOpen && groupId !== activeGroupId
          ? current.filter((item) => item !== groupId)
          : isOpen
            ? current
            : [...current, groupId];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          ADMIN_NAV_ACCORDION_STORAGE_KEY,
          JSON.stringify(next),
        );
      }
      return next;
    });
  }

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ar-IQ");
    if (!normalized) return visibleGroups;
    return visibleGroups
      .map((group) => {
        const groupMatches = group.label.toLocaleLowerCase("ar-IQ").includes(normalized);
        return {
          ...group,
          items: groupMatches
            ? group.items
            : group.items.filter((item) => item.label.toLocaleLowerCase("ar-IQ").includes(normalized)),
        };
      })
      .filter((group) => group.items.length > 0);
  }, [query, visibleGroups]);

  if (collapsed) {
    return (
      <nav className={`flex flex-col items-center gap-2 ${className}`} aria-label="قائمة لوحة الإدارة المصغرة">
        {visibleGroups.map((group) => {
          const GroupIcon = group.icon;
          const active = group.id === activeGroupId;
          return <button key={group.id} type="button" onClick={onExpand} className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-colors ${active ? "bg-[#f9e2e5] text-primary ring-1 ring-[#f3cdd3]" : "text-slate-500 hover:bg-[#fbf3ef] hover:text-primary"}`} aria-label={`توسيع القائمة للوصول إلى ${group.label}`} title={group.label}><GroupIcon className="h-5 w-5" /></button>;
        })}
      </nav>
    );
  }

  return (
    <nav className={`space-y-2 ${className}`} aria-label="قائمة لوحة الإدارة">
      <label className="relative mb-3 block">
        <SearchIconCompat className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="البحث في النظام..." className="h-10 w-full rounded-xl border border-[#e9e1da] bg-[#fcfaf8] py-2 pr-9 text-sm text-[#1e293b] outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10" aria-label="البحث في عناصر القائمة" />
      </label>
      {filteredGroups.map((group) => {
        const isOpen = query.trim() ? true : openGroups.includes(group.id);
        const active = group.id === activeGroupId;
        const GroupIcon = group.icon;
        return (
          <div key={group.id} className={`rounded-2xl border transition-colors ${active ? "border-[#f3d5d8] bg-[#fff9f8]" : "border-transparent hover:bg-[#fcf8f5]"}`}>
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={isOpen}
              className={`w-full flex min-w-0 items-center gap-3 rounded-2xl px-3 text-sm transition-colors ${compact ? "py-2.5" : "py-3"} ${active ? "text-primary" : "text-slate-700 hover:text-[#1e293b]"}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${active ? "bg-[#f9e2e5]" : "bg-[#f8f3ef] text-[#a47d56]"}`}><GroupIcon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1 truncate text-right font-semibold">
                {group.label}
              </span>
              <ChevronDown
                className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            <div
              className={`grid transition-all duration-200 ease-out ${isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
            >
              <div className="overflow-hidden">
                <div className="mx-2 mb-2 space-y-1 rounded-xl border border-[#eee5dc] bg-white/80 p-1.5">
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
  const baseClass = `w-full flex min-w-0 items-center gap-2.5 rounded-xl text-sm transition-colors ${
    compact ? "px-3 py-2.5" : "px-3 py-2.5"
  }`;
  if (!isNavItem(item)) {
    return (
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          onLogout();
        }}
        className={`${baseClass} text-slate-600 hover:bg-red-50 hover:text-destructive`}
      >
        <ItemIcon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-right font-medium">{item.label}</span>
      </button>
    );
  }

  const active = itemIsActive(location, item);
  const content = (
    <>
      <ItemIcon className="w-4 h-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-right">{item.label}</span>
      {item.href === "/admin/inventory-alerts" && lowStockCount > 0 && (
        <span className="shrink-0 rounded-full bg-status-warning/15 px-2 py-0.5 text-[11px] text-status-warning">
          {lowStockCount.toLocaleString("ar-IQ-u-nu-latn")}
        </span>
      )}
      {item.href === "/admin/messages" && newMessageCount > 0 && (
        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
          {newMessageCount.toLocaleString("ar-IQ-u-nu-latn")}
        </span>
      )}
    </>
  );

  if (item.external) {
    return (
      <a
        href={item.href}
        onClick={onNavigate}
        className={`${baseClass} text-slate-600 hover:bg-[#fbf3ef] hover:text-[#1e293b]`}
      >
        {content}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`${baseClass} ${active ? "bg-[#f9e2e5] text-primary shadow-[inset_3px_0_0_hsl(var(--primary))]" : "text-slate-600 hover:bg-[#fbf3ef] hover:text-[#1e293b]"}`}
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
      <h2 className="text-xl font-bold text-foreground mb-2">
        ليس لديك صلاحية
      </h2>
      <p className="text-muted-foreground text-sm">
        يرجى التواصل مع المدير لمنحك الوصول لهذا القسم.
      </p>
    </div>
  );
}

export { NAV as ADMIN_NAV };
