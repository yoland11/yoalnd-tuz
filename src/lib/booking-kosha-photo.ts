export type BookedKoshaReference = {
  kind: "kosha" | "package";
  id: number;
  name: string;
};

export type BookedKoshaPhoto = BookedKoshaReference & { imageUrl: string | null };

function positiveId(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function name(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// IDs are scoped to their original catalogue: a package ID is not a Kosha ID.
// Native booking foreign keys remain authoritative; service orders also support
// the current unified form's selection and the older explicit foreign keys.
export function resolveBookedKosha(
  source: "kosha" | "service",
  row: { koshaId?: unknown; packageId?: unknown; packageName?: unknown },
  details: Record<string, unknown>,
): BookedKoshaReference | null {
  if (source === "service" && details.koshaSelection != null) {
    const selection = details.koshaSelection as Record<string, unknown>;
    const id = positiveId(selection.id);
    if (!id || !["custom", "package"].includes(String(selection.mode))) return null;
    const kind = selection.mode === "package" ? "package" : "kosha";
    return { kind, id, name: name(selection.name, kind === "package" ? "الباقة المحجوزة" : "الكوشة المحجوزة") };
  }
  const values = source === "kosha" ? row : details;
  const koshaId = positiveId(values.koshaId);
  if (koshaId) return { kind: "kosha", id: koshaId, name: "الكوشة المحجوزة" };
  const packageId = positiveId(values.packageId);
  return packageId ? { kind: "package", id: packageId, name: name(values.packageName, "الباقة المحجوزة") } : null;
}
