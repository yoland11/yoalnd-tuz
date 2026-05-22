import { Link, useLocation } from "wouter";
import { Search, ShoppingBag, User, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGetCart } from "@workspace/api-client-react";

export function Navbar() {
  const [location] = useLocation();
  const { data: cart } = useGetCart();

  const cartItemCount = cart?.itemCount || 0;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-20 items-center justify-between px-4">
        
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <span className="font-bold text-xl tracking-tight text-primary uppercase">AJN</span>
          <div className="h-6 w-[1px] bg-border mx-2 hidden sm:block" />
          <span className="font-semibold text-lg hidden sm:block">مجموعة علي جان</span>
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
          <Link href="/account">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-primary">
              <User className="h-5 w-5" />
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