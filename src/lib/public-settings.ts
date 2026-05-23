import { useQuery } from "@tanstack/react-query";

export type PublicSettings = {
  site_name: string;
  phone: string;
  whatsapp: string;
  address: string;
  city: string;
  map_url: string;
  social_links: {
    instagram: string;
    facebook: string;
    whatsapp: string;
  };
  logo_url: string;
};

export const FALLBACK_LOGO_URL = "/favicon.svg";

export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  site_name: "مجموعة علي جان",
  phone: "07701234567",
  whatsapp: "07701234567",
  address: "طوزخورماتو، العراق",
  city: "طوزخورماتو",
  map_url: "",
  social_links: { instagram: "", facebook: "", whatsapp: "" },
  logo_url: "",
};

export async function fetchPublicSettings(): Promise<PublicSettings> {
  const res = await fetch("/api/settings/public", { credentials: "include", cache: "no-store" });
  if (!res.ok) return DEFAULT_PUBLIC_SETTINGS;
  const data = await res.json().catch(() => ({}));
  return { ...DEFAULT_PUBLIC_SETTINGS, ...data, social_links: { ...DEFAULT_PUBLIC_SETTINGS.social_links, ...(data.social_links ?? {}) } };
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ["settings", "public"],
    queryFn: fetchPublicSettings,
    staleTime: 30_000,
  });
}

export function logoSrc(settings: PublicSettings | undefined): string {
  return settings?.logo_url || FALLBACK_LOGO_URL;
}
