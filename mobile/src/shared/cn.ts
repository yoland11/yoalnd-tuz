/**
 * Minimal className combiner for NativeWind. We intentionally avoid
 * tailwind-merge here (its resolver targets web class semantics); NativeWind
 * applies the last-declared utility, so simple truthy joining is sufficient
 * and keeps the bundle small.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
