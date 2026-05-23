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

declare global {
  interface Window {
    __AJN_PUBLIC_SETTINGS__?: PublicSettings;
  }
}

export const FALLBACK_LOGO_URL = "/images/logo-fallback.svg";

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
  const res = await fetch("/api/settings/public", { credentials: "include" });
  if (!res.ok) return DEFAULT_PUBLIC_SETTINGS;
  const data = await res.json().catch(() => ({}));
  return { ...DEFAULT_PUBLIC_SETTINGS, ...data, social_links: { ...DEFAULT_PUBLIC_SETTINGS.social_links, ...(data.social_links ?? {}) } };
}

export function initialPublicSettings(): PublicSettings {
  if (typeof window === "undefined") return DEFAULT_PUBLIC_SETTINGS;
  return window.__AJN_PUBLIC_SETTINGS__
    ? { ...DEFAULT_PUBLIC_SETTINGS, ...window.__AJN_PUBLIC_SETTINGS__ }
    : DEFAULT_PUBLIC_SETTINGS;
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ["settings", "public"],
    queryFn: fetchPublicSettings,
    initialData: initialPublicSettings,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function logoSrc(settings: PublicSettings | undefined): string {
  return settings?.logo_url || FALLBACK_LOGO_URL;
}
