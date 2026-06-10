"use client";

import { useLocale, type Locale } from "@/lib/i18n";

/**
 * ترجمة محتوى قاعدة البيانات (أسماء/أوصاف المنتجات والأقسام والخدمات).
 * العربية هي المرجع الأساسي، وإذا كانت الترجمة فارغة يرجع تلقائياً للعربية.
 */
function pickLocalized(arValue: unknown, kuValue: unknown, trValue: unknown, locale: Locale): string {
  const ar = typeof arValue === "string" ? arValue : "";
  if (locale === "ku") {
    const ku = typeof kuValue === "string" ? kuValue.trim() : "";
    return ku || ar;
  }
  if (locale === "tr") {
    const tr = typeof trValue === "string" ? trValue.trim() : "";
    return tr || ar;
  }
  return ar;
}

export function localizedName(item: any, locale: Locale): string {
  if (!item) return "";
  return pickLocalized(item.nameAr ?? item.name, item.nameKu, item.nameTr, locale);
}

export function localizedDescription(item: any, locale: Locale): string {
  if (!item) return "";
  return pickLocalized(item.descriptionAr ?? item.description, item.descriptionKu, item.descriptionTr, locale);
}

/** خطّاف يعيد دوال ترجمة المحتوى حسب اللغة الحالية. */
export function useContentLocalizer() {
  const { locale } = useLocale();
  return {
    locale,
    name: (item: any) => localizedName(item, locale),
    description: (item: any) => localizedDescription(item, locale),
  };
}
