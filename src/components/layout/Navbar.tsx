import { Link, useLocation } from "wouter";
import {
  Facebook,
  Heart,
  Instagram,
  Lock,
  MapPin,
  MessageCircle,
  Moon,
  Phone,
  Search,
  ShoppingBag,
  Sun,
  User,
} from "lucide-react";
import { desktopNavItems } from "./nav-items";
import { Button } from "@/components/ui/button";
import { useGetCart } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { handleDefaultLogoError, logoSrc, usePublicSettings } from "@/lib/public-settings";
import { buildWhatsAppLink } from "@/lib/order-stages";
import { deriveAlternateAppearance, hexToHsl } from "@/lib/appearance";
import { useThemeMode } from "@/lib/theme-mode";
import { useWishlist } from "@/lib/wishlist";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";

export function Navbar() {
  const [location] = useLocation();
  const isFlowerStudio = location.startsWith("/design");
  const { data: cart } = useGetCart();
  const { data: settings } = usePublicSettings();
  const { data: customer } = useQuery({
    queryKey: ["auth", "me", "navbar"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { mode, toggle } = useThemeMode();
  const { count: wishlistCount } = useWishlist();
  const t = useT();
  const baseAppearance = settings?.appearance_settings;
  const effectiveAppearance =
    mode === "alt" && baseAppearance
      ? deriveAlternateAppearance(baseAppearance)
      : baseAppearance;
  const isDarkTheme = effectiveAppearance
    ? hexToHsl(effectiveAppearance.background).l < 55
    : true;

  const cartItemCount = cart?.itemCount || 0;
  const waLink = settings?.whatsapp
    ? buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار")
    : "";

  return (
    <header
      className={`ajn-site-header sticky top-0 z-50 w-full border-b border-[#eeeae5] bg-white pt-safe md:pt-0 ${isFlowerStudio ? "flower-design-navbar" : ""}`}
    >
      <div
        className={`hidden border-b border-[#eeeae5] bg-[#faf9f7] md:block ${isFlowerStudio ? "flower-design-navbar__top" : ""}`}
        dir="rtl"
      >
        <div className="mx-auto flex h-9 w-[min(1420px,calc(100%-112px))] items-center justify-between gap-4 text-xs text-[#77716a]">
          <div className="flex items-center gap-4">
            {settings?.phone && (
              <a
                href={`tel:${settings.phone}`}
                className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
              >
                <Phone className="h-3.5 w-3.5" /> {settings.phone}
              </a>
            )}
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
              >
                <MessageCircle className="h-3.5 w-3.5" /> {t("واتساب")}
              </a>
            )}
            {settings?.map_url && (
              <a
                href={settings.map_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-primary transition-colors"
              >
                <MapPin className="h-3.5 w-3.5" /> {t("موقع المحل")}
              </a>
            )}
          </div>
          <div className="flex items-center gap-3">
            {settings?.social_links.instagram && (
              <a
                href={settings.social_links.instagram}
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="hover:text-primary transition-colors"
              >
                <Instagram className="h-4 w-4" />
              </a>
            )}
            {settings?.social_links.facebook && (
              <a
                href={settings.social_links.facebook}
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
                className="hover:text-primary transition-colors"
              >
                <Facebook className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="mx-auto flex h-16 min-w-0 w-full items-center justify-between gap-2 px-4 md:h-[86px] md:w-[min(1420px,calc(100%-112px))] md:px-0">
        {/* Logo */}
        <Link href="/" className="flex min-w-0 shrink items-center" aria-label={settings?.site_name ?? "AJN"}>
          <img
            src={logoSrc(settings)}
            alt={settings?.site_name ?? "AJN"}
            width={120}
            height={48}
            fetchPriority="high"
            decoding="async"
            onError={handleDefaultLogoError}
            className="h-11 w-[116px] object-contain"
          />
        </Link>

        {/* Desktop Navigation — driven by the shared navigationItems source. */}
        <nav className="hidden md:flex items-center gap-8">
          {desktopNavItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`ajn-nav-link ${item.desktopIcon ? "inline-flex items-center gap-1.5 " : ""}text-sm font-medium ${item.match(location) ? "is-active" : ""}`}
            >
              {item.desktopIcon ? <item.Icon className="h-3.5 w-3.5 shrink-0" /> : null}
              {item.translate ? t(item.label) : item.label}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="ajn-mobile-header-actions flex shrink-0 items-center gap-1 md:gap-3">
          <Link href="/store" className="hidden lg:flex h-10 w-60 items-center gap-2 rounded-full bg-[#f7f5f2] px-4 text-sm text-[#9a948c] transition-colors hover:bg-[#f3efe9]">
            <Search className="h-[18px] w-[18px] shrink-0 stroke-[1.5]" aria-hidden="true" />
            <span>ابحث عن منتج…</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="تبديل الوضع الليلي/النهاري"
            title={
              isDarkTheme
                ? "التبديل إلى الوضع النهاري"
                : "التبديل إلى الوضع الليلي"
            }
            className="ajn-nav-icon"
          >
            {isDarkTheme ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>
          <LanguageSwitcher />
          <Link href="/profile" className="hidden md:block">
            <Button variant="ghost" size="icon" className="ajn-nav-icon">
              {customer?.avatarUrl ? (
                <img
                  src={customer.avatarUrl}
                  alt=""
                  className="h-7 w-7 rounded-full object-cover border border-primary/20"
                />
              ) : (
                <User className="h-5 w-5" />
              )}
            </Button>
          </Link>
          <Link href="/favorites" aria-label="المفضّلة" className="hidden md:block">
            <Button
              variant="ghost"
              size="icon"
              className="relative ajn-nav-icon"
            >
              <Heart className="h-5 w-5" />
              {wishlistCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {wishlistCount}
                </span>
              )}
            </Button>
          </Link>
          <Link href="/cart" className="hidden md:block">
            <Button
              variant="ghost"
              size="icon"
              className="relative ajn-nav-icon"
            >
              <ShoppingBag className="h-5 w-5" />
              {cartItemCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {cartItemCount}
                </span>
              )}
            </Button>
          </Link>
          <Link
            href="/admin/login"
            aria-label="دخول الإدارة"
            title="دخول الإدارة"
            className="hidden md:block"
          >
            <Button
              variant="ghost"
              size="icon"
              className={`ajn-nav-icon ${location.startsWith("/admin") ? "is-active" : ""}`}
            >
              <Lock className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
