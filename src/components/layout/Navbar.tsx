import { Link, useLocation } from "wouter";
import { Heart, Lock, Moon, ShoppingBag, Sun, User } from "lucide-react";
import { desktopNavItems } from "./nav-items";
import { Button } from "@/components/ui/button";
import { useGetCart } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { handleDefaultLogoError, logoSrc, usePublicSettings } from "@/lib/public-settings";
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
  const effectiveAppearance = mode === "alt" && baseAppearance
    ? deriveAlternateAppearance(baseAppearance)
    : baseAppearance;
  const isDarkTheme = effectiveAppearance
    ? hexToHsl(effectiveAppearance.background).l < 55
    : true;
  const cartItemCount = cart?.itemCount || 0;

  return (
    <header
      className={`ajn-site-header sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 pt-safe backdrop-blur-md md:pt-0 ${isFlowerStudio ? "flower-design-navbar" : ""}`}
    >
      <div className="container mx-auto flex h-16 min-w-0 items-center justify-between gap-3 px-4 md:h-[72px]">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={settings?.site_name ?? "AJN"}>
          <img
            src={logoSrc(settings)}
            alt={settings?.site_name ?? "AJN"}
            width={92}
            height={44}
            fetchPriority="high"
            decoding="async"
            onError={handleDefaultLogoError}
            className="h-9 w-[84px] object-contain object-right md:h-10 md:w-24"
          />
          <span className="hidden border-r border-border pr-3 text-sm font-medium text-muted-foreground lg:block">
            {settings?.site_name ?? "مجموعة علي جان"}
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="التنقل الرئيسي">
          {desktopNavItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={`relative inline-flex min-h-11 items-center gap-1.5 text-sm transition-colors ${
                item.match(location)
                  ? "font-medium text-foreground after:absolute after:bottom-0 after:right-0 after:h-px after:w-full after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.desktopIcon ? <item.Icon className="h-3.5 w-3.5 shrink-0" /> : null}
              {item.translate ? t(item.label) : item.label}
            </Link>
          ))}
        </nav>

        <div className="ajn-mobile-header-actions flex shrink-0 items-center gap-0.5 md:gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="تبديل الوضع الليلي/النهاري"
            title={isDarkTheme ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي"}
            className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {isDarkTheme ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </Button>

          <LanguageSwitcher />

          <Link href="/profile" className="hidden md:block" aria-label="الحساب">
            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground">
              {customer?.avatarUrl ? (
                <img src={customer.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <User className="h-[18px] w-[18px]" />
              )}
            </Button>
          </Link>

          <Link href="/favorites" aria-label="المفضّلة" className="hidden md:block">
            <Button variant="ghost" size="icon" className="relative h-10 w-10 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground">
              <Heart className="h-[18px] w-[18px]" />
              {wishlistCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background">
                  {wishlistCount}
                </span>
              )}
            </Button>
          </Link>

          <Link href="/cart" className="hidden md:block" aria-label="السلة">
            <Button variant="ghost" size="icon" className="relative h-10 w-10 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground">
              <ShoppingBag className="h-[18px] w-[18px]" />
              {cartItemCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-medium text-background">
                  {cartItemCount}
                </span>
              )}
            </Button>
          </Link>

          <Link href="/admin/login" aria-label="دخول الإدارة" title="دخول الإدارة" className="hidden md:block">
            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground">
              <Lock className="h-[17px] w-[17px]" />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
