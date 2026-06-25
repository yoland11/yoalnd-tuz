"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "base" | "alt";

const STORAGE_KEY = "ajn-theme-mode";
const CHANGE_EVENT = "ajn-theme-mode-change";

export function readThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "base";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "alt" ? "alt" : "base";
  } catch {
    return "base";
  }
}

export function setThemeMode(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* تجاهل أخطاء التخزين (الوضع الخاص) */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * وضع الثيم على مستوى المتصفح (اختيار الزائر بين الوضع الأصلي والبديل).
 * لا يؤثر على الثيم العام المحفوظ في إعدادات النظام — اختيار شخصي لكل زائر.
 */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode());

  useEffect(() => {
    const sync = () => setMode(readThemeMode());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = () => setThemeMode(readThemeMode() === "alt" ? "base" : "alt");

  return { mode, toggle, setMode: setThemeMode };
}
