import React from "react";
import { Navbar } from "./Navbar";
import { MobileNav } from "./MobileNav";
import { logoSrc, usePublicSettings } from "@/lib/public-settings";
import { buildWhatsAppLink } from "@/lib/order-stages";
import { MessageCircle } from "lucide-react";
import { CustomerMessageWidget } from "@/components/customer-message-widget";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { useLocale, useT } from "@/lib/i18n";

export function Layout({ children }: { children: React.ReactNode }) {
  const { data: settings } = usePublicSettings();
  const { locale, dir } = useLocale();
  const t = useT();

  return (
    <div dir={dir} lang={locale} className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:right-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
      >
        {t("تخطّى إلى المحتوى الرئيسي")}
      </a>
      <Navbar />
      <main id="main-content" className="flex-1 pb-16 md:pb-0">
        {children}
      </main>
      {settings?.whatsapp && (
        <a
          href={buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار")}
          target="_blank"
          rel="noreferrer"
          aria-label="تواصل واتساب"
          className="fixed bottom-20 left-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-status-success/30 bg-status-success text-white shadow-lg shadow-black/30 transition-transform hover:scale-105 md:bottom-6"
        >
          <MessageCircle className="h-6 w-6" />
        </a>
      )}
      <CustomerMessageWidget />
      <PwaInstallPrompt />
      <MobileNav />
      <footer className="border-t border-border/40 pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-6 text-center text-sm text-muted-foreground mt-auto" style={{ backgroundColor: "hsl(var(--ajn-footer))" }}>
        <div className="container mx-auto px-4 flex flex-col items-center gap-3">
          <img src={logoSrc(settings)} alt={settings?.site_name ?? "AJN"} width={96} height={40} loading="lazy" decoding="async" className="h-10 w-24 object-contain" />
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs md:text-sm">
            <span className="text-foreground font-medium">{settings?.site_name ?? "مجموعة علي جان"}</span>
            {settings?.phone && <a href={`tel:${settings.phone}`} className="hover:text-primary transition-colors">{settings.phone}</a>}
            {settings?.whatsapp && <a href={buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار")} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{t("واتساب")}</a>}
            {settings?.address && <span>{settings.address}</span>}
            {settings?.map_url && <a href={settings.map_url} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{t("موقع المحل")}</a>}
            {settings?.social_links.instagram && <a href={settings.social_links.instagram} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{t("إنستغرام")}</a>}
            {settings?.social_links.facebook && <a href={settings.social_links.facebook} target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">{t("فيسبوك")}</a>}
          </div>
          <p className="text-center text-[#858585c2] text-xs md:text-sm">© حقوق الملكية والتطوير: ENG — HUSSEIN ALI HAMMED</p>
        </div>
      </footer>
    </div>
  );
}
