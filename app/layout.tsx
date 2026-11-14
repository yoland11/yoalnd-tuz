import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { DirectionProvider } from "@radix-ui/react-direction";
import "@/index.css";
import { getCachedPublicSettings } from "@/server/public-settings";
import { INTRO_CONTROL, INTRO_DECIDE, INTRO_IMAGES } from "@/lib/site-intro";

// Public settings are sourced from the live database. Rendering the root
// layout dynamically keeps the production build independent from credentials
// while preserving runtime error visibility if the database is unavailable.
export const dynamic = "force-dynamic";

const cairo = localFont({
  src: [
    { path: "../public/fonts/Cairo-Variable.ttf", weight: "400 700", style: "normal" },
  ],
  variable: "--font-cairo",
  display: "swap",
});

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
  width: "device-width",
  initialScale: 1,
  // Enables env(safe-area-inset-*) so content clears the notch and the browser/home bars on mobile.
  viewportFit: "cover",
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
    // The opening-intro flag is set on <html> by an inline script before React hydrates.
    <html lang="ar" dir="rtl" className={cairo.variable} suppressHydrationWarning>
      <head>
        <script id="ajn-intro-decide" dangerouslySetInnerHTML={{ __html: INTRO_DECIDE }} />
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
        {/* Opening intro: hidden unless <html data-ajn-intro> (src/lib/site-intro.ts). */}
        <div id="ajn-intro" className="ajn-intro" role="presentation">
          <div className="ajn-intro__glow" aria-hidden="true" />
          <div className="ajn-intro__stage" aria-hidden="true">
            <div className="ajn-intro__emblem">
              <svg className="ajn-intro__ring" viewBox="0 0 794 735" aria-hidden="true">
                <defs>
                  <linearGradient id="ajn-intro-gold" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#fff3c4" />
                    <stop offset="0.45" stopColor="#d4af4f" />
                    <stop offset="1" stopColor="#8a6a24" />
                  </linearGradient>
                  <linearGradient id="ajn-intro-silver" x1="1" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset="0.5" stopColor="#c9ccd2" />
                    <stop offset="1" stopColor="#7d828a" />
                  </linearGradient>
                </defs>
                <ellipse cx="407" cy="367.5" rx="370" ry="353.5" pathLength={1} stroke="url(#ajn-intro-gold)" transform="rotate(-90 407 367.5)" />
                <ellipse cx="407" cy="367.5" rx="370" ry="353.5" pathLength={1} stroke="url(#ajn-intro-silver)" transform="translate(814 0) scale(-1 1) rotate(-90 407 367.5)" />
              </svg>
              <span className="ajn-intro__flare" />
              <img className="ajn-intro__emblem-img" src={INTRO_IMAGES[0]} width={794} height={735} alt="" decoding="async" loading="lazy" />
              <span className="ajn-intro__shine" />
              <span className="ajn-intro__sparks"><i /><i /><i /><i /><i /><i /></span>
            </div>
            <img className="ajn-intro__wordmark" src={INTRO_IMAGES[1]} width={878} height={126} alt="" decoding="async" loading="lazy" />
            <span className="ajn-intro__rule" />
            <p className="ajn-intro__welcome">أهلاً وسهلاً بكم</p>
            <p className="ajn-intro__tagline">{settings.receipt_brand?.tagline || "لتنظيم كافة المناسبات"}</p>
          </div>
          <button type="button" className="ajn-intro__skip" aria-label="تخطي الافتتاحية والدخول إلى الموقع">تخطي</button>
        </div>
        <script id="ajn-intro-control" dangerouslySetInnerHTML={{ __html: INTRO_CONTROL }} />
        {/* Radix falls back to ltr without a provider; give it the document's
            direction. Pages that switch language nest their own provider. */}
        <DirectionProvider dir="rtl">{children}</DirectionProvider>
      </body>
    </html>
  );
}
