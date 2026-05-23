import { unstable_cache } from "next/cache";
import { db, settingsTable } from "@workspace/db";

export const PUBLIC_SETTINGS_TAG = "ajn-public-settings";
export const PUBLIC_SETTINGS_REVALIDATE_SECONDS = 300;

export const DEFAULT_SITE_SETTINGS: Record<string, any> = {
  siteName: "مجموعة علي جان",
  logoUrl: "",
  phones: ["07701234567"],
  social: { instagram: "", facebook: "", whatsapp: "" },
  paymentQr: "",
  packagingFee: 2000,
  deliveryFee: 5000,
  deliveryTime: "1-3 أيام",
  address: "طوزخورماتو، العراق",
  city: "طوزخورماتو",
  mapUrl: "",
};

export function cleanPublicUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/")) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "";
  }
}

export async function loadSiteSettings(): Promise<Record<string, any>> {
  const rows = await db.query.settingsTable.findMany();
  const result: Record<string, any> = {
    ...DEFAULT_SITE_SETTINGS,
    social: { ...DEFAULT_SITE_SETTINGS.social },
  };
  for (const row of rows) result[row.key] = row.value;
  result.social = { ...DEFAULT_SITE_SETTINGS.social, ...(result.social ?? {}) };
  result.phones = Array.isArray(result.phones)
    ? result.phones
    : [String(result.phone ?? "")].filter(Boolean);
  return result;
}

export function publicSettingsPayload(settings: Record<string, any>) {
  const phone = String(settings.phones?.[0] ?? settings.phone ?? "").trim();
  const social = settings.social && typeof settings.social === "object" ? settings.social : {};
  return {
    site_name: String(settings.siteName ?? DEFAULT_SITE_SETTINGS.siteName),
    phone,
    whatsapp: String(social.whatsapp || settings.whatsapp || phone || ""),
    address: String(settings.address ?? ""),
    city: String(settings.city ?? ""),
    map_url: cleanPublicUrl(settings.mapUrl ?? settings.map_url ?? ""),
    social_links: {
      instagram: cleanPublicUrl(social.instagram),
      facebook: cleanPublicUrl(social.facebook),
      whatsapp: String(social.whatsapp || ""),
    },
    logo_url: cleanPublicUrl(settings.logoUrl ?? settings.logo_url ?? ""),
  };
}

async function loadPublicSettings() {
  try {
    return publicSettingsPayload(await loadSiteSettings());
  } catch (err) {
    console.warn("public settings load failed", err);
    return publicSettingsPayload(DEFAULT_SITE_SETTINGS);
  }
}

export const getCachedPublicSettings = unstable_cache(
  loadPublicSettings,
  ["ajn-public-settings-v2"],
  {
    revalidate: PUBLIC_SETTINGS_REVALIDATE_SECONDS,
    tags: [PUBLIC_SETTINGS_TAG],
  },
);
