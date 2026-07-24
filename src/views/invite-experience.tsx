import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  resolveExperience,
  LIVE_OPENING_STYLES,
  type InvitationData,
  type OpeningStyleKey,
} from "./invite";

/*
 * Luxury interactive opening experience.
 *
 * `InvitationExperience` wraps the existing invitation content. It plays a cinematic
 * "open the gift" animation, then reveals the content underneath. Everything is driven by
 * the admin-controlled `data.experience` settings and is fully non-breaking: when the
 * experience is disabled (or the visitor prefers reduced motion) the children render
 * directly with no overlay.
 *
 * Opening styles are pluggable via OPENERS — add a component and register its key.
 */

// ── Scoped scene CSS (kept isolated from the app's global styles) ──────────────
const SCENE_CSS = `
.ajx{--gold:#c9a34a;--gold-hi:#e8c46a;--gold-deep:#a07d2e;--velvet:#5c1420;--velvet-2:#7d1a2a;--velvet-lo:#3a0d15;--ivory:#f3ead6;--muted:#9a8c6f;--sheen:rgba(255,120,140,.16)}
/* Selectable luxury materials (admin picks the opening style per invitation). */
.ajx-v-diamond_box{--velvet:#243247;--velvet-2:#33455f;--velvet-lo:#141d2b;--gold:#c6d2e6;--gold-hi:#ffffff;--gold-deep:#8fa2c4;--sheen:rgba(180,210,255,.20)}
.ajx-v-gift_box{--velvet:#123a2a;--velvet-2:#1c5a41;--velvet-lo:#0a2419;--gold:#d9b45a;--gold-hi:#f4dd93;--gold-deep:#a07d2e;--sheen:rgba(150,255,205,.14)}
.ajx-v-diamond_box .ajx-gem{width:30px;height:30px;box-shadow:0 0 16px rgba(207,230,255,1),0 0 30px rgba(255,255,255,.7)}
.ajx-v-diamond_box .ajx-band{background:linear-gradient(#0000,#0000) padding-box,conic-gradient(from 210deg,#6b7890,#e9f0fb,#aab8d0,#fff,#8fa2c4,#e9f0fb,#6b7890) border-box}
.ajx-v-gift_box .ajx-lid::before{background:linear-gradient(90deg,transparent 45%,rgba(244,221,147,.55) 45% 55%,transparent 55%),linear-gradient(140deg,rgba(255,255,255,.16),transparent 44%)}
.ajx-v-gift_box .ajx-base::before{background:linear-gradient(90deg,transparent 45%,rgba(244,221,147,.5) 45% 55%,transparent 55%),radial-gradient(120% 60% at 50% -10%,rgba(0,0,0,.5),transparent 60%)}
.ajx-stage{position:fixed;inset:0;z-index:60;display:grid;place-items:center;overflow:hidden;
  background:radial-gradient(120% 90% at 50% 12%,rgba(201,163,74,.10),transparent 46%),radial-gradient(140% 120% at 50% 120%,#000 20%,transparent 60%),linear-gradient(180deg,#0b0a08 0%,#14110c 58%,#070605 100%)}
.ajx-table{position:absolute;left:50%;bottom:-6%;width:190%;height:56%;transform:translateX(-50%) perspective(900px) rotateX(62deg);transform-origin:center top;
  background:radial-gradient(60% 80% at 50% 0%,rgba(201,163,74,.14),transparent 60%),linear-gradient(180deg,#1d1913,#0a0806 70%);box-shadow:inset 0 60px 120px rgba(0,0,0,.7);filter:blur(1px)}
.ajx-table::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(97deg,rgba(255,255,255,.018) 0 2px,transparent 2px 60px),radial-gradient(40% 60% at 30% 20%,rgba(201,163,74,.05),transparent 55%);mix-blend-mode:screen}
.ajx-candle{position:absolute;border-radius:50%;filter:blur(28px);mix-blend-mode:screen;pointer-events:none}
.ajx-candle.a{width:180px;height:220px;left:8%;top:24%;background:radial-gradient(circle,#f6c46a55,transparent 70%);animation:ajx-flicker 4.2s ease-in-out infinite}
.ajx-candle.b{width:150px;height:190px;right:10%;top:30%;background:radial-gradient(circle,#e0a24a44,transparent 70%);animation:ajx-flicker 3.3s .6s ease-in-out infinite}
@keyframes ajx-flicker{0%,100%{opacity:.75;transform:scale(1)}45%{opacity:1;transform:scale(1.06)}70%{opacity:.68;transform:scale(.98)}}
.ajx-floral{position:absolute;font-size:26px;color:#e7c7cd;opacity:.5;filter:blur(.4px) drop-shadow(0 0 8px rgba(231,199,205,.3));pointer-events:none}
.ajx-floral.f1{left:12%;bottom:20%;animation:ajx-sway 9s ease-in-out infinite}
.ajx-floral.f2{right:14%;bottom:16%;animation:ajx-sway 11s 1s ease-in-out infinite}
@keyframes ajx-sway{0%,100%{transform:rotate(-6deg) translateY(0)}50%{transform:rotate(8deg) translateY(-8px)}}
.ajx-dust{position:absolute;inset:0;pointer-events:none}
.ajx-vignette{position:absolute;inset:0;pointer-events:none;background:radial-gradient(60% 42% at 50% 8%,rgba(201,163,74,.10),transparent 60%),radial-gradient(70% 60% at 50% 42%,transparent 40%,rgba(0,0,0,.74) 100%)}
.ajx-cam{position:relative;z-index:5;display:grid;place-items:center;will-change:transform;animation:ajx-camfloat 9s ease-in-out infinite}
@keyframes ajx-camfloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-8px) scale(1.006)}}
.ajx-stage.is-open .ajx-cam{animation:ajx-camzoom calc(2.6s * var(--sp)) cubic-bezier(.16,1,.3,1) forwards}
@keyframes ajx-camzoom{to{transform:scale(1.28) translateY(4%)}}
.ajx-stage.is-open .ajx-table,.ajx-stage.is-open .ajx-candle,.ajx-stage.is-open .ajx-floral,.ajx-stage.is-open .ajx-dust{filter:blur(7px);transition:filter calc(1.6s * var(--sp)) cubic-bezier(.16,1,.3,1)}
.ajx-wrap{position:relative;display:grid;justify-items:center;gap:34px}
.ajx-halo{position:absolute;top:-46px;left:50%;transform:translateX(-50%);width:300px;height:300px;border-radius:50%;background:radial-gradient(circle,rgba(246,196,106,.38),rgba(124,26,42,.12) 46%,transparent 66%);filter:blur(14px);opacity:.6;transition:opacity 1.4s,transform 1.4s;pointer-events:none}
.ajx-stage.is-open .ajx-halo{opacity:1;transform:translateX(-50%) scale(1.5)}
.ajx-box{position:relative;width:210px;height:150px;cursor:pointer;transform-style:preserve-3d;transition:transform calc(1.1s * var(--sp)) cubic-bezier(.16,1,.3,1);filter:drop-shadow(0 40px 40px rgba(0,0,0,.6));border:0;background:transparent;padding:0}
.ajx-box:focus-visible{outline:2px solid var(--gold-hi);outline-offset:8px;border-radius:14px}
.ajx-box:active{transform:scale(.985)}
.ajx-stage:not(.is-open) .ajx-box:hover{transform:translateY(-5px) rotateX(3deg)}
.ajx-stage.is-open .ajx-box{transform:rotateZ(-4deg) translateY(-6px);cursor:default}
.ajx-base{position:absolute;inset:0;top:34px;border-radius:14px;background:radial-gradient(90% 120% at 50% -10%,var(--sheen),transparent 46%),linear-gradient(160deg,var(--velvet-2),var(--velvet) 40%,var(--velvet-lo));border:2px solid var(--gold-deep);box-shadow:inset 0 3px 10px rgba(255,255,255,.12),inset 0 -18px 30px rgba(0,0,0,.55),0 22px 34px rgba(0,0,0,.55),0 0 34px rgba(201,163,74,.16)}
.ajx-base::before{content:"";position:absolute;inset:6px;border-radius:9px;border:1px solid rgba(201,163,74,.5);background:radial-gradient(120% 60% at 50% -10%,rgba(0,0,0,.5),transparent 60%)}
.ajx-cushion{position:absolute;left:50%;top:44px;transform:translateX(-50%);width:150px;height:70px;border-radius:60px 60px 10px 10px;background:radial-gradient(60% 90% at 50% 0%,var(--velvet-2),var(--velvet-lo));box-shadow:inset 0 8px 14px rgba(0,0,0,.5),inset 0 -4px 8px rgba(255,255,255,.05)}
.ajx-slot{position:absolute;left:50%;top:52px;transform:translateX(-50%);width:8px;height:26px;border-radius:6px;background:#1a0509;box-shadow:inset 0 0 6px #000}
.ajx-lid{position:absolute;left:0;right:0;top:0;height:74px;border-radius:14px;transform-origin:50% 100%;transform:rotateX(0deg);transition:transform calc(1.5s * var(--sp)) cubic-bezier(.16,1,.3,1);background:radial-gradient(90% 130% at 50% -20%,var(--sheen),transparent 48%),linear-gradient(160deg,var(--velvet-2),var(--velvet) 45%,var(--velvet-lo));border:2px solid var(--gold-deep);box-shadow:inset 0 3px 10px rgba(255,255,255,.14),inset 0 0 0 3px rgba(201,163,74,.18),0 6px 14px rgba(0,0,0,.4);z-index:6;backface-visibility:hidden;overflow:hidden}
.ajx-lid::before{content:"";position:absolute;inset:7px;border-radius:9px;border:1px solid rgba(201,163,74,.6);background:linear-gradient(140deg,rgba(255,255,255,.18) 0%,rgba(255,255,255,.04) 20%,transparent 44%),radial-gradient(120% 80% at 30% 0%,rgba(255,255,255,.12),transparent 55%)}
.ajx-lid-gloss{position:absolute;top:0;left:-60%;width:55%;height:100%;transform:skewX(-18deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.28),transparent);z-index:7;pointer-events:none;animation:ajx-gloss 5.5s ease-in-out infinite}
@keyframes ajx-gloss{0%,68%{left:-60%}84%,100%{left:120%}}
.ajx-stage.is-open .ajx-lid-gloss{opacity:0}
.ajx-lid::after{content:"AJN";position:absolute;inset:0;display:grid;place-items:center;letter-spacing:.35em;font-size:15px;color:var(--gold-hi);text-shadow:0 1px 2px rgba(0,0,0,.6),0 0 12px rgba(232,196,106,.35);padding-right:.35em;z-index:8}
.ajx-stage.is-open .ajx-lid{transform:rotateX(-118deg)}
.ajx-burst{position:absolute;left:50%;top:40px;transform:translateX(-50%) scale(.4);width:170px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(246,196,106,.9),rgba(201,163,74,.2) 45%,transparent 70%);opacity:0;mix-blend-mode:screen;pointer-events:none;z-index:4}
.ajx-stage.is-open .ajx-burst{animation:ajx-burst calc(2.2s * var(--sp)) calc(.5s * var(--sp)) cubic-bezier(.16,1,.3,1) forwards}
@keyframes ajx-burst{0%{opacity:0;transform:translateX(-50%) scale(.3)}35%{opacity:1}100%{opacity:.5;transform:translateX(-50%) scale(1.4)}}
.ajx-ring{position:absolute;left:50%;top:40px;transform:translate(-50%,10px) scale(.5);width:76px;height:76px;opacity:0;z-index:7;pointer-events:none}
.ajx-stage.is-open .ajx-ring{animation:ajx-ringrise calc(3.1s * var(--sp)) calc(.9s * var(--sp)) cubic-bezier(.16,1,.3,1) forwards}
@keyframes ajx-ringrise{0%{opacity:0;transform:translate(-50%,10px) scale(.5)}18%{opacity:1;transform:translate(-50%,-58px) scale(1)}58%{opacity:1;transform:translate(-50%,-64px) scale(1.04)}82%{opacity:1;transform:translate(-50%,-40px) scale(.9)}100%{opacity:0;transform:translate(-50%,4px) scale(.55)}}
.ajx-spin{width:100%;height:100%}
.ajx-stage.is-open .ajx-spin{animation:ajx-spin calc(3.4s * var(--sp)) linear infinite}
@keyframes ajx-spin{to{transform:rotateY(360deg)}}
.ajx-band{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:52px;height:52px;border-radius:50%;border:7px solid transparent;background:linear-gradient(#0000,#0000) padding-box,conic-gradient(from 210deg,#8a6a24,#f4dd93,#c9a34a,#fff3cf,#a07d2e,#f4dd93,#8a6a24) border-box;box-shadow:0 6px 12px rgba(0,0,0,.45),inset 0 0 6px rgba(0,0,0,.3)}
.ajx-gem{position:absolute;left:50%;top:0;transform:translate(-50%,-40%) rotate(45deg);width:22px;height:22px;background:linear-gradient(135deg,#fff,#cfe6ff 35%,#9db8d6 60%,#fff);box-shadow:0 0 10px rgba(207,230,255,.9),0 0 22px rgba(255,255,255,.5);border-radius:3px}
.ajx-prompt{display:grid;justify-items:center;gap:10px;text-align:center}
.ajx-tap{position:relative;font-size:21px;font-weight:600;letter-spacing:.04em;background:linear-gradient(90deg,#c9a34a,#fff3cf 50%,#c9a34a);-webkit-background-clip:text;background-clip:text;color:transparent;animation:ajx-pulse 2.6s ease-in-out infinite}
.ajx-tap::after{content:"";position:absolute;left:50%;bottom:-9px;width:34px;height:1px;transform:translateX(-50%);background:linear-gradient(90deg,transparent,var(--gold),transparent);animation:ajx-tapline 2.6s ease-in-out infinite}
@keyframes ajx-tapline{0%,100%{width:24px;opacity:.5}50%{width:52px;opacity:1}}
.ajx-hint{font-size:11px;color:var(--muted);letter-spacing:.32em}
@keyframes ajx-pulse{0%,100%{opacity:.6;transform:translateY(0)}50%{opacity:1;transform:translateY(-3px)}}
.ajx-stage.is-open .ajx-prompt{opacity:0;transition:opacity calc(.5s * var(--sp))}
.ajx-audio{position:fixed;z-index:70;bottom:16px;right:16px;display:grid;place-items:center;width:44px;height:44px;border-radius:50%;cursor:pointer;color:var(--gold);background:rgba(15,13,10,.7);border:1px solid rgba(201,163,74,.28);backdrop-filter:blur(8px)}
.ajx-reveal{opacity:0}
@media (prefers-reduced-motion:reduce){
  .ajx-cam,.ajx-candle,.ajx-floral,.ajx-tap,.ajx-tap::after,.ajx-lid-gloss{animation:none !important}
  .ajx-lid-gloss{display:none}
}
@media (max-width:380px){.ajx-box{width:184px;height:134px}}
`;

// ── Soft synthesized audio cue (no external asset needed) ──────────────────────
function playOpenCue(volume = 0.06) {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const note = (freq: number, at: number, dur: number, type: OscillatorType, vol: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime + at;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    };
    note(392, 0, 0.5, "sine", volume);
    note(523, 0.08, 0.6, "sine", volume * 0.85);
    note(784, 0.9, 1.3, "triangle", volume * 0.8);
    note(1046, 1.0, 1.1, "sine", volume * 0.6);
    setTimeout(() => ctx.close().catch(() => {}), 3000);
  } catch {
    /* audio is best-effort */
  }
}

// ── Floating gold dust (canvas) ────────────────────────────────────────────────
function GoldDust() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;
    let raf = 0;
    let w = 0;
    let h = 0;
    const size = () => {
      w = cv.width = window.innerWidth;
      h = cv.height = window.innerHeight;
    };
    size();
    window.addEventListener("resize", size);
    const parts = Array.from({ length: 42 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.8 + 0.4,
      s: Math.random() * 0.3 + 0.05,
      d: Math.random() * Math.PI * 2,
      o: Math.random() * 0.5 + 0.2,
    }));
    const draw = () => {
      cx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y -= p.s;
        p.d += 0.01;
        p.x += Math.sin(p.d) * 0.25;
        if (p.y < -6) {
          p.y = h + 6;
          p.x = Math.random() * w;
        }
        cx.beginPath();
        cx.arc(p.x, p.y, p.r, 0, 6.283);
        cx.fillStyle = `rgba(233,196,106,${p.o})`;
        cx.shadowBlur = 8;
        cx.shadowColor = "rgba(233,196,106,.8)";
        cx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", size);
    };
  }, []);
  return <canvas ref={ref} className="ajx-dust" aria-hidden="true" />;
}

// ── Ring Box opener (default luxury style) ─────────────────────────────────────
function RingBoxOpener({
  variant,
  speed,
  particles,
  ambientLights,
  isOpen,
  onOpen,
}: {
  variant: string;
  speed: number;
  particles: boolean;
  ambientLights: boolean;
  isOpen: boolean;
  onOpen: () => void;
}) {
  return (
    <div className={`ajx-stage ajx-v-${variant}${isOpen ? " is-open" : ""}`} style={{ ["--sp" as any]: speed }} dir="rtl">
      {ambientLights ? (
        <>
          <div className="ajx-table" aria-hidden="true" />
          <div className="ajx-candle a" aria-hidden="true" />
          <div className="ajx-candle b" aria-hidden="true" />
          <span className="ajx-floral f1" aria-hidden="true">❦</span>
          <span className="ajx-floral f2" aria-hidden="true">❧</span>
        </>
      ) : (
        <div className="ajx-table" aria-hidden="true" />
      )}
      {particles ? <GoldDust /> : null}

      <div className="ajx-cam">
        <div className="ajx-wrap">
          <div className="ajx-halo" aria-hidden="true" />
          <button
            type="button"
            className="ajx-box"
            aria-label="اضغط لفتح الدعوة"
            aria-disabled={isOpen}
            onClick={() => { if (!isOpen) onOpen(); }}
          >
            <span className="ajx-base" aria-hidden="true" />
            <span className="ajx-cushion" aria-hidden="true" />
            <span className="ajx-slot" aria-hidden="true" />
            <span className="ajx-burst" aria-hidden="true" />
            <span className="ajx-ring" aria-hidden="true">
              <span className="ajx-spin">
                <span className="ajx-band" />
                <span className="ajx-gem" />
              </span>
            </span>
            <span className="ajx-lid" aria-hidden="true"><span className="ajx-lid-gloss" /></span>
          </button>
          <div className="ajx-prompt">
            <div className="ajx-tap">اضغط لفتح الدعوة</div>
            <div className="ajx-hint">A J N · دعوة</div>
          </div>
        </div>
      </div>
      <div className="ajx-vignette" aria-hidden="true" />
    </div>
  );
}

/**
 * Opening styles that currently have a bespoke luxury visual (the admin picks one per
 * invitation). Every style shares the cinematic box mechanics but carries its own
 * materials/palette via an `ajx-v-*` class. Unimplemented styles fall back to ring_box.
 */
const IMPLEMENTED_OPENINGS = new Set<OpeningStyleKey>(LIVE_OPENING_STYLES);

// ── Public orchestrator ────────────────────────────────────────────────────────
export function InvitationExperience({
  data,
  children,
}: {
  data: InvitationData;
  children: ReactNode;
}) {
  const exp = resolveExperience(data.experience);
  const reduced = useReducedMotion();
  const skip = !exp.enabled || !!reduced;

  const [isOpen, setIsOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const openedRef = useRef(false);
  const speed = Math.min(1.8, Math.max(0.5, exp.animationSpeed || 1));

  const musicRef = useRef<HTMLAudioElement | null>(null);

  const handleOpen = useCallback(() => {
    if (openedRef.current) return; // disable double clicks
    openedRef.current = true;
    setIsOpen(true);
    if (exp.soundEffects) playOpenCue();
    if (exp.music && data.musicUrl && musicRef.current) {
      musicRef.current.play().catch(() => {});
    }
    // Reveal the invitation once the card has risen from the box.
    window.setTimeout(() => setRevealed(true), 3400 * speed);
  }, [exp.soundEffects, exp.music, data.musicUrl, speed]);

  // Lock body scroll while the cinematic overlay is covering the page.
  useEffect(() => {
    if (skip) return;
    const covering = !revealed;
    const prev = document.body.style.overflow;
    document.body.style.overflow = covering ? "hidden" : prev || "";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [skip, revealed]);

  // Non-breaking fallback: no cinematic layer at all.
  if (skip) return <>{children}</>;

  // The admin's chosen style drives the visual; unknown styles fall back to ring_box.
  const styleKey: OpeningStyleKey =
    data.openingStyle && IMPLEMENTED_OPENINGS.has(data.openingStyle as OpeningStyleKey)
      ? (data.openingStyle as OpeningStyleKey)
      : "ring_box";

  return (
    <div className="ajx">
      <style>{SCENE_CSS}</style>
      {exp.music && data.musicUrl ? (
        <audio ref={musicRef} src={data.musicUrl} loop preload="none" />
      ) : null}

      <AnimatePresence>
        {!revealed ? (
          <motion.div
            key="stage"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.1 * speed, ease: [0.16, 1, 0.3, 1] }}
          >
            <RingBoxOpener
              variant={styleKey}
              speed={speed}
              particles={exp.particles}
              ambientLights={exp.ambientLights}
              isOpen={isOpen}
              onOpen={handleOpen}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div
        initial={false}
        animate={revealed ? { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } : { opacity: 0, y: 40, scale: 0.98, filter: "blur(8px)" }}
        transition={{ duration: 0.95 * speed, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </div>
  );
}

/** Reveal-on-scroll wrapper for content sections (fade-up + scale + blur, spring). */
export function ScrollReveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 34, scale: 0.97, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
