import type { Metadata } from "next";
import "@/index.css";
import { getCachedPublicSettings } from "@/server/public-settings";

export const metadata: Metadata = {
  title: "مجموعة علي جان",
  description: "منصة مجموعة علي جان للخدمات والمتجر والتتبع",
};

const FALLBACK_LOGO_URL = "/images/logo-fallback.svg";

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getCachedPublicSettings();
  const logoUrl = settings.logo_url || FALLBACK_LOGO_URL;
  const shouldPreloadLogo = logoUrl.startsWith("/") || logoUrl.startsWith("http://") || logoUrl.startsWith("https://");

  return (
    <html lang="ar" dir="rtl">
      <head>
        {shouldPreloadLogo && <link rel="preload" as="image" href={logoUrl} fetchPriority="high" />}
      </head>
      <body>
        <script
          id="ajn-public-settings"
          dangerouslySetInnerHTML={{
            __html: `window.__AJN_PUBLIC_SETTINGS__=${serializeForInlineScript(settings)};`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
