"use client";

import { lazy, Suspense, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarHeart, Flower2, Package, Gift, Sparkles, MessageSquareText,
  Eye, Plus, Minus, Check, ShoppingBag, Heart, Wallet,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/money";
import { usePublicSettings } from "@/lib/public-settings";
import { buildWhatsAppLink } from "@/lib/order-stages";

// Lazy — keeps three.js (~heavy) out of the initial /design bundle.
const Bouquet3D = lazy(() => import("./bouquet-3d"));

/*
 * AJN Smart Flower Studio — bouquet configurator (Phase 1).
 * Animated step wizard + live stylized preview + live pricing + add-to-booking.
 * Self-contained luxury UI (RTL, dark, glassmorphism, pink accent). Later phases
 * plug 3D preview, AI suggestions, inventory reservation and production onto this
 * same configuration object.
 */

// ── Catalog ────────────────────────────────────────────────────────────────
const OCCASIONS = [
  "زفاف", "خطوبة", "حناء", "تخرج", "عيد ميلاد", "مولود جديد", "حج", "ذكرى سنوية", "تعزية", "مخصّص",
] as const;

const STYLES = [
  "كوري", "ملكي", "كلاسيك", "فخم", "دائري", "صندوق", "سلة", "قلب", "هلال", "حرف",
] as const;

type Flower = { id: string; name: string; price: number; hex: string; stock: number };
const FLOWERS: Flower[] = [
  { id: "red_rose", name: "ورد أحمر", price: 1000, hex: "#e11d48", stock: 120 },
  { id: "white_rose", name: "ورد أبيض", price: 800, hex: "#f8fafc", stock: 90 },
  { id: "pink_rose", name: "ورد وردي", price: 900, hex: "#f472b6", stock: 80 },
  { id: "gypsophila", name: "جبسوفيلا", price: 500, hex: "#e2e8f0", stock: 200 },
  { id: "tulip", name: "تولب وردي", price: 1200, hex: "#fb7185", stock: 40 },
  { id: "peony", name: "بيوني", price: 1800, hex: "#f9a8d4", stock: 25 },
  { id: "hydrangea", name: "هيدرانجيا", price: 1500, hex: "#c4b5fd", stock: 30 },
  { id: "orchid", name: "أوركيد", price: 2200, hex: "#e879f9", stock: 18 },
  { id: "lily", name: "زنبق", price: 1300, hex: "#fef9c3", stock: 35 },
  { id: "sunflower", name: "دوّار الشمس", price: 1100, hex: "#f59e0b", stock: 22 },
];

type Wrap = { id: string; name: string; price: number; hex: string };
const WRAPS: Wrap[] = [
  { id: "white", name: "أبيض", price: 8000, hex: "#f8fafc" },
  { id: "pink", name: "وردي", price: 8000, hex: "#f472b6" },
  { id: "black", name: "أسود", price: 9000, hex: "#111827" },
  { id: "gold", name: "ذهبي", price: 12000, hex: "#d4af37" },
  { id: "silver", name: "فضي", price: 10000, hex: "#cbd5e1" },
  { id: "beige", name: "بيج", price: 8000, hex: "#e7d8c9" },
  { id: "transparent", name: "شفّاف", price: 7000, hex: "#94a3b8" },
  { id: "velvet", name: "مخمل", price: 15000, hex: "#7d1a2a" },
];

type Ribbon = { id: string; name: string; price: number; hex: string };
const RIBBONS: Ribbon[] = [
  { id: "satin", name: "ساتان", price: 2000, hex: "#f472b6" },
  { id: "velvet", name: "مخمل", price: 3000, hex: "#7d1a2a" },
  { id: "gold", name: "ذهبي", price: 3500, hex: "#d4af37" },
  { id: "silver", name: "فضي", price: 3000, hex: "#cbd5e1" },
  { id: "lace", name: "دانتيل", price: 2500, hex: "#f5f5f4" },
];

type Accessory = { id: string; name: string; price: number; emoji: string };
const ACCESSORIES: Accessory[] = [
  { id: "teddy", name: "دب", price: 12000, emoji: "🧸" },
  { id: "chocolate", name: "شوكولاتة", price: 10000, emoji: "🍫" },
  { id: "money", name: "نقود", price: 0, emoji: "💵" },
  { id: "perfume", name: "عطر", price: 25000, emoji: "🧴" },
  { id: "led", name: "إضاءة LED", price: 5000, emoji: "💡" },
  { id: "butterfly", name: "فراشة", price: 3000, emoji: "🦋" },
  { id: "pearls", name: "لؤلؤ", price: 6000, emoji: "🫧" },
  { id: "card", name: "بطاقة", price: 2000, emoji: "💌" },
  { id: "balloons", name: "بالونات", price: 8000, emoji: "🎈" },
  { id: "luxbox", name: "صندوق فخم", price: 15000, emoji: "🎁" },
  { id: "ringbox", name: "علبة خاتم", price: 9000, emoji: "💍" },
  { id: "crown", name: "تاج", price: 7000, emoji: "👑" },
];

const LABOR = 5000;

const STEPS = [
  { key: "occasion", label: "المناسبة", Icon: CalendarHeart },
  { key: "style", label: "الشكل", Icon: Sparkles },
  { key: "flowers", label: "الورد", Icon: Flower2 },
  { key: "wrap", label: "التغليف", Icon: Package },
  { key: "extras", label: "الإضافات", Icon: Gift },
  { key: "card", label: "الرسالة", Icon: MessageSquareText },
  { key: "preview", label: "المعاينة", Icon: Eye },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

// ── Component ────────────────────────────────────────────────────────────────
export default function FlowerDesigner() {
  const { toast } = useToast();
  const { data: settings } = usePublicSettings();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [fulfil, setFulfil] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [step, setStep] = useState(0);
  const [view3d, setView3d] = useState(false);
  const [lighting, setLighting] = useState<"day" | "night" | "studio">("day");
  const [autoRotate, setAutoRotate] = useState(true);
  const [occasion, setOccasion] = useState<string>("زفاف");
  const [budget, setBudget] = useState(80000);
  const [style, setStyle] = useState<string>("فخم");
  const [qty, setQty] = useState<Record<string, number>>({ red_rose: 20, white_rose: 10, pink_rose: 5, gypsophila: 3 });
  const [wrapId, setWrapId] = useState("pink");
  const [ribbonId, setRibbonId] = useState("satin");
  const [extras, setExtras] = useState<string[]>(["teddy", "chocolate", "led"]);
  const [sender, setSender] = useState("");
  const [receiver, setReceiver] = useState("");
  const [message, setMessage] = useState("");

  const wrap = WRAPS.find((w) => w.id === wrapId)!;
  const ribbon = RIBBONS.find((r) => r.id === ribbonId)!;

  const flowersTotal = useMemo(() => FLOWERS.reduce((s, f) => s + (qty[f.id] ?? 0) * f.price, 0), [qty]);
  const extrasTotal = useMemo(() => ACCESSORIES.filter((a) => extras.includes(a.id)).reduce((s, a) => s + a.price, 0), [extras]);
  const stemCount = useMemo(() => Object.values(qty).reduce((s, n) => s + n, 0), [qty]);
  const total = flowersTotal + wrap.price + ribbon.price + extrasTotal + LABOR;
  const overBudget = total > budget;

  const luxuryScore = Math.min(5, 1 + Math.round((total / 100000) * 3 + extras.length * 0.25));

  // Luxury indicators — all derived live from the configuration (no backend).
  const distinctColors = new Set(FLOWERS.filter((f) => (qty[f.id] ?? 0) > 0).map((f) => f.hex)).size;
  const harmony = Math.max(55, Math.min(98, 94 - Math.max(0, distinctColors - 3) * 9 + ((qty.gypsophila ?? 0) > 0 ? 4 : 0)));
  const sizeLabel = stemCount < 15 ? "صغيرة" : stemCount < 30 ? "متوسطة" : stemCount < 50 ? "كبيرة" : "ضخمة";
  const buildMinutes = Math.round(15 + stemCount * 0.7 + extras.length * 3);

  // Rule-based smart suggestions / upsell — one click applies each.
  const suggestions: { label: string; apply: () => void }[] = [];
  if (stemCount < 25) suggestions.push({ label: "كبّر باقتك (+١٠ ورد أحمر)", apply: () => setFlower("red_rose", 10) });
  if (!extras.includes("chocolate")) suggestions.push({ label: "أضف شوكولاتة متناسقة 🍫", apply: () => toggleExtra("chocolate") });
  if (wrapId !== "velvet") suggestions.push({ label: "تغليف مخمل أفخم", apply: () => setWrapId("velvet") });
  if (ribbonId !== "gold") suggestions.push({ label: "شريط ذهبي فاخر", apply: () => setRibbonId("gold") });
  if ((qty.peony ?? 0) === 0) suggestions.push({ label: "أضف بيوني فاخر (+٣)", apply: () => setFlower("peony", 3) });
  if (!extras.includes("teddy")) suggestions.push({ label: "أضف دبّاً لطيفاً 🧸", apply: () => toggleExtra("teddy") });
  const topSuggestions = suggestions.slice(0, 4);

  function setFlower(id: string, delta: number) {
    setQty((prev) => {
      const next = Math.max(0, (prev[id] ?? 0) + delta);
      return { ...prev, [id]: next };
    });
  }
  function toggleExtra(id: string) {
    setExtras((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function addToBooking() {
    if (stemCount === 0) {
      toast({ title: "أضف زهرة واحدة على الأقل", variant: "destructive" });
      return;
    }
    setCheckoutOpen(true);
  }

  // Hand the finished design to the shop as a complete WhatsApp order — reusing
  // the app's existing settings + WhatsApp ordering pattern (no separate system).
  function submitOrder() {
    if (!custName.trim() || custPhone.replace(/\D/g, "").length < 7) {
      toast({ title: "أدخل الاسم ورقم الهاتف", variant: "destructive" });
      return;
    }
    const lines = FLOWERS.filter((f) => (qty[f.id] ?? 0) > 0).map((f) => ` • ${f.name} ×${qty[f.id]}`).join("\n");
    const extrasTxt = ACCESSORIES.filter((a) => extras.includes(a.id)).map((a) => a.name).join("، ") || "—";
    const fulfilTxt = fulfil === "delivery" ? `توصيل${address.trim() ? ` — ${address.trim()}` : ""}` : "استلام من المحل";
    const msg = [
      "🌸 طلب باقة مخصّصة — AJN Smart Flower Studio",
      `العميل: ${custName.trim()} — ${custPhone.trim()}`,
      `المناسبة: ${occasion} · النمط: ${style}`,
      `الورود:\n${lines}`,
      `التغليف: ${wrap.name} · الشريط: ${ribbon.name}`,
      `الإضافات: ${extrasTxt}`,
      (receiver || message) ? `البطاقة: ${receiver || "—"} — ${message || ""}` : null,
      `الاستلام: ${fulfilTxt}`,
      orderNotes.trim() ? `ملاحظات: ${orderNotes.trim()}` : null,
      `الإجمالي: ${formatCurrency(total)}`,
    ].filter(Boolean).join("\n");
    const shopPhone = settings?.whatsapp || settings?.phone || "07701234567";
    try {
      localStorage.setItem("ajn_bouquet_design", JSON.stringify({ occasion, style, total, custName: custName.trim(), custPhone: custPhone.trim() }));
    } catch { /* ignore */ }
    window.open(buildWhatsAppLink(shopPhone, msg), "_blank", "noopener");
    toast({ title: "تم تجهيز طلبك", description: "أكمل الحجز مع المتجر عبر واتساب" });
    setCheckoutOpen(false);
  }

  const current = STEPS[step].key as StepKey;

  return (
    <div dir="rtl" className="min-h-dvh bg-neutral-950 text-neutral-100">
      {/* Header */}
      <div className="border-b border-white/5 bg-gradient-to-b from-pink-500/10 to-transparent">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5">
          <div className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-pink-500/15 text-pink-400"><Flower2 className="h-5 w-5" /></span>
            <div>
              <h1 className="text-lg font-bold tracking-wide">AJN Smart Flower Studio</h1>
              <p className="text-xs text-neutral-400">صمّم باقتك الفاخرة خطوة بخطوة</p>
            </div>
          </div>
          <span className="hidden rounded-full border border-pink-500/30 bg-pink-500/10 px-3 py-1 text-xs text-pink-300 sm:inline">تصميم مباشر</span>
        </div>
      </div>

      {/* Stepper */}
      <div className="mx-auto max-w-7xl px-4 pt-5">
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            const Icon = s.Icon;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStep(i)}
                className="flex shrink-0 items-center gap-2"
              >
                <span className={`grid h-9 w-9 place-items-center rounded-full border transition-colors ${
                  active ? "border-pink-500 bg-pink-500 text-white"
                  : done ? "border-pink-500/40 bg-pink-500/15 text-pink-300"
                  : "border-white/10 bg-white/5 text-neutral-500"}`}>
                  {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className={`whitespace-nowrap px-1 text-xs ${active ? "font-semibold text-pink-300" : "text-neutral-500"}`}>{s.label}</span>
                {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-white/10" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body: options | preview | summary */}
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[1fr_1.1fr_320px]">
        {/* Options panel */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
          <AnimatePresence mode="wait">
            <motion.div
              key={current}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              {current === "occasion" && (
                <Section title="اختر المناسبة">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {OCCASIONS.map((o) => (
                      <Chip key={o} active={occasion === o} onClick={() => setOccasion(o)}>{o}</Chip>
                    ))}
                  </div>
                  <div className="mt-6">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-neutral-300"><Wallet className="h-4 w-4 text-pink-400" /> الميزانية</span>
                      <span className="font-bold text-pink-300">{formatCurrency(budget)}</span>
                    </div>
                    <input type="range" min={10000} max={500000} step={5000} value={budget}
                      onChange={(e) => setBudget(Number(e.target.value))}
                      className="w-full accent-pink-500" />
                    <div className="mt-1 flex justify-between text-[11px] text-neutral-500"><span>١٠٬٠٠٠</span><span>٥٠٠٬٠٠٠</span></div>
                  </div>
                </Section>
              )}

              {current === "style" && (
                <Section title="نمط الباقة">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {STYLES.map((s) => <Chip key={s} active={style === s} onClick={() => setStyle(s)}>{s}</Chip>)}
                  </div>
                </Section>
              )}

              {current === "flowers" && (
                <Section title="نوع الورد">
                  <div className="space-y-2">
                    {FLOWERS.map((f) => (
                      <div key={f.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-2.5">
                        <span className="h-9 w-9 shrink-0 rounded-full border border-white/20" style={{ background: f.hex }} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{f.name}</p>
                          <p className="text-xs text-neutral-500">{formatCurrency(f.price)} · متوفّر {f.stock}</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Stepbtn onClick={() => setFlower(f.id, -1)}><Minus className="h-3.5 w-3.5" /></Stepbtn>
                          <span className="w-8 text-center text-sm font-bold tabular-nums">{qty[f.id] ?? 0}</span>
                          <Stepbtn onClick={() => setFlower(f.id, +1)}><Plus className="h-3.5 w-3.5" /></Stepbtn>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {current === "wrap" && (
                <Section title="التغليف">
                  <ColorGrid items={WRAPS} activeId={wrapId} onPick={setWrapId} />
                  <h3 className="mb-2 mt-6 text-sm font-semibold text-neutral-300">الشريط</h3>
                  <ColorGrid items={RIBBONS} activeId={ribbonId} onPick={setRibbonId} />
                </Section>
              )}

              {current === "extras" && (
                <Section title="الإضافات">
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {ACCESSORIES.map((a) => {
                      const on = extras.includes(a.id);
                      return (
                        <button key={a.id} type="button" onClick={() => toggleExtra(a.id)}
                          className={`relative flex flex-col items-center gap-1 rounded-2xl border p-3 transition-colors ${on ? "border-pink-500 bg-pink-500/15" : "border-white/10 bg-white/[0.02] hover:border-white/25"}`}>
                          {on && <Check className="absolute left-1.5 top-1.5 h-3.5 w-3.5 text-pink-400" />}
                          <span className="text-2xl">{a.emoji}</span>
                          <span className="text-[11px] text-neutral-300">{a.name}</span>
                          <span className="text-[10px] text-neutral-500">{a.price ? formatCurrency(a.price) : "مجاني"}</span>
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}

              {current === "card" && (
                <Section title="بطاقة الإهداء">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="المرسِل"><input value={sender} onChange={(e) => setSender(e.target.value)} className={inputCls} placeholder="اسمك" /></Field>
                    <Field label="المستقبِل"><input value={receiver} onChange={(e) => setReceiver(e.target.value)} className={inputCls} placeholder="اسم من ستُهدى إليه" /></Field>
                  </div>
                  <Field label="الرسالة" className="mt-3">
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} className={inputCls} placeholder="أنت أجمل ما في حياتي ♥" />
                  </Field>
                </Section>
              )}

              {current === "preview" && (
                <Section title="ملخص التصميم">
                  <ul className="space-y-2 text-sm">
                    <SummaryRow k="المناسبة" v={occasion} />
                    <SummaryRow k="النمط" v={style} />
                    <SummaryRow k="الورود" v={`${stemCount} زهرة`} />
                    <SummaryRow k="التغليف" v={wrap.name} />
                    <SummaryRow k="الشريط" v={ribbon.name} />
                    <SummaryRow k="الإضافات" v={extras.length ? ACCESSORIES.filter((a) => extras.includes(a.id)).map((a) => a.name).join("، ") : "—"} />
                    {(sender || receiver || message) && <SummaryRow k="البطاقة" v={`${receiver || "—"} — ${message || ""}`} />}
                  </ul>
                </Section>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Step nav */}
          <div className="mt-6 flex items-center justify-between">
            <button type="button" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-neutral-300 disabled:opacity-40">السابق</button>
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                className="rounded-xl bg-pink-500 px-5 py-2 text-sm font-semibold text-white hover:bg-pink-400">التالي</button>
            ) : (
              <span className="text-xs text-neutral-500">جاهز للإضافة ←</span>
            )}
          </div>
        </div>

        {/* Live preview — 2D stylized or interactive 360° 3D */}
        <div className="relative">
          <div className="absolute right-4 top-4 z-20 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setView3d((v) => !v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${view3d ? "border-pink-500 bg-pink-500 text-white" : "border-white/15 bg-black/40 text-pink-200 backdrop-blur hover:border-pink-500/50"}`}>
              {view3d ? "معاينة عادية" : "360° ثلاثي الأبعاد"}
            </button>
            {view3d && (
              <>
                <div className="flex overflow-hidden rounded-full border border-white/15 bg-black/40 text-[11px] backdrop-blur">
                  {([["day", "نهار"], ["night", "ليل"], ["studio", "استوديو"]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setLighting(k)}
                      className={`px-2.5 py-1.5 transition-colors ${lighting === k ? "bg-pink-500 text-white" : "text-neutral-300 hover:text-white"}`}>{l}</button>
                  ))}
                </div>
                <button type="button" onClick={() => setAutoRotate((r) => !r)}
                  className="rounded-full border border-white/15 bg-black/40 px-2.5 py-1.5 text-[11px] text-neutral-300 backdrop-blur hover:text-white">
                  {autoRotate ? "إيقاف الدوران" : "تدوير تلقائي"}
                </button>
              </>
            )}
          </div>

          {view3d ? (
            <div className="h-[520px] overflow-hidden rounded-3xl border border-white/10">
              <Suspense fallback={<div className="grid h-full place-items-center bg-neutral-900 text-sm text-neutral-500">جارٍ تحميل المشهد ثلاثي الأبعاد…</div>}>
                <Bouquet3D
                  flowers={FLOWERS.filter((f) => (qty[f.id] ?? 0) > 0).map((f) => ({ hex: f.hex, qty: qty[f.id] }))}
                  wrapHex={wrap.hex} ribbonHex={ribbon.hex}
                  lighting={lighting} autoRotate={autoRotate}
                />
              </Suspense>
              <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] text-neutral-300 backdrop-blur">اسحب للتدوير · مرّر للتكبير</p>
            </div>
          ) : (
            <BouquetPreview
              flowers={FLOWERS.filter((f) => (qty[f.id] ?? 0) > 0).map((f) => ({ hex: f.hex, qty: qty[f.id] }))}
              wrapHex={wrap.hex} ribbonHex={ribbon.hex}
              extras={ACCESSORIES.filter((a) => extras.includes(a.id)).map((a) => a.emoji)}
              message={message} luxuryScore={luxuryScore}
            />
          )}
        </div>

        {/* Summary + pricing */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
            <h3 className="mb-3 text-sm font-semibold text-neutral-300">مؤشّرات الفخامة</h3>
            <div className="grid grid-cols-2 gap-2">
              <Indicator k="الفخامة" v={"★".repeat(luxuryScore) + "☆".repeat(5 - luxuryScore)} accent />
              <Indicator k="التناسق" v={`${harmony}%`} />
              <Indicator k="الحجم" v={sizeLabel} />
              <Indicator k="زمن التجهيز" v={`${buildMinutes} دقيقة`} />
              <Indicator k="النضارة" v="طازج اليوم" />
              <Indicator k="المخزون" v="متوفّر" />
            </div>
          </div>

          {topSuggestions.length > 0 && (
            <div className="rounded-3xl border border-pink-500/25 bg-pink-500/[0.06] p-5">
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-pink-200"><Sparkles className="h-4 w-4" /> اقتراحات ذكية</h3>
              <div className="flex flex-col gap-2">
                {topSuggestions.map((s, i) => (
                  <button key={i} type="button" onClick={s.apply}
                    className="flex items-center justify-between gap-2 rounded-xl border border-pink-500/25 bg-white/[0.02] px-3 py-2 text-right text-xs text-neutral-200 transition-colors hover:border-pink-500/60 hover:bg-pink-500/10">
                    <span>{s.label}</span><Plus className="h-3.5 w-3.5 shrink-0 text-pink-400" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur">
            <h3 className="mb-3 text-sm font-semibold text-neutral-300">تفاصيل السعر</h3>
            <PriceRow k="الورد" v={flowersTotal} />
            <PriceRow k="التغليف" v={wrap.price} />
            <PriceRow k="الشريط" v={ribbon.price} />
            <PriceRow k="الإضافات" v={extrasTotal} />
            <PriceRow k="الأجور" v={LABOR} />
            <PriceRow k="التوصيل" v={0} freeLabel />
            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
              <span className="text-sm text-neutral-300">الإجمالي</span>
              <AnimatedPrice value={total} />
            </div>
            {overBudget && <p className="mt-2 text-xs text-amber-400">التصميم يتجاوز ميزانيتك ({formatCurrency(budget)}).</p>}
          </div>

          <button type="button" onClick={addToBooking}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-pink-500 py-3.5 text-sm font-bold text-white shadow-lg shadow-pink-500/25 transition-colors hover:bg-pink-400">
            <ShoppingBag className="h-4 w-4" /> أضف إلى الحجز
          </button>
          <button type="button"
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 py-3 text-sm text-neutral-300 hover:border-white/25">
            <Heart className="h-4 w-4" /> حفظ في المفضّلة
          </button>
        </div>
      </div>

      {checkoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setCheckoutOpen(false)}>
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-neutral-900 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-neutral-100">إتمام الحجز</h3>
              <span className="text-sm font-bold text-pink-400">{formatCurrency(total)}</span>
            </div>
            <div className="space-y-3">
              <Field label="الاسم *"><input value={custName} onChange={(e) => setCustName(e.target.value)} className={inputCls} placeholder="اسمك الكامل" /></Field>
              <Field label="رقم الهاتف *"><input value={custPhone} onChange={(e) => setCustPhone(e.target.value)} dir="ltr" inputMode="numeric" className={inputCls} placeholder="0770xxxxxxx" /></Field>
              <div>
                <span className="mb-1 block text-xs text-neutral-400">طريقة الاستلام</span>
                <div className="grid grid-cols-2 gap-2">
                  <Chip active={fulfil === "pickup"} onClick={() => setFulfil("pickup")}>استلام من المحل</Chip>
                  <Chip active={fulfil === "delivery"} onClick={() => setFulfil("delivery")}>توصيل</Chip>
                </div>
              </div>
              {fulfil === "delivery" && (
                <Field label="عنوان التوصيل"><input value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="المنطقة وأقرب نقطة دالة" /></Field>
              )}
              <Field label="ملاحظات (اختياري)"><textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} rows={2} className={inputCls} /></Field>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setCheckoutOpen(false)} className="flex-1 rounded-2xl border border-white/10 py-2.5 text-sm text-neutral-300">رجوع</button>
              <button type="button" onClick={submitOrder} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-pink-500 py-2.5 text-sm font-bold text-white hover:bg-pink-400">
                <ShoppingBag className="h-4 w-4" /> إرسال الطلب
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-neutral-500">سيتم إرسال تفاصيل باقتك كاملة إلى المتجر عبر واتساب لتأكيد الحجز.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── UI primitives ────────────────────────────────────────────────────────────
const inputCls = "w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-pink-500/50";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-base font-bold text-neutral-100">{title}</h2>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-sm transition-colors ${active ? "border-pink-500 bg-pink-500/15 text-pink-200" : "border-white/10 bg-white/[0.02] text-neutral-300 hover:border-white/25"}`}>
      {children}
    </button>
  );
}

function Stepbtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="grid h-7 w-7 place-items-center rounded-lg border border-white/15 bg-white/[0.03] text-neutral-200 hover:border-pink-500/50">
      {children}
    </button>
  );
}

function ColorGrid<T extends { id: string; name: string; hex: string; price: number }>({ items, activeId, onPick }: { items: T[]; activeId: string; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {items.map((it) => {
        const active = activeId === it.id;
        return (
          <button key={it.id} type="button" onClick={() => onPick(it.id)} title={`${it.name} · ${formatCurrency(it.price)}`}
            className="flex flex-col items-center gap-1">
            <span className={`grid h-11 w-11 place-items-center rounded-full border-2 transition-transform ${active ? "border-pink-500 scale-105" : "border-white/15"}`} style={{ background: it.hex }}>
              {active && <Check className="h-4 w-4 text-black/70" />}
            </span>
            <span className="text-[11px] text-neutral-400">{it.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="mb-1 block text-xs text-neutral-400">{label}</span>{children}</label>;
}

function SummaryRow({ k, v }: { k: string; v: string }) {
  return <li className="flex items-start justify-between gap-3 border-b border-white/5 pb-2"><span className="text-neutral-500">{k}</span><span className="text-left font-medium text-neutral-200">{v}</span></li>;
}

function Indicator({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className="text-[11px] text-neutral-500">{k}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent ? "text-amber-300" : "text-neutral-100"}`}>{v}</p>
    </div>
  );
}

function PriceRow({ k, v, freeLabel }: { k: string; v: number; freeLabel?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-neutral-500">{k}</span>
      <span className="tabular-nums text-neutral-200">{freeLabel && v === 0 ? "مجاني" : formatCurrency(v)}</span>
    </div>
  );
}

function AnimatedPrice({ value }: { value: number }) {
  return (
    <motion.span key={value} initial={{ scale: 1.15, color: "#f9a8d4" }} animate={{ scale: 1, color: "#f472b6" }} transition={{ duration: 0.3 }}
      className="text-xl font-extrabold tabular-nums text-pink-400">
      {formatCurrency(value)}
    </motion.span>
  );
}

// ── Live stylized preview ─────────────────────────────────────────────────────
function BouquetPreview({ flowers, wrapHex, ribbonHex, extras, message, luxuryScore }: {
  flowers: { hex: string; qty: number }[];
  wrapHex: string; ribbonHex: string; extras: string[]; message: string; luxuryScore: number;
}) {
  // Expand flowers into individual dots (capped for performance).
  const dots = flowers.flatMap((f) => Array.from({ length: Math.min(f.qty, 14) }, () => f.hex)).slice(0, 60);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-pink-500/10 via-neutral-900 to-neutral-950 p-5">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-1 rounded-full bg-black/40 px-3 py-1 text-xs backdrop-blur">
        <span className="text-pink-300">فخامة</span>
        <span className="text-amber-300">{"★".repeat(luxuryScore)}{"☆".repeat(5 - luxuryScore)}</span>
      </div>

      <div className="grid min-h-[420px] place-items-center">
        <div className="relative flex flex-col items-center">
          {/* Gift card */}
          {message && (
            <motion.div initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
              className="mb-2 max-w-[200px] rounded-lg border border-pink-200/40 bg-[#fdf6f0] px-3 py-2 text-center text-[11px] text-rose-700 shadow-lg">
              {message}
            </motion.div>
          )}
          {/* Flower cluster */}
          <motion.div layout className="relative z-10 -mb-6 flex max-w-[260px] flex-wrap justify-center gap-1.5">
            <AnimatePresence>
              {dots.map((hex, i) => (
                <motion.span key={`${hex}-${i}`} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18, delay: Math.min(i, 20) * 0.01 }}
                  className="h-6 w-6 rounded-full border border-white/30 shadow" style={{ background: hex }} />
              ))}
            </AnimatePresence>
            {dots.length === 0 && <span className="py-10 text-sm text-neutral-500">أضف وروداً لرؤية باقتك</span>}
          </motion.div>
          {/* Wrap cone */}
          <motion.div layout className="relative h-40 w-56"
            style={{ background: `linear-gradient(160deg, ${wrapHex}, ${wrapHex}cc)`, clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)", filter: "drop-shadow(0 20px 30px rgba(0,0,0,.5))" }}>
            {/* Ribbon bow */}
            <span className="absolute bottom-6 left-1/2 h-6 w-16 -translate-x-1/2 rounded-full" style={{ background: ribbonHex, boxShadow: `0 0 0 4px ${ribbonHex}55` }} />
          </motion.div>
          {/* Base */}
          <div className="mt-2 h-3 w-40 rounded-full bg-black/60 blur-[2px]" />
        </div>
      </div>

      {extras.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
          {extras.map((e, i) => <span key={i} className="rounded-full bg-white/5 px-2 py-1 text-lg">{e}</span>)}
        </div>
      )}
    </div>
  );
}
