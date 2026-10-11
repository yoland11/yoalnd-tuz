/** Aerial photography is one optional charge within the existing booking total. */
export function aerialPhotographyCharge(enabled: boolean, rawPrice: unknown): number | null {
  if (!enabled) return 0;
  if (rawPrice === null || rawPrice === undefined || String(rawPrice).trim() === "") return null;
  const price = Number(rawPrice);
  return Number.isFinite(price) && price > 0 ? price : null;
}
