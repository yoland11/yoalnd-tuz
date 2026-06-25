import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4" dir="rtl">
      <div className="w-full max-w-md text-center">
        <p className="text-8xl font-bold text-primary/20 mb-4 leading-none" aria-hidden="true">404</p>
        <h1 className="text-2xl font-bold text-foreground mb-3 text-balance">الصفحة غير موجودة</h1>
        <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
          الرابط الذي زرته لا يوجد أو نُقل إلى مكان آخر.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button className="gap-2 w-full sm:w-auto">
              <Home className="w-4 h-4" />
              العودة للرئيسية
            </Button>
          </Link>
          <Link href="/store">
            <Button variant="outline" className="gap-2 w-full sm:w-auto">
              <Search className="w-4 h-4" />
              تصفح المتجر
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
