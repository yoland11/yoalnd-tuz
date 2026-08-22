import {
  Armchair, Flower2, GraduationCap, Heart, Home, Images, Lock, Route as RouteIcon,
  ShoppingBag, Store, User, WandSparkles, type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for site navigation. Consumed by the desktop Navbar,
 * the mobile bottom dock, and the "More" bottom sheet, so all three stay in
 * sync. Routes mirror the existing wouter routes exactly — nothing is invented.
 *
 * `surfaces` decides where each item appears:
 *   desktop → the top navbar link row
 *   dock    → the mobile bottom dock (primary items)
 *   sheet   → the "More" bottom sheet (secondary items)
 *
 * `translate`/`desktopIcon` preserve the exact current desktop rendering (Home
 * has no icon; a few labels were literal, not passed through t()).
 */
export type NavSurface = "desktop" | "dock" | "sheet";
export type NavItem = {
  key: string;
  href: string;
  label: string;
  Icon: LucideIcon;
  match: (loc: string) => boolean;
  translate: boolean;
  desktopIcon: boolean;
  surfaces: NavSurface[];
};

export const navigationItems: NavItem[] = [
  { key: "home", href: "/", label: "الرئيسية", Icon: Home, match: (l) => l === "/", translate: true, desktopIcon: false, surfaces: ["desktop", "dock"] },
  { key: "services", href: "/services", label: "الخدمات", Icon: WandSparkles, match: (l) => l.startsWith("/services"), translate: true, desktopIcon: true, surfaces: ["desktop", "sheet"] },
  { key: "store", href: "/store", label: "المتجر", Icon: Store, match: (l) => l.startsWith("/store"), translate: true, desktopIcon: true, surfaces: ["desktop", "dock"] },
  { key: "koshas", href: "/koshas", label: "الكوشات", Icon: Armchair, match: (l) => l.startsWith("/koshas"), translate: false, desktopIcon: true, surfaces: ["desktop", "dock"] },
  { key: "graduation", href: "/graduation", label: "تجهيزات التخرج", Icon: GraduationCap, match: (l) => l.startsWith("/graduation"), translate: false, desktopIcon: true, surfaces: ["desktop", "sheet"] },
  { key: "design", href: "/design", label: "تصميم باقة", Icon: Flower2, match: (l) => l.startsWith("/design"), translate: false, desktopIcon: true, surfaces: ["desktop", "sheet"] },
  { key: "gallery", href: "/gallery", label: "أعمالنا", Icon: Images, match: (l) => l.startsWith("/gallery"), translate: true, desktopIcon: true, surfaces: ["desktop", "sheet"] },
  { key: "track", href: "/track", label: "تتبع الطلب", Icon: RouteIcon, match: (l) => l.startsWith("/track"), translate: true, desktopIcon: true, surfaces: ["desktop", "sheet"] },
  { key: "cart", href: "/cart", label: "السلة", Icon: ShoppingBag, match: (l) => l.startsWith("/cart"), translate: true, desktopIcon: true, surfaces: ["dock"] },
  { key: "account", href: "/profile", label: "حسابي", Icon: User, match: (l) => l.startsWith("/profile") || l.startsWith("/account"), translate: true, desktopIcon: true, surfaces: ["dock"] },
  { key: "favorites", href: "/favorites", label: "المفضّلة", Icon: Heart, match: (l) => l.startsWith("/favorites"), translate: true, desktopIcon: false, surfaces: ["sheet"] },
  { key: "admin", href: "/admin/login", label: "دخول الإدارة", Icon: Lock, match: (l) => l.startsWith("/admin"), translate: false, desktopIcon: false, surfaces: ["sheet"] },
];

export const desktopNavItems = navigationItems.filter((i) => i.surfaces.includes("desktop"));
export const dockNavItems = navigationItems.filter((i) => i.surfaces.includes("dock"));
export const sheetNavItems = navigationItems.filter((i) => i.surfaces.includes("sheet"));

/** True when the current page belongs to the "More" sheet (drives its active state). */
export const isSheetRoute = (loc: string) => sheetNavItems.some((i) => i.match(loc));
