import { ScanLine } from "lucide-react";

export type ScanOwnerType =
  | "customer" | "staff" | "order" | "booking" | "graduation_order" | "printing_job";

/**
 * Opens the document scanner with the owner pre-filled, so a scan started from
 * a customer / employee / order screen comes back already linked.
 *
 * Rendered as a plain link (not a router push) because the scanner reads its
 * prefill from the query string on mount.
 */
export default function ScanDocumentButton({
  ownerType,
  ownerId,
  ownerName,
  docType,
  label = "مسح مستمسك",
  className,
}: {
  ownerType: ScanOwnerType;
  ownerId: number | string;
  ownerName?: string | null;
  /** Optional document type to preselect, e.g. "national_id". */
  docType?: string;
  label?: string;
  className?: string;
}) {
  const params = new URLSearchParams({ ownerType, ownerId: String(ownerId) });
  if (ownerName) params.set("ownerName", ownerName);
  if (docType) params.set("docType", docType);

  return (
    <a
      href={`/admin/document-scanner?${params.toString()}`}
      className={
        className ??
        "inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border/40 text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
      }
    >
      <ScanLine className="w-3.5 h-3.5" /> {label}
    </a>
  );
}
