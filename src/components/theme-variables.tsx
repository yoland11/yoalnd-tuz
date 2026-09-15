import { useEffect, useMemo } from "react";
import { appearanceCssVariables, deriveAlternateAppearance, googleFontsHref, normalizeAppearanceSettings } from "@/lib/appearance";
import { usePublicSettings } from "@/lib/public-settings";
import { useThemeMode } from "@/lib/theme-mode";

export function ThemeVariables() {
  const { data: settings } = usePublicSettings();
  const { mode } = useThemeMode();

  // Expose the active appearance as a marker on <html> so CSS can target the
  // alternate (dark) appearance. The alt palette flips the semantic tokens, but
  // components that hard-code neutral colours need a hook to be remapped (see the
  // "Alt appearance safety net" block in index.css). Light mode sets nothing.
  useEffect(() => {
    const root = document.documentElement;
    if (mode === "alt") root.setAttribute("data-ajn-appearance", "alt");
    else root.removeAttribute("data-ajn-appearance");
  }, [mode]);

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
