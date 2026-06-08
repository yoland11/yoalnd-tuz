import { Link, useLocation } from "wouter";
import { Facebook, Instagram, Lock, MapPin, MessageCircle, Phone, Search, ShoppingBag, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetCart } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { buildWhatsAppLink } from "@/lib/order-stages";

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

  const cartItemCount = cart?.itemCount || 0;
  const waLink = settings?.whatsapp ? buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار") : "";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60" style={{ backgroundColor: "hsl(var(--ajn-header) / 0.95)" }}>
      <div className="hidden border-b border-border/30 bg-card/80 md:block" dir="rtl" style={{ backgroundColor: "hsl(var(--ajn-header) / 0.82)" }}>
        <div className="container mx-auto flex h-9 items-center justify-between gap-4 px-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            {settings?.phone && (
              <a href={`tel:${settings.phone}`} className="inline-flex items-center gap-1.5 hover:text-primary transition-colors">
                <Phone className="h-3.5 w-3.5" /> {settings.phone}
              </a>
            )}
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-primary transition-colors">
                <MessageCircle className="h-3.5 w-3.5" /> واتساب
              </a>
            )}
            {settings?.map_url && (
              <a href={settings.map_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-primary transition-colors">
                <MapPin className="h-3.5 w-3.5" /> موقع المحل
              </a>
            )}
          </div>
          <div className="flex items-center gap-3">
            {settings?.social_links.instagram && (
              <a href={settings.social_links.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className="hover:text-primary transition-colors">
                <Instagram className="h-4 w-4" />
              </a>
            )}
            {settings?.social_links.facebook && (
              <a href={settings.social_links.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className="hover:text-primary transition-colors">
                <Facebook className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
      <div className="container mx-auto flex h-20 items-center justify-between px-4">
        
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="h-10 w-10 rounded-lg border border-primary/20 bg-primary/5 p-1.5 flex items-center justify-center overflow-hidden">
            <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={40} height={40} fetchPriority="high" decoding="async" className="h-full w-full object-contain" />
          </span>
          <div className="h-6 w-[1px] bg-border mx-2 hidden sm:block" />
          <span className="font-semibold text-lg hidden sm:block">{settings?.site_name ?? "مجموعة علي جان"}</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          <Link 
            href="/" 
            className={`text-sm font-medium transition-colors hover:text-primary ${location === '/' ? 'text-primary' : 'text-muted-foreground'}`}
          >
            الرئيسية
          </Link>
          <Link 
            href="/services" 
            className={`text-sm font-medium transition-colors hover:text-primary ${location.startsWith('/services') ? 'text-primary' : 'text-muted-foreground'}`}
          >
            الخدمات
          </Link>
          <Link 
            href="/store" 
            className={`text-sm font-medium transition-colors hover:text-primary ${location.startsWith('/store') ? 'text-primary' : 'text-muted-foreground'}`}
          >
            المتجر
          </Link>
          <Link 
            href="/gallery" 
            className={`text-sm font-medium transition-colors hover:text-primary ${location.startsWith('/gallery') ? 'text-primary' : 'text-muted-foreground'}`}
          >
            أعمالنا
          </Link>
          <Link 
            href="/track" 
            className={`text-sm font-medium transition-colors hover:text-primary ${location.startsWith('/track') ? 'text-primary' : 'text-muted-foreground'}`}
          >
            تتبع الطلب
          </Link>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2 md:gap-4">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary">
            <Search className="h-5 w-5" />
          </Button>
          <Link href="/profile">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary">
              {customer?.avatarUrl ? (
                <img src={customer.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover border border-primary/20" />
              ) : (
                <User className="h-5 w-5" />
              )}
            </Button>
          </Link>
          <Link href="/cart">
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-primary">
              <ShoppingBag className="h-5 w-5" />
              {cartItemCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {cartItemCount}
                </span>
              )}
            </Button>
          </Link>
          <Link href="/admin/login" aria-label="دخول الإدارة" title="دخول الإدارة">
            <Button
              variant="ghost"
              size="icon"
              className={`transition-colors ${location.startsWith('/admin') ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`}
            >
              <Lock className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
