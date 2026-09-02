import React from "react";
import { Navbar } from "./Navbar";
import { MobileNav } from "./MobileNav";
import { handleDefaultLogoError, logoSrc, usePublicSettings } from "@/lib/public-settings";
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
    <div dir={dir} lang={locale} className="mobile-app-shell min-h-[100dvh] min-w-0 flex flex-col bg-background text-foreground font-sans max-md:overflow-x-clip">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:right-4 focus:z-[100] focus:rounded-lg focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        {t("تخطّى إلى المحتوى الرئيسي")}
      </a>
      <Navbar />
      <main id="main-content" className="min-w-0 flex-1 pb-28 lg:pb-0">
        {children}
      </main>

      {settings?.whatsapp && (
        <a
          href={buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار")}
          target="_blank"
          rel="noreferrer"
          aria-label="تواصل واتساب"
          className="fixed bottom-[calc(7rem+env(safe-area-inset-bottom))] left-3 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted md:bottom-28 md:left-4 lg:bottom-5"
        >
          <MessageCircle className="h-5 w-5" />
        </a>
      )}

      <CustomerMessageWidget />
      <PwaInstallPrompt />
      <MobileNav />

      <footer className="mt-auto border-t border-border/50 bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] pt-10 text-sm text-muted-foreground lg:pb-10">
        <div className="container mx-auto grid gap-8 px-4 md:grid-cols-[0.9fr_1.1fr] md:items-end">
          <div>
            <img
              src={logoSrc(settings)}
              alt={settings?.site_name ?? "AJN"}
              width={112}
              height={48}
              loading="lazy"
              decoding="async"
              onError={handleDefaultLogoError}
              className="h-10 w-28 object-contain object-right"
            />
            <p className="mt-3 max-w-sm text-xs leading-6 text-muted-foreground">
              {settings?.site_name ?? "مجموعة علي جان"}
            </p>
          </div>

          <div className="space-y-4 md:text-left">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs md:justify-end md:text-sm">
              {settings?.phone && <a href={`tel:${settings.phone}`} className="transition-colors hover:text-foreground">{settings.phone}</a>}
              {settings?.whatsapp && <a href={buildWhatsAppLink(settings.whatsapp, "مرحباً، أريد الاستفسار")} target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">{t("واتساب")}</a>}
              {settings?.map_url && <a href={settings.map_url} target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">{t("موقع المحل")}</a>}
              {settings?.social_links.instagram && <a href={settings.social_links.instagram} target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">{t("إنستغرام")}</a>}
              {settings?.social_links.facebook && <a href={settings.social_links.facebook} target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">{t("فيسبوك")}</a>}
            </div>
            {settings?.address && <p className="text-xs md:text-sm">{settings.address}</p>}
            <p className="text-xs text-muted-foreground/70">© حقوق الملكية والتطوير: ENG — HUSSEIN ALI HAMMED</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
