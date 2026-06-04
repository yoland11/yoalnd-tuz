import type { Metadata, Viewport } from "next";
import "@/index.css";
import { getCachedPublicSettings } from "@/server/public-settings";

export const metadata: Metadata = {
  title: "مجموعة علي جان",
  description: "منصة مجموعة علي جان للخدمات والمتجر والتتبع",
  applicationName: "AJN",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AJN",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#C9A84C",
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
        <link rel="apple-touch-icon" href="/icons/icon-180.png" />
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
