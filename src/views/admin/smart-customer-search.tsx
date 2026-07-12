import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, MapPin, Phone, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch, apiErrorMessage, apiErrorStatus, formatCurrency } from "./_lib";
import { useToast } from "@/hooks/use-toast";

export type SmartCustomer = {
  id: number;
  name: string;
  phone: string;
  code: string;
  city: string | null;
  invoiceCount: number;
  remaining: number;
  totalSpent: number;
  lastInvoice: string | null;
};

/**
 * Reusable smart customer search box. Instant enriched results (name/phone/code),
 * duplicate-safe create (server enforces one customer per phone). Drop into any
 * invoice/POS/booking form; `onSelect` returns the chosen customer (link by id).
 */
export function SmartCustomerSearch({ onSelect, autoFocus }: { onSelect: (c: SmartCustomer) => void; autoFocus?: boolean }) {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SmartCustomer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (timer.current) clearTimeout(timer.current);
    if (term.length < 1) { setResults(null); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(() => {
      let alive = true;
      adminFetch<{ results: SmartCustomer[] }>(`/admin/customers/smart-search?q=${encodeURIComponent(term)}`)
        .then((r) => { if (alive) setResults(r.results); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  return (
    <div className="space-y-2" dir="rtl">
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {loading ? <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" /> : null}
        <input
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث بالاسم أو الهاتف أو رمز العميل (CUS-...)"
          className="w-full rounded-lg border border-border/40 bg-background py-2.5 pr-10 pl-9 text-sm outline-none focus:border-primary/60"
        />
      </div>

      {results !== null && (
        <div className="max-h-[420px] space-y-2 overflow-y-auto">
          {results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 p-4 text-center">
              <p className="text-sm text-muted-foreground">لا يوجد عميل مطابق.</p>
              <Button size="sm" className="mt-2 gap-1.5" onClick={() => setCreating(true)}><UserPlus className="h-4 w-4" /> إنشاء عميل جديد</Button>
            </div>
          ) : (
            <>
              {results.map((c) => (
                <button key={c.id} type="button" onClick={() => onSelect(c)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-border/30 bg-card p-3 text-right transition-colors hover:border-primary/50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-foreground">👤 {c.name}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{c.code}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1" dir="ltr"><Phone className="h-3 w-3" /> {c.phone}</span>
                      {c.city ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {c.city}</span> : null}
                      <span>📄 {c.invoiceCount} فاتورة</span>
                      {c.lastInvoice ? <span>📅 {c.lastInvoice}</span> : null}
                    </div>
                  </div>
                  <div className="text-left">
                    <div className={`text-sm font-bold ${c.remaining > 0 ? "text-destructive" : "text-status-success"}`}>{formatCurrency(c.remaining)}</div>
                    <div className="text-[10px] text-muted-foreground">المتبقي</div>
                  </div>
                </button>
              ))}
              <Button size="sm" variant="outline" className="w-full gap-1.5" onClick={() => setCreating(true)}><UserPlus className="h-4 w-4" /> عميل جديد بدل هؤلاء</Button>
            </>
          )}
        </div>
      )}

      {creating && (
        <CreateCustomerDialog defaultName={q.trim()} onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); onSelect(c); }} onDuplicate={() => toast({ title: "هذا الهاتف مسجّل لعميل موجود — استخدمه من نتائج البحث" })} />
      )}
    </div>
  );
}

function CreateCustomerDialog({ defaultName, onClose, onCreated, onDuplicate }: { defaultName: string; onClose: () => void; onCreated: (c: SmartCustomer) => void; onDuplicate: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) { toast({ title: "الاسم مطلوب", variant: "destructive" }); return; }
    if (!phone.trim()) { toast({ title: "رقم الهاتف مطلوب", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const row = await adminFetch<{ id: number; name: string; phone: string }>("/admin/customers", { method: "POST", body: JSON.stringify({ name: name.trim(), phone: phone.trim(), city: city.trim() || null }) });
      onCreated({ id: row.id, name: row.name, phone: row.phone, code: `CUS-${String(row.id).padStart(6, "0")}`, city: city.trim() || null, invoiceCount: 0, remaining: 0, totalSpent: 0, lastInvoice: null });
    } catch (e) {
      if (apiErrorStatus(e) === 409) onDuplicate();
      else toast({ title: "تعذّر الإنشاء", description: apiErrorMessage(e), variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border/40 bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-foreground">إنشاء عميل جديد</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">هل أنت متأكد من إنشاء عميل جديد؟ لن يُنشأ عميل مكرّر إذا كان الهاتف موجوداً.</p>
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">الاسم<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /></label>
          <label className="block text-xs text-muted-foreground">الهاتف<input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="07XXXXXXXXX" className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /></label>
          <label className="block text-xs text-muted-foreground">المدينة (اختياري)<input value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm" /></label>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" className="flex-1" disabled={busy} onClick={create}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "إنشاء"}</Button>
          <Button size="sm" variant="outline" onClick={onClose}>إلغاء</Button>
        </div>
      </div>
    </div>
  );
}

// ───── Standalone directory page (/admin/customer-hub) ─────

export default function CustomerHubPage() {
  const [selected, setSelected] = useState<SmartCustomer | null>(null);
  return (
    <div className="space-y-5" dir="rtl">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">🔎 البحث الذكي عن العملاء</h1>
        <p className="mt-1 text-sm text-muted-foreground">ابحث فوراً بالاسم أو الهاتف أو رمز العميل — لا تكرار للعملاء (عميل واحد لكل رقم هاتف).</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/30 bg-card p-4">
          <SmartCustomerSearch onSelect={setSelected} autoFocus />
        </div>

        {selected && (
          <div className="rounded-xl border border-primary/30 bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-lg font-bold text-foreground">👤 {selected.name}</div>
                <div className="mt-1 text-xs text-muted-foreground" dir="ltr">{selected.phone} · {selected.code}</div>
                {selected.city ? <div className="text-xs text-muted-foreground">📍 {selected.city}</div> : null}
              </div>
              <Link href={`/admin/customers?focus=${selected.id}`}><Button size="sm">فتح الملف الكامل</Button></Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([["الفواتير", String(selected.invoiceCount)], ["إجمالي الشراء", formatCurrency(selected.totalSpent)], ["المتبقي", formatCurrency(selected.remaining)], ["آخر فاتورة", selected.lastInvoice ?? "—"]] as const).map(([l, v]) => (
                <div key={l} className="rounded-lg bg-background/60 p-2.5 text-center">
                  <div className="text-sm font-bold text-foreground">{v}</div>
                  <div className="text-[11px] text-muted-foreground">{l}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
