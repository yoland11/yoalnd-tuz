import { Link, useLocation } from "wouter";
import { Armchair, Home, ShoppingBag, Store, User, WandSparkles } from "lucide-react";
import { useGetCart } from "@workspace/api-client-react";
import { useT } from "@/lib/i18n";

export function MobileNav() {
  const [location] = useLocation();
  const { data: cart } = useGetCart();
  const t = useT();

  const cartItemCount = cart?.itemCount || 0;

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background pb-safe">
      <div className="flex justify-around items-center h-16">
        <Link href="/" className={`ajn-nav-link flex flex-col items-center justify-center w-full h-full space-y-1 ${location === '/' ? 'is-active' : ''}`}>
          <Home className="h-5 w-5" />
          <span className="text-[11px] font-medium">{t("الرئيسية")}</span>
        </Link>

        <Link href="/services" className={`ajn-nav-link flex flex-col items-center justify-center w-full h-full space-y-1 ${location.startsWith('/services') ? 'is-active' : ''}`}>
          <WandSparkles className="h-5 w-5" />
          <span className="text-[11px] font-medium">{t("الخدمات")}</span>
        </Link>

        <Link href="/store" className={`ajn-nav-link flex flex-col items-center justify-center w-full h-full space-y-1 ${location.startsWith('/store') ? 'is-active' : ''}`}>
          <Store className="h-5 w-5" />
          <span className="text-[11px] font-medium">{t("المتجر")}</span>
        </Link>

        <Link href="/koshas" className={`ajn-nav-link flex flex-col items-center justify-center w-full h-full space-y-1 ${location.startsWith('/koshas') ? 'is-active' : ''}`}>
          <Armchair className="h-5 w-5" />
          <span className="text-[11px] font-medium">الكوشات</span>
        </Link>

        <Link href="/cart" className={`ajn-nav-link relative flex flex-col items-center justify-center w-full h-full space-y-1 ${location.startsWith('/cart') ? 'is-active' : ''}`}>
          <div className="relative">
            <ShoppingBag className="h-5 w-5" />
            {cartItemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {cartItemCount}
              </span>
            )}
          </div>
          <span className="text-[11px] font-medium">{t("السلة")}</span>
        </Link>

        <Link href="/profile" className={`ajn-nav-link flex flex-col items-center justify-center w-full h-full space-y-1 ${location.startsWith('/profile') || location.startsWith('/account') ? 'is-active' : ''}`}>
          <User className="h-5 w-5" />
          <span className="text-[11px] font-medium">{t("حسابي")}</span>
        </Link>
      </div>
    </div>
  );
}
