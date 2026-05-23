import React from "react";
import { Navbar } from "./Navbar";
import { MobileNav } from "./MobileNav";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { buildWhatsAppLink } from "@/lib/order-stages";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: settings } = usePublicSettings();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <Navbar />
      <main className="flex-1 pb-16 md:pb-0">
        {children}
      </main>
      <MobileNav />
      <footer className="border-t border-border/40 py-6 text-center text-sm text-muted-foreground mt-auto" dir="rtl">
        <div className="container mx-auto px-4 flex flex-col items-center gap-3">
          <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} className="h-10 w-24 object-contain" />
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs md:text-sm">
            <span className="text-foreground font-medium">{settings?.site_name ?? "مجموعة علي جان"}</span>
            {settings?.phone && <a href={`tel:${settings.phone}`} className="hover:text-primary transition-colors">{settings.phone}</a>}
            {settings?.whatsapp && <a href={buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار")} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">واتساب</a>}
            {settings?.address && <span>{settings.address}</span>}
            {settings?.map_url && <a href={settings.map_url} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">موقع المحل</a>}
            {settings?.social_links.instagram && <a href={settings.social_links.instagram} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">إنستغرام</a>}
            {settings?.social_links.facebook && <a href={settings.social_links.facebook} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">فيسبوك</a>}
          </div>
          <p className="text-center text-[#858585c2] text-xs md:text-sm">© حقوق الملكية والتطوير: ENG — HUSSEIN ALI HAMMED</p>
        </div>
      </footer>
    </div>
  );
}
