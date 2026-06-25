import { ExternalLink, MapPin, Route } from "lucide-react";
import { cn } from "@/lib/utils";

function mapsLink(mapUrl?: string | null, address?: string | null): string {
  if (mapUrl?.trim()) return mapUrl.trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address ?? "AJN")}`;
}

function embedUrl(mapUrl?: string | null, address?: string | null): string {
  const query = address?.trim() || mapUrl?.trim() || "AJN";
  return `https://maps.google.com/maps?output=embed&q=${encodeURIComponent(query)}`;
}

export function LocationMapCard({
  mapUrl,
  address,
  title = "الموقع",
  compact = false,
  className,
}: {
  mapUrl?: string | null;
  address?: string | null;
  title?: string;
  compact?: boolean;
  className?: string;
}) {
  if (!mapUrl && !address) return null;
  const openUrl = mapsLink(mapUrl, address);

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border/30 bg-card", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border/25 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {address && <p className="truncate text-xs text-muted-foreground">{address}</p>}
          </div>
        </div>
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20"
        >
          <Route className="h-3.5 w-3.5" />
          فتح
        </a>
      </div>
      {!compact && (
        <iframe
          title={title}
          src={embedUrl(mapUrl, address)}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="h-56 w-full bg-background"
        />
      )}
      {compact && (
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ExternalLink className="h-4 w-4" />
          فتح الموقع على Google Maps
        </a>
      )}
    </div>
  );
}
