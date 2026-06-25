"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "ajn-wishlist";
const CHANGE_EVENT = "ajn-wishlist-change";

function read(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "number") : [];
  } catch {
    return [];
  }
}

function write(ids: number[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* تجاهل أخطاء التخزين */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * قائمة المفضّلة على مستوى المتصفح (تعمل للزائر المسجّل وغير المسجّل).
 * لا تحتاج قاعدة بيانات — تُخزَّن في localStorage وتتزامن بين كل المكوّنات.
 */
export function useWishlist() {
  const [ids, setIds] = useState<number[]>(() => read());

  useEffect(() => {
    const sync = () => setIds(read());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const has = (id: number) => ids.includes(id);
  const toggle = (id: number) => {
    const current = read();
    write(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };
  const remove = (id: number) => write(read().filter((x) => x !== id));
  const clear = () => write([]);

  return { ids, count: ids.length, has, toggle, remove, clear };
}
