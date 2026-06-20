import { Link, useLocation } from "wouter";
import { Armchair, Heart, Images, Lock, MessageCircle, Moon, Route, ShoppingBag, Store, Sun, User, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetCart } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { buildWhatsAppLink } from "@/lib/order-stages";
import { deriveAlternateAppearance, hexToHsl } from "@/lib/appearance";
import { useThemeMode } from "@/lib/theme-mode";
import { useWishlist } from "@/lib/wishlist";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/language-switcher";

const NAV_CAMERA_SRC = "/images/nav-camera.png";

export function Navbar() {
  const [location] = useLocation();
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
  const effectiveAppearance = mode === "alt" && baseAppearance ? deriveAlternateAppearance(baseAppearance) : baseAppearance;
  const isDarkTheme = effectiveAppearance ? hexToHsl(effectiveAppearance.background).l < 55 : true;

  const cartItemCount = cart?.itemCount || 0;
  const waLink = settings?.whatsapp ? buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار") : "";

  const sections = [
    { href: "/", label: t("الرئيسية"), Icon: null, active: location === "/" },
    { href: "/services", label: t("الخدمات"), Icon: WandSparkles, active: location.startsWith("/services") },
    { href: "/store", label: t("المتجر"), Icon: Store, active: location.startsWith("/store") },
    { href: "/koshas", label: "الكوشات", Icon: Armchair, active: location.startsWith("/koshas") },
    { href: "/gallery", label: t("أعمالنا"), Icon: Images, active: location.startsWith("/gallery") },
    { href: "/track", label: t("تتبع الطلب"), Icon: Route, active: location.startsWith("/track") },
  ];

  return (
    <header className="sticky top-0 z-50 w-full" style={{ backgroundColor: "#0a0a0b" }}>
      {/* ===== Desktop: thin utility + actions bar ===== */}
      <div className="hidden border-b border-white/5 md:block" dir="rtl">
        <div className="container mx-auto flex h-12 items-center justify-between gap-4 px-4">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5">
            <span className="h-9 w-9 rounded-lg border border-[#D4B15A]/25 bg-[#D4B15A]/5 p-1 flex items-center justify-center overflow-hidden">
              <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={36} height={36} fetchPriority="high" decoding="async" className="h-full w-full object-contain" />
            </span>
            <span className="font-semibold text-sm text-white">{settings?.site_name ?? "مجموعة علي جان"}</span>
          </Link>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label="تبديل الوضع الليلي/النهاري"
              title={isDarkTheme ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي"}
              className="ajn-nav-icon h-9 w-9"
            >
              {isDarkTheme ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            <LanguageSwitcher />
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" aria-label={t("واتساب")} title={t("واتساب")}>
                <Button variant="ghost" size="icon" className="ajn-nav-icon h-9 w-9">
                  <MessageCircle className="h-5 w-5" />
                </Button>
              </a>
            )}
            <Link href="/profile" aria-label={t("حسابي")}>
              <Button variant="ghost" size="icon" className="ajn-nav-icon h-9 w-9">
                {customer?.avatarUrl ? (
                  <img src={customer.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover border border-[#D4B15A]/25" />
                ) : (
                  <User className="h-5 w-5" />
                )}
              </Button>
            </Link>
            <Link href="/favorites" aria-label="المفضّلة">
              <Button variant="ghost" size="icon" className="relative ajn-nav-icon h-9 w-9">
                <Heart className="h-5 w-5" />
                {wishlistCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#D4B15A] text-[10px] font-bold text-black">
                    {wishlistCount}
                  </span>
                )}
              </Button>
            </Link>
            <Link href="/cart" aria-label={t("السلة")}>
              <Button variant="ghost" size="icon" className="relative ajn-nav-icon h-9 w-9">
                <ShoppingBag className="h-5 w-5" />
                {cartItemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#D4B15A] text-[10px] font-bold text-black">
                    {cartItemCount}
                  </span>
                )}
              </Button>
            </Link>
            <Link href="/admin/login" aria-label="دخول الإدارة" title="دخول الإدارة">
              <Button variant="ghost" size="icon" className={`ajn-nav-icon h-9 w-9 ${location.startsWith("/admin") ? "is-active" : ""}`}>
                <Lock className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ===== Desktop: camera band with engraved sections ===== */}
      <div className="hidden md:block" style={{ backgroundColor: "#0a0a0b" }}>
        <div className="relative mx-auto w-full max-w-[1180px] h-[150px] lg:h-[180px] overflow-hidden">
          <img
            src={NAV_CAMERA_SRC}
            alt=""
            aria-hidden="true"
            decoding="async"
            fetchPriority="high"
            className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-center"
          />
          {/* Sections engraved on the flat front face */}
          <nav
            className="absolute left-[24%] right-[25%] top-[60%] flex -translate-y-1/2 items-center justify-between"
            dir="rtl"
            style={{ textShadow: "0 1px 3px rgba(0,0,0,0.65)" }}
          >
            {sections.map(({ href, label, Icon, active }) => (
              <Link
                key={href}
                href={href}
                className={`ajn-nav-link inline-flex items-center gap-1.5 text-sm font-medium tracking-wide ${active ? "is-active" : ""}`}
              >
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* ===== Mobile: compact header (bottom MobileNav handles primary nav) ===== */}
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="h-9 w-9 rounded-lg border border-[#D4B15A]/25 bg-[#D4B15A]/5 p-1 flex items-center justify-center overflow-hidden">
            <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={36} height={36} fetchPriority="high" decoding="async" className="h-full w-full object-contain" />
          </span>
          <span className="font-semibold text-base text-white">{settings?.site_name ?? "مجموعة علي جان"}</span>
        </Link>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="تبديل الوضع الليلي/النهاري"
            className="ajn-nav-icon"
          >
            {isDarkTheme ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
          <LanguageSwitcher />
          <Link href="/cart" aria-label={t("السلة")}>
            <Button variant="ghost" size="icon" className="relative ajn-nav-icon">
              <ShoppingBag className="h-5 w-5" />
              {cartItemCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#D4B15A] text-[10px] font-bold text-black">
                  {cartItemCount}
                </span>
              )}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
