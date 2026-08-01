import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Armchair, Home, ShoppingBag, Store, User } from "lucide-react";
import { useGetCart } from "@workspace/api-client-react";
import { useLocale } from "@/lib/i18n";

/**
 * Elastic Dock — the mobile / tablet bottom navigation (hidden on desktop via
 * `lg:hidden`). A glowing circular indicator follows the active route with a
 * spring, can be dragged between icons, and the dock's top edge deforms into a
 * real SVG meniscus notch that tracks the circle every frame. Themed entirely
 * through the site's CSS tokens (`--primary`, `--background`, `--border`), so it
 * adapts to light / dark automatically. To change the tabs, edit ITEMS below.
 */

type Item = {
  href: string;
  label: string;
  Icon: typeof Home;
  match: (loc: string) => boolean;
  badge?: boolean;
};

const ITEMS: Item[] = [
  { href: "/", label: "الرئيسية", Icon: Home, match: (l) => l === "/" },
  { href: "/store", label: "المتجر", Icon: Store, match: (l) => l.startsWith("/store") },
  { href: "/koshas", label: "الكوشات", Icon: Armchair, match: (l) => l.startsWith("/koshas") },
  { href: "/cart", label: "السلة", Icon: ShoppingBag, match: (l) => l.startsWith("/cart"), badge: true },
  { href: "/profile", label: "حسابي", Icon: User, match: (l) => l.startsWith("/profile") || l.startsWith("/account") },
];

// Geometry (px). TOPPAD is the transparent band above the pill the bump/circle
// overflow into; it also matches the wrapper's padding-top.
const DOCK_H = 64;
const CIRCLE = 54;
const CIRCLE_R = CIRCLE / 2;
const TOPPAD = 42;
const ICON = 22;
const R = 26;          // corner radius
const HW = 46;         // bump half-width
const BH = 24;         // bump height
const LIFT = 16;       // how high the circle floats above the flat edge
const PAD = 18;        // side padding for the icon row

export function MobileNav() {
  const [location, navigate] = useLocation();
  const { dir } = useLocale();
  const isRTL = dir === "rtl";
  const { data: cart } = useGetCart();
  const cartCount = cart?.itemCount || 0;

  const activeFromLocation = useCallback(() => {
    const i = ITEMS.findIndex((it) => it.match(location));
    return i < 0 ? 0 : i;
  }, [location]);

  const [active, setActive] = useState(activeFromLocation);
  const [geo, setGeo] = useState<{ W: number; slotW: number; centers: number[] }>({ W: 0, slotW: 0, centers: [] });

  const dockRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const circleRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<SVGSVGElement>(null);

  // Animation state kept in refs so the rAF loop never triggers a re-render.
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const spring = useRef({ x: 0, v: 0, target: 0 });
  const dragging = useRef(false);
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  const shown = useRef(-1);
  const reduce = useRef(false);

  const centerX = useCallback((i: number, W: number, slotW: number) => {
    const base = PAD + slotW * (i + 0.5);
    return isRTL ? W - base : base;
  }, [isRTL]);

  // Build the morphing dock path (rounded rect + meniscus bump around bx).
  const buildPath = useCallback((bx: number, W: number, H: number) => {
    const cxc = Math.max(R + 2, Math.min(W - R - 2, bx));
    const hw = Math.max(14, Math.min(HW, cxc - (R + 2), (W - R - 2) - cxc));
    const bh = BH * (hw / HW);
    const up = TOPPAD - bh;
    const f = (n: number) => n.toFixed(2);
    return [
      `M ${R} ${TOPPAD}`,
      `L ${f(cxc - hw)} ${TOPPAD}`,
      `C ${f(cxc - hw * 0.55)} ${TOPPAD} ${f(cxc - hw * 0.5)} ${f(up)} ${f(cxc)} ${f(up)}`,
      `C ${f(cxc + hw * 0.5)} ${f(up)} ${f(cxc + hw * 0.55)} ${TOPPAD} ${f(cxc + hw)} ${TOPPAD}`,
      `L ${W - R} ${TOPPAD}`,
      `Q ${W} ${TOPPAD} ${W} ${TOPPAD + R}`,
      `L ${W} ${H - R}`,
      `Q ${W} ${H} ${W - R} ${H}`,
      `L ${R} ${H}`,
      `Q 0 ${H} 0 ${H - R}`,
      `L 0 ${TOPPAD + R}`,
      `Q 0 ${TOPPAD} ${R} ${TOPPAD}`,
      "Z",
    ].join(" ");
  }, []);

  const paint = useCallback(() => {
    const { W, slotW, centers } = geoRef.current;
    if (!W || !centers.length) return;
    const x = spring.current.x;
    if (circleRef.current) {
      circleRef.current.style.transform = `translate3d(${(x - CIRCLE_R).toFixed(2)}px, ${(-LIFT - CIRCLE_R).toFixed(2)}px, 0)`;
    }
    pathRef.current?.setAttribute("d", buildPath(x, W, DOCK_H + TOPPAD));
    // Highlight nearest while dragging (visual feedback before release).
    if (dragging.current) {
      let best = 0, bd = Infinity;
      centers.forEach((c, i) => { const d = Math.abs(c - x); if (d < bd) { bd = d; best = i; } });
      if (best !== shown.current) { shown.current = best; setActive(best); }
    }
    void slotW;
  }, [buildPath]);

  const tick = useCallback((t: number) => {
    if (!last.current) last.current = t;
    let dt = (t - last.current) / 1000; last.current = t;
    dt = Math.min(dt, 0.032);
    if (!dragging.current) {
      const k = 240, c = 22;
      const a = -k * (spring.current.x - spring.current.target) - c * spring.current.v;
      spring.current.v += a * dt;
      spring.current.x += spring.current.v * dt;
      if (Math.abs(spring.current.x - spring.current.target) < 0.15 && Math.abs(spring.current.v) < 0.15) {
        spring.current.x = spring.current.target; spring.current.v = 0;
        paint(); raf.current = null; last.current = 0; return;
      }
    }
    paint();
    raf.current = requestAnimationFrame(tick);
  }, [paint]);

  const kick = useCallback(() => {
    if (reduce.current) { spring.current.x = spring.current.target; spring.current.v = 0; paint(); return; }
    if (raf.current == null) { last.current = 0; raf.current = requestAnimationFrame(tick); }
  }, [tick, paint]);

  // Measure + keep the circle/path aligned on resize.
  useEffect(() => {
    reduce.current = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const measure = () => {
      const el = dockRef.current;
      if (!el) return;
      const W = el.getBoundingClientRect().width;
      if (!W) return;
      const slotW = (W - PAD * 2) / ITEMS.length;
      const centers = ITEMS.map((_, i) => centerX(i, W, slotW));
      surfaceRef.current?.setAttribute("viewBox", `0 0 ${W} ${DOCK_H + TOPPAD}`);
      geoRef.current = { W, slotW, centers };
      setGeo({ W, slotW, centers });
      const idx = activeFromLocation();
      spring.current.target = centers[idx];
      if (!spring.current.x) spring.current.x = centers[idx];
      paint();
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (dockRef.current) ro.observe(dockRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerX]);

  // Follow route changes (navbar links, back/forward, programmatic nav).
  useEffect(() => {
    const idx = activeFromLocation();
    setActive(idx);
    shown.current = idx;
    const c = geoRef.current.centers[idx];
    if (c != null) { spring.current.target = c; kick(); }
  }, [location, activeFromLocation, kick]);

  // Drag the glowing circle.
  const localX = (clientX: number) => {
    const el = dockRef.current;
    const { centers } = geoRef.current;
    if (!el || !centers.length) return spring.current.x;
    const px = clientX - el.getBoundingClientRect().left;
    const lo = Math.min(centers[0], centers[centers.length - 1]);
    const hi = Math.max(centers[0], centers[centers.length - 1]);
    return Math.max(lo, Math.min(hi, px));
  };
  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      dragging.current = true; el.classList.add("is-drag");
      el.setPointerCapture?.(e.pointerId);
      spring.current.x = localX(e.clientX); spring.current.v = 0; kick(); e.preventDefault();
    };
    const onMove = (e: PointerEvent) => { if (!dragging.current) return; spring.current.x = localX(e.clientX); paint(); e.preventDefault(); };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false; el.classList.remove("is-drag");
      const { centers } = geoRef.current;
      let best = 0, bd = Infinity;
      centers.forEach((c, i) => { const d = Math.abs(c - spring.current.x); if (d < bd) { bd = d; best = i; } });
      navigate(ITEMS[best].href);
      spring.current.target = centers[best]; kick();
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kick, paint, navigate]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { const i = isRTL ? active + 1 : active - 1; go(i); e.preventDefault(); }
    else if (e.key === "ArrowRight") { const i = isRTL ? active - 1 : active + 1; go(i); e.preventDefault(); }
  };
  const go = (i: number) => { const idx = Math.max(0, Math.min(ITEMS.length - 1, i)); navigate(ITEMS[idx].href); };

  return (
    <nav
      aria-label="التنقّل السفلي"
      className="lg:hidden pointer-events-none fixed inset-x-0 bottom-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="pointer-events-auto relative mx-auto mb-2.5 w-[calc(100%-24px)] max-w-[560px]" style={{ paddingTop: TOPPAD }}>
        <div
          ref={dockRef}
          role="tablist"
          aria-orientation="horizontal"
          tabIndex={0}
          onKeyDown={onKey}
          className="relative outline-none"
          style={{ height: DOCK_H, touchAction: "none", filter: "drop-shadow(0 14px 30px rgba(0,0,0,.28))" }}
        >
          {/* Frosted glass body (rounded to the pill). */}
          <div
            className="absolute inset-0"
            style={{
              borderRadius: R,
              background: "hsl(var(--background) / 0.7)",
              backdropFilter: "blur(16px) saturate(1.15)",
              WebkitBackdropFilter: "blur(16px) saturate(1.15)",
            }}
          />
          {/* Morphing surface + glowing border. */}
          <svg ref={surfaceRef} className="absolute left-0 w-full" style={{ top: -TOPPAD, height: `calc(100% + ${TOPPAD}px)`, overflow: "visible" }} preserveAspectRatio="none" aria-hidden="true">
            <path ref={pathRef} d="" fill="hsl(var(--background) / 0.55)" stroke="hsl(var(--primary) / 0.35)" strokeWidth={1} />
          </svg>

          {/* Slots */}
          <div className="absolute inset-0" style={{ direction: "ltr" }}>
            {ITEMS.map((it, i) => {
              const isActive = i === active;
              const left = geo.centers[i] != null ? geo.centers[i] - geo.slotW / 2 : `${(i * 100) / ITEMS.length}%`;
              const width = geo.slotW || `${100 / ITEMS.length}%`;
              const Icon = it.Icon;
              return (
                <button
                  key={it.href}
                  role="tab"
                  aria-selected={isActive}
                  aria-label={it.label}
                  tabIndex={-1}
                  onClick={() => go(i)}
                  className="absolute top-0 bottom-0 grid place-items-center"
                  style={{ left, width }}
                >
                  <span
                    className="relative grid place-items-center transition-all duration-200"
                    style={{ opacity: isActive ? 0 : 1, transform: isActive ? "scale(.7)" : "none", color: "hsl(var(--muted-foreground))" }}
                  >
                    <Icon style={{ width: ICON, height: ICON }} strokeWidth={1.8} />
                    {it.badge && cartCount > 0 && (
                      <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold" style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                        {cartCount}
                      </span>
                    )}
                  </span>
                  <span
                    className="pointer-events-none absolute bottom-2 text-[10.5px] font-bold transition-all duration-300"
                    style={{ opacity: isActive ? 1 : 0, transform: isActive ? "none" : "translateY(4px)", color: "hsl(var(--primary))" }}
                  >
                    {it.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Glowing draggable circle with the active icon inside. */}
          <div
            ref={circleRef}
            aria-hidden="true"
            className="absolute left-0 top-0 grid place-items-center rounded-full"
            style={{
              width: CIRCLE, height: CIRCLE,
              background: "radial-gradient(circle at 50% 35%, hsl(var(--primary) / 0.92), hsl(var(--primary)))",
              boxShadow: "0 0 0 5px hsl(var(--background)), 0 0 18px hsl(var(--primary) / 0.6), 0 8px 20px hsl(var(--primary) / 0.35)",
              color: "hsl(var(--primary-foreground))",
              cursor: "grab", touchAction: "none", willChange: "transform", zIndex: 5,
            }}
          >
            {ITEMS.map((it, i) => {
              const Icon = it.Icon;
              return (
                <span key={it.href} className="absolute grid place-items-center transition-opacity duration-150" style={{ opacity: i === active ? 1 : 0 }}>
                  <Icon style={{ width: ICON, height: ICON }} strokeWidth={2} />
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
