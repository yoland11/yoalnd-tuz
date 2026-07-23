import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";

export type InvitationData = {
  slug?: string;
  type?: string;
  brideName?: string | null;
  groomName?: string | null;
  eventName?: string | null;
  eventDate?: string | null;
  eventTime?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  mapUrl?: string | null;
  customerPhone?: string | null;
  welcomeMessage?: string | null;
  thankYouMessage?: string | null;
  mainImageUrl?: string | null;
  galleryImages?: string[];
  fontFamily?: string | null;
  customFontUrl?: string | null;
  textColor?: string | null;
  backgroundColor?: string | null;
  animationStyle?: string | null;
  musicUrl?: string | null;
  videoUrl?: string | null;
  socialLinks?: Record<string, string> | null;
  guestName?: string | null;
};

export const SOCIAL_PLATFORMS: Array<{ key: string; label: string; icon: string }> = [
  { key: "instagram", label: "Instagram", icon: "📷" },
  { key: "facebook", label: "Facebook", icon: "📘" },
  { key: "tiktok", label: "TikTok", icon: "🎵" },
  { key: "snapchat", label: "Snapchat", icon: "👻" },
  { key: "telegram", label: "Telegram", icon: "✈️" },
  { key: "website", label: "Website", icon: "🌐" },
];

export const ANIMATION_STYLES = ["fade", "zoom", "slide", "float", "glow", "cinematic", "three_d"] as const;

const ANIM_CSS = `
@keyframes inv-fade { from { opacity: 0; transform: translateY(12px);} to { opacity: 1; transform: none; } }
@keyframes inv-zoom { from { opacity: 0; transform: scale(0.92);} to { opacity: 1; transform: none; } }
@keyframes inv-slide { from { opacity: 0; transform: translateX(24px);} to { opacity: 1; transform: none; } }
@keyframes inv-float { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-6px);} }
@keyframes inv-glow { 0%,100% { text-shadow: 0 0 6px rgba(212,175,55,0.3);} 50% { text-shadow: 0 0 18px rgba(212,175,55,0.7);} }
.inv-anim-fade > * { animation: inv-fade .7s ease both; }
.inv-anim-zoom > * { animation: inv-zoom .7s ease both; }
.inv-anim-slide > * { animation: inv-slide .7s ease both; }
.inv-anim-float .inv-names { animation: inv-float 3.5s ease-in-out infinite; }
.inv-anim-glow .inv-names { animation: inv-glow 2.8s ease-in-out infinite; }
.inv-anim-cinematic > * { animation: inv-cinematic 1.1s cubic-bezier(.16,1,.3,1) both; }
.inv-anim-three_d .inv-names { animation: inv-three-d 5s ease-in-out infinite; transform-style:preserve-3d; }
.inv-atmosphere { background: radial-gradient(circle at 15% 15%, rgba(222,183,79,.22), transparent 20%), radial-gradient(circle at 85% 85%, rgba(246,197,117,.16), transparent 24%), linear-gradient(145deg, rgba(255,255,255,.05), transparent 48%); }
.inv-particle { position:absolute; width:4px; height:4px; border-radius:99px; background:#e8c46a; box-shadow:0 0 10px #e8c46a; animation:inv-particle 7s ease-in-out infinite; opacity:.7; }
.inv-flower { position:absolute; color:#f5d6db; font-size:22px; animation:inv-flower 9s ease-in-out infinite; opacity:.7; }
@keyframes inv-cinematic { from { opacity:0; transform: perspective(900px) rotateX(7deg) translateY(22px); filter:blur(6px) } to { opacity:1; transform:none; filter:none } }
@keyframes inv-three-d { 0%,100%{transform:perspective(700px) rotateY(-4deg) rotateX(1deg)}50%{transform:perspective(700px) rotateY(4deg) rotateX(-2deg)} }
@keyframes inv-particle { 0%,100%{transform:translateY(0);opacity:.25}50%{transform:translateY(-70px) translateX(16px);opacity:.9} }
@keyframes inv-flower { 0%,100%{transform:translate3d(0,0,0) rotate(0deg)}50%{transform:translate3d(16px,45px,0) rotate(55deg)} }
.inv-anim-fade > *:nth-child(2){animation-delay:.1s}.inv-anim-fade > *:nth-child(3){animation-delay:.2s}.inv-anim-fade > *:nth-child(4){animation-delay:.3s}.inv-anim-fade > *:nth-child(5){animation-delay:.4s}
@media (prefers-reduced-motion: reduce) { .inv-anim-float .inv-names,.inv-anim-glow .inv-names,.inv-anim-three_d .inv-names,.inv-particle,.inv-flower { animation:none!important; } .inv-anim-cinematic > * { animation:inv-fade .15s ease both; } }
`;

function useCountdown(dateStr?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => {
    if (!dateStr) return null;
    const target = new Date(`${dateStr}T00:00:00`).getTime();
    if (!Number.isFinite(target)) return null;
    const diff = target - now;
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, passed: true };
    return { days: Math.floor(diff / 86400000), hours: Math.floor((diff % 86400000) / 3600000), minutes: Math.floor((diff % 3600000) / 60000), passed: false };
  }, [dateStr, now]);
}

function MusicButton({ src, gold }: { src: string; gold: string }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLAudioElement | null>(null);
  function toggle() {
    const a = ref.current; if (!a) return;
    if (a.paused) { a.play().then(() => setPlaying(true)).catch(() => {}); } else { a.pause(); setPlaying(false); }
  }
  return (
    <>
      <audio ref={ref} src={src} loop preload="none" />
      <button type="button" onClick={toggle} aria-label="الموسيقى" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-white shadow-lg" style={{ background: gold }}>
        {playing ? "❚❚" : "♪"}
      </button>
    </>
  );
}

/** Pure invitation renderer — shared by the admin live preview and the public page. */
export function InvitationCard({ data, qrDataUrl }: { data: InvitationData; qrDataUrl?: string | null }) {
  const cd = useCountdown(data.eventDate);
  const bg = data.backgroundColor || "#f7f1e8";
  const fg = data.textColor || "#2a2118";
  const font = data.fontFamily || "Cairo";
  const anim = ANIMATION_STYLES.includes((data.animationStyle as any) ?? "fade") ? data.animationStyle : "fade";
  const names = [data.brideName, data.groomName].filter(Boolean).join("  &  ") || data.eventName || "دعوة";
  const gold = "#c9a34a";
  const shellRef = useRef<HTMLDivElement | null>(null);
  function fullScreen() { shellRef.current?.requestFullscreen?.().catch(() => {}); }
  function addCalendar() {
    if (!data.eventDate) return;
    const time = (data.eventTime || "19:00").match(/\d{1,2}:\d{2}/)?.[0] ?? "19:00";
    const start = `${data.eventDate.replaceAll("-", "")}T${time.replace(":", "")}00`;
    const body = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nDTSTART:${start}\nSUMMARY:${names}\nLOCATION:${[data.venueName, data.venueAddress].filter(Boolean).join(" - ")}\nEND:VEVENT\nEND:VCALENDAR`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([body], { type: "text/calendar" })); a.download = "ajn-event.ics"; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div ref={shellRef} dir="rtl" className="mx-auto w-full max-w-md" style={{ fontFamily: `${font}, Cairo, Tahoma, sans-serif` }}>
      <style>{ANIM_CSS}{data.customFontUrl ? `@font-face{font-family:'${font}';src:url('${data.customFontUrl}');font-display:swap;}` : ""}</style>
      <div className={`inv-anim-${anim} relative overflow-hidden rounded-2xl shadow-2xl`} style={{ background: bg, color: fg, border: `1px solid ${gold}55` }}>
        <div className="inv-atmosphere pointer-events-none absolute inset-0" />
        {["12%", "28%", "56%", "74%", "88%"].map((left, i) => <span key={left} className="inv-particle" style={{ left, bottom: `${8 + (i % 3) * 15}%`, animationDelay: `${i * -1.2}s` }} />)}
        {["❀", "✿", "❀"].map((flower, i) => <span key={`${flower}-${i}`} className="inv-flower" style={{ left: `${5 + i * 43}%`, top: `${10 + i * 22}%`, animationDelay: `${i * -2.7}s` }}>{flower}</span>)}
        <div className="relative">
          {data.mainImageUrl ? (
            <img src={data.mainImageUrl} alt="" className="h-56 w-full object-cover" />
          ) : (
            <div className="grid h-40 w-full place-items-center text-5xl" style={{ background: `linear-gradient(135deg, ${gold}22, transparent)` }}>💍</div>
          )}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, transparent, ${gold}, transparent)` }} />
          {data.musicUrl ? <MusicButton src={data.musicUrl} gold={gold} /> : null}
          <button type="button" onClick={fullScreen} aria-label="ملء الشاشة" className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/35 text-sm text-white backdrop-blur-sm">⛶</button>
        </div>

        <div className="space-y-5 px-6 py-7 text-center">
          {data.guestName ? (
            <p className="text-sm opacity-80">تتشرّف بدعوتكم <span className="font-bold" style={{ color: gold }}>{data.guestName}</span></p>
          ) : (
            <p className="text-sm opacity-70" style={{ letterSpacing: "0.15em" }}>بطاقة دعوة</p>
          )}

          <div className="inv-names">
            <div className="text-xs tracking-widest opacity-60">بكل حب وسرور</div>
            <h1 className="mt-1 text-3xl font-extrabold leading-tight" style={{ color: gold }}>{names}</h1>
          </div>

          {data.welcomeMessage ? <p className="text-sm leading-7 opacity-90">{data.welcomeMessage}</p> : null}

          {data.videoUrl ? <video src={data.videoUrl} controls playsInline className="mx-auto max-h-64 w-full rounded-xl" /> : null}

          <div className="mx-auto h-px w-24" style={{ background: gold }} />

          <div className="space-y-1 text-sm">
            {data.eventDate ? <div className="font-bold">📅 {data.eventDate}{data.eventTime ? ` · ${data.eventTime}` : ""}</div> : null}
            {data.venueName || data.venueAddress ? <div className="opacity-90">📍 {[data.venueName, data.venueAddress].filter(Boolean).join(" — ")}</div> : null}
          </div>

          {cd && !cd.passed ? (
            <div className="flex items-center justify-center gap-3">
              {[["يوم", cd.days], ["ساعة", cd.hours], ["دقيقة", cd.minutes]].map(([l, v]) => (
                <div key={l as string} className="rounded-xl px-3 py-2" style={{ background: `${gold}18`, minWidth: 56 }}>
                  <div className="text-xl font-extrabold" style={{ color: gold }}>{v as number}</div>
                  <div className="text-[10px] opacity-70">{l}</div>
                </div>
              ))}
            </div>
          ) : cd?.passed ? <p className="text-sm font-bold" style={{ color: gold }}>🎉 اليوم الموعود</p> : null}

          <div className="flex flex-wrap items-center justify-center gap-2">
            {data.mapUrl ? <a href={data.mapUrl} target="_blank" rel="noreferrer" className="rounded-full px-4 py-1.5 text-sm font-bold text-white" style={{ background: gold }}>الموقع على الخريطة</a> : null}
            {data.eventDate ? <button type="button" onClick={addCalendar} className="rounded-full border px-4 py-1.5 text-sm font-bold" style={{ borderColor: gold, color: gold }}>أضف للتقويم</button> : null}
            {data.customerPhone ? <a href={`https://wa.me/${String(data.customerPhone).replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="rounded-full border px-4 py-1.5 text-sm font-bold" style={{ borderColor: gold, color: gold }}>واتساب</a> : null}
            {data.customerPhone ? <a href={`tel:${data.customerPhone}`} className="rounded-full border px-4 py-1.5 text-sm font-bold" style={{ borderColor: gold, color: gold }}>اتصال</a> : null}
          </div>

          {data.socialLinks && SOCIAL_PLATFORMS.some((p) => data.socialLinks?.[p.key]) ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {SOCIAL_PLATFORMS.filter((p) => data.socialLinks?.[p.key]).map((p) => (
                <a key={p.key} href={data.socialLinks![p.key]} target="_blank" rel="noreferrer" title={p.label} className="grid h-9 w-9 place-items-center rounded-full border text-lg" style={{ borderColor: `${gold}66` }}>{p.icon}</a>
              ))}
            </div>
          ) : null}

          {data.galleryImages && data.galleryImages.length ? (
            <div className="-mx-2 flex snap-x gap-2 overflow-x-auto px-2 py-1" style={{ scrollbarWidth: "none" }}>
              {data.galleryImages.map((g, i) => (
                <img key={i} src={g} alt="" className="h-24 w-24 flex-shrink-0 snap-center rounded-xl object-cover" style={{ border: `1px solid ${gold}44` }} />
              ))}
            </div>
          ) : null}

          {qrDataUrl ? <img src={qrDataUrl} alt="QR" className="mx-auto h-24 w-24 rounded-lg bg-white p-1" /> : null}
        </div>
      </div>
    </div>
  );
}

// ───── Public page (route /invite/:slug) ─────

export default function InvitePage() {
  const [, params] = useRoute("/invite/:slug");
  const slug = params?.slug ?? "";
  const guestToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("guest") : null;

  const { data, isLoading, error } = useQuery<InvitationData>({
    queryKey: ["invite", slug, guestToken],
    queryFn: () => fetch(`/api/invite/${encodeURIComponent(slug)}${guestToken ? `?guest=${encodeURIComponent(guestToken)}` : ""}`).then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); }),
    enabled: !!slug,
    retry: false,
  });

  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!slug) return;
    import("./admin/label-helpers").then((m) => m.generateQrDataUrl(`${window.location.origin}/invite/${slug}`, 200)).then(setQr).catch(() => {});
  }, [slug]);

  if (isLoading) return <div className="grid min-h-dvh place-items-center bg-neutral-950 text-white">جارٍ تحميل الدعوة…</div>;
  if (error || !data) return <div className="grid min-h-dvh place-items-center bg-neutral-950 text-white">الدعوة غير موجودة أو انتهت صلاحيتها.</div>;

  return (
    <div className="min-h-dvh w-full overflow-x-hidden bg-neutral-950 px-4 py-8">
      <InvitationCard data={data} qrDataUrl={qr} />
      <div className="mx-auto mt-5 w-full max-w-md">
        <RsvpForm slug={slug} guestToken={guestToken} thankYou={data.thankYouMessage} defaultName={data.guestName ?? ""} />
      </div>
    </div>
  );
}

function RsvpForm({ slug, guestToken, thankYou, defaultName }: { slug: string; guestToken: string | null; thankYou?: string | null; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"confirmed" | "declined" | "maybe" | "">("");
  const [companions, setCompanions] = useState("0");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim() || !status) { setErr("الرجاء إدخال الاسم واختيار الحالة"); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/invite/${encodeURIComponent(slug)}/rsvp`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ guestName: name.trim(), guestPhone: phone || null, attendanceStatus: status, companionsCount: Number(companions) || 0, guestMessage: message || null, guestToken }),
      });
      if (!r.ok) throw new Error("failed");
      setDone(true);
    } catch { setErr("تعذّر إرسال الرد، حاول مجدداً"); }
    finally { setBusy(false); }
  }

  if (done) return <div dir="rtl" className="rounded-2xl border border-amber-500/30 bg-neutral-900 p-6 text-center text-amber-200">✅ {thankYou || "شكراً لك، تم استلام ردّك بنجاح."}</div>;

  return (
    <div dir="rtl" className="rounded-2xl border border-amber-500/20 bg-neutral-900/90 p-5 text-white">
      <h2 className="mb-3 text-center text-lg font-bold text-amber-300">تأكيد الحضور</h2>
      <div className="space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم" className="w-full rounded-lg border border-white/15 bg-neutral-800 px-3 py-2 text-sm outline-none" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="رقم الهاتف (اختياري)" dir="ltr" className="w-full rounded-lg border border-white/15 bg-neutral-800 px-3 py-2 text-sm outline-none" />
        <div className="grid grid-cols-3 gap-2">
          {([["confirmed", "سأحضر", "bg-emerald-600"], ["maybe", "ربما", "bg-amber-600"], ["declined", "أعتذر", "bg-rose-600"]] as const).map(([v, l, c]) => (
            <button key={v} type="button" onClick={() => setStatus(v)} className={`rounded-lg py-2 text-sm font-bold transition ${status === v ? `${c} text-white` : "bg-neutral-800 text-white/70"}`}>{l}</button>
          ))}
        </div>
        {status === "confirmed" ? (
          <label className="flex items-center justify-between gap-2 text-sm text-white/80">عدد المرافقين
            <input type="number" min={0} max={50} value={companions} onChange={(e) => setCompanions(e.target.value)} className="w-24 rounded-lg border border-white/15 bg-neutral-800 px-3 py-1.5 text-center text-sm outline-none" />
          </label>
        ) : null}
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder="رسالة للعروسين (اختياري)" className="w-full rounded-lg border border-white/15 bg-neutral-800 px-3 py-2 text-sm outline-none" />
        {err ? <p className="text-center text-xs text-rose-400">{err}</p> : null}
        <button type="button" onClick={submit} disabled={busy} className="w-full rounded-lg bg-amber-500 py-2.5 text-sm font-bold text-black disabled:opacity-60">{busy ? "جارٍ الإرسال…" : "إرسال الرد"}</button>
      </div>
    </div>
  );
}
