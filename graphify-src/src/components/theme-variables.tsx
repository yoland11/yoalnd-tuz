import { useMemo } from "react";
import { appearanceCssVariables, deriveAlternateAppearance, googleFontsHref, normalizeAppearanceSettings } from "@/lib/appearance";
import { usePublicSettings } from "@/lib/public-settings";
import { useThemeMode } from "@/lib/theme-mode";

export function ThemeVariables() {
  const { data: settings } = usePublicSettings();
  const { mode } = useThemeMode();

  const cssText = useMemo(() => {
    const base = settings?.appearance_settings;
    const effective = mode === "alt" ? deriveAlternateAppearance(base) : base;
    const vars = appearanceCssVariables(effective);
    return `:root{${Object.entries(vars).map(([key, value]) => `${key}:${value};`).join("")}}`;
  }, [settings?.appearance_settings, mode]);

  const fontsHref = useMemo(() => {
    const base = settings?.appearance_settings;
    const effective = mode === "alt" ? deriveAlternateAppearance(base) : base;
    const a = normalizeAppearanceSettings(effective);
    return googleFontsHref(a.headingFont, a.bodyFont);
  }, [settings?.appearance_settings, mode]);

  return (
    <>
      {fontsHref ? <link rel="stylesheet" href={fontsHref} /> : null}
      <style id="ajn-theme-variables">{cssText}</style>
    </>
  );
}
