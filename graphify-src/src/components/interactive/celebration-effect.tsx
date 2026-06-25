import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

function canAnimate(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  const cores = navigator.hardwareConcurrency ?? 4;
  return cores >= 4;
}

export function CelebrationEffect({
  active,
  storageKey,
  message = "شكراً لاختيارك AJN",
}: {
  active: boolean;
  storageKey?: string;
  message?: string;
}) {
  const [visible, setVisible] = useState(false);
  const pieces = useMemo(
    () =>
      Array.from({ length: 20 }, (_, index) => ({
        id: index,
        left: `${(index * 37) % 100}%`,
        delay: `${(index % 7) * 80}ms`,
        duration: `${900 + (index % 5) * 90}ms`,
        rotate: `${(index * 29) % 180}deg`,
      })),
    [],
  );

  useEffect(() => {
    if (!active || !canAnimate()) return undefined;
    if (storageKey && window.sessionStorage.getItem(storageKey)) return undefined;
    if (storageKey) window.sessionStorage.setItem(storageKey, "1");
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 2200);
    return () => window.clearTimeout(timer);
  }, [active, storageKey]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes ajn-confetti-fall {
          0% { transform: translateY(-24px) rotate(0deg); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(72vh) rotate(240deg); opacity: 0; }
        }
        @keyframes ajn-celebration-glow {
          0%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(.86); }
          35% { opacity: .85; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
      <div
        className="absolute left-1/2 top-1/2 h-56 w-56 rounded-full bg-primary/20 blur-3xl"
        style={{ animation: "ajn-celebration-glow 1800ms ease-out forwards" }}
      />
      <div className="absolute left-1/2 top-[18%] -translate-x-1/2 rounded-2xl border border-primary/30 bg-card/90 px-4 py-3 text-sm text-primary shadow-xl backdrop-blur">
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          {message}
        </span>
      </div>
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="absolute top-0 h-2.5 w-1.5 rounded-sm bg-primary"
          style={{
            left: piece.left,
            transform: `rotate(${piece.rotate})`,
            animation: `ajn-confetti-fall ${piece.duration} ease-out ${piece.delay} forwards`,
          }}
        />
      ))}
    </div>
  );
}
