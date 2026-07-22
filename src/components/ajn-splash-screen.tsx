"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { initialPublicSettings, logoSrc } from "@/lib/public-settings";

const SPLASH_SESSION_KEY = "ajn-splash-seen";
const SPLASH_EXIT_MS = 220;

type SplashPhase = "entering" | "leaving";

const PARTICLES = [
  [10, 16, 0, 3.8],
  [18, 72, 0.7, 4.4],
  [27, 34, 1.2, 3.6],
  [35, 86, 0.25, 4.7],
  [44, 18, 1.55, 4.1],
  [52, 68, 0.95, 3.9],
  [61, 29, 0.4, 4.6],
  [69, 82, 1.35, 3.7],
  [77, 14, 0.15, 4.3],
  [84, 58, 1.75, 4.8],
  [91, 33, 0.85, 3.5],
  [94, 78, 1.1, 4.2],
] as const;

function shouldShowSplash() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SPLASH_SESSION_KEY) !== "1";
  } catch {
    return true;
  }
}

export function AjnSplashScreen() {
  const [visible, setVisible] = useState(shouldShowSplash);
  const [phase, setPhase] = useState<SplashPhase>("entering");
  const [logo] = useState(() => logoSrc(initialPublicSettings()));

  useEffect(() => {
    if (!visible) return;

    try {
      window.sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minimumVisibleMs = reduceMotion ? 350 : 2200;
    const maximumVisibleMs = reduceMotion ? 500 : 2600;
    const startedAt = performance.now();
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    let minimumTimer: number | undefined;
    let removalTimer: number | undefined;
    let finishStarted = false;

    const finish = () => {
      if (finishStarted) return;
      finishStarted = true;
      const remaining = Math.max(0, minimumVisibleMs - (performance.now() - startedAt));
      minimumTimer = window.setTimeout(() => {
        setPhase("leaving");
        removalTimer = window.setTimeout(() => setVisible(false), reduceMotion ? 90 : SPLASH_EXIT_MS);
      }, remaining);
    };

    const maximumTimer = window.setTimeout(finish, maximumVisibleMs);
    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });

    return () => {
      window.removeEventListener("load", finish);
      window.clearTimeout(maximumTimer);
      if (minimumTimer) window.clearTimeout(minimumTimer);
      if (removalTimer) window.clearTimeout(removalTimer);
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <section
      className="ajn-splash"
      data-phase={phase}
      role="status"
      aria-live="polite"
      aria-label="مرحباً بكم في مجموعة علي جان نهاد"
      aria-busy={phase !== "leaving"}
    >
      <div className="ajn-splash__ambient" aria-hidden="true" />
      <div className="ajn-splash__particles" aria-hidden="true">
        {PARTICLES.map(([x, y, delay, duration]) => (
          <i
            key={`${x}-${y}`}
            style={{
              "--ajn-particle-x": `${x}%`,
              "--ajn-particle-y": `${y}%`,
              "--ajn-particle-delay": `${delay}s`,
              "--ajn-particle-duration": `${duration}s`,
            } as CSSProperties}
          />
        ))}
      </div>

      <div className="ajn-splash__content">
        <div className="ajn-splash__brand-mark">
          <span className="ajn-splash__halo" aria-hidden="true" />
          <span className="ajn-splash__logo-frame">
            <img src={logo} alt="شعار مجموعة علي جان نهاد" decoding="async" />
            <span className="ajn-splash__shine" aria-hidden="true" />
          </span>
        </div>

        <div className="ajn-splash__copy">
          <h1>مجموعة علي جان نهاد</h1>
          <p>لتنظيم المناسبات</p>
          <strong>مرحباً بكم</strong>
        </div>

        <div className="ajn-splash__progress" role="progressbar" aria-label="جاري تحميل النظام">
          <span />
        </div>
      </div>
    </section>
  );
}
