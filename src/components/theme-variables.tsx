import { useMemo } from "react";
import { appearanceCssVariables } from "@/lib/appearance";
import { usePublicSettings } from "@/lib/public-settings";

export function ThemeVariables() {
  const { data: settings } = usePublicSettings();
  const cssText = useMemo(() => {
    const vars = appearanceCssVariables(settings?.appearance_settings);
    return `:root{${Object.entries(vars).map(([key, value]) => `${key}:${value};`).join("")}}`;
  }, [settings?.appearance_settings]);

  return <style id="ajn-theme-variables">{cssText}</style>;
}
