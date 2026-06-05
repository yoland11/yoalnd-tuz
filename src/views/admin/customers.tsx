import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, FileDown, MapPin, MessageCircle, NotebookPen, Receipt, Search, ShoppingBag, Sparkles, Trash2, Trophy, Wallet, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch, formatCurrency } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone, formatIraqiPhoneInput } from "@/lib/phone";
import { useToast } from "@/hooks/use-toast";

type Customer = {
  id: number; name: string; phone: string; role: string;
  createdAt: string; orderCount: number; totalSpent: number;
  rewardPoints?: number; rewardLevelLabel?: string;
};

type CustomerDetail = Customer & {
  fullName?: string;
  email?: string;
  avatarUrl?: string | null;
  address?: string;
  city?: string;
  summary?: { productOrders: number; serviceOrders: number; invoices: number; totalSpent: number; remainingTotal: number; unpaidCount: number; lastWhatsappAt: string | null; lastActivityAt: string | null };
  orders: { id: number; trackingCode: string; status: string; total: number; remainingAmount?: number; paymentStatus?: string; createdAt: string }[];
  serviceOrders: { id: number; trackingCode: string | null; status: string; total?: number; remainingAmount?: number; paymentStatus?: string; eventDate?: string | null; eventLocation?: string | null; createdAt: string }[];
  invoices?: { id: number; invoiceNo: string; total: number; paidAmount: number; remainingAmount: number; paymentStatus: string; createdAt: string }[];
  addresses?: { id: number; type: string; fullName: string; phone: string; governorate: string; city: string; address: string; landmark: string; isDefault: boolean }[];
  rewardHistory?: { id: number; points: number; reason: string; note: string; createdAt: string }[];
  notes?: { id: number; body: string; priority: string; createdAt: string }[];
  whatsappLogs?: { id: number; event: string; status: string; provider: string; sentAt: string }[];
  messageThreads?: { id: number; subject: string; status: string; lastMessageAt: string | null }[];
  activity?: { id: number; action: string; entityLabel: string; entityType: string; createdAt: string }[];
};

const ACTIVITY_LABELS: Record<string, string> = {
  visit: "زيارة",
  product_open: "فتح منتج",
  category_open: "فتح قسم",
  add_cart: "إضافة للسلة",
  remove_cart: "إزالة من السلة",
  checkout: "الدفع",
  message_sent: "إرسال رسالة",
  track_page: "فتح التتبع",
};

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pointsDelta, setPointsDelta] = useState("");
  const [pointsNote, setPointsNote] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [notePriority, setNotePriority] = useState("normal");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "customers", search],
    queryFn: () => adminFetch<Customer[]>(`/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const { data: detail } = useQuery({
    queryKey: ["admin", "customer", selectedId],
    queryFn: () => adminFetch<CustomerDetail>(`/admin/customers/${selectedId}`),
    enabled: selectedId !== null,
  });
  const updateRewards = useMutation({
    mutationFn: (body: { pointsDelta: number; note: string }) =>
      adminFetch(`/admin/customers/${selectedId}/rewards`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "customers"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "customer", selectedId] });
      setPointsDelta("");
      setPointsNote("");
      toast({ title: "تم تحديث نقاط الزبون" });
    },
    onError: (err: any) => toast({ title: "تعذر تحديث النقاط", description: err?.message, variant: "destructive" }),
  });
  const addNote = useMutation({
    mutationFn: () => adminFetch(`/admin/customers/${selectedId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: noteBody, priority: notePriority }),
    }),
    onSuccess: () => {
      setNoteBody("");
      setNotePriority("normal");
      queryClient.invalidateQueries({ queryKey: ["admin", "customer", selectedId] });
      toast({ title: "تم حفظ الملاحظة" });
    },
    onError: (err: any) => toast({ title: "تعذر حفظ الملاحظة", description: err?.message, variant: "destructive" }),
  });
  const deleteNote = useMutation({
    mutationFn: (noteId: number) => adminFetch(`/admin/customers/${selectedId}/notes/${noteId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "customer", selectedId] });
      toast({ title: "تم حذف الملاحظة" });
    },
    onError: (err: any) => toast({ title: "تعذر حذف الملاحظة", description: err?.message, variant: "destructive" }),
  });

  function exportCustomerCsv(detail: CustomerDetail) {
    const rows = [
      ["الاسم", detail.fullName || detail.name || ""],
      ["الهاتف", formatIraqiPhone(detail.phone)],
      ["النقاط", String(detail.rewardPoints ?? 0)],
      ["المستوى", detail.rewardLevelLabel ?? ""],
      ["إجمالي التعامل", String(detail.summary?.totalSpent ?? detail.totalSpent ?? 0)],
      ["المتبقي", String(detail.summary?.remainingTotal ?? 0)],
      [],
      ["النوع", "الرقم", "الحالة", "الإجمالي", "المتبقي", "التاريخ"],
      ...detail.orders.map((order) => ["طلب متجر", order.trackingCode, order.status, String(order.total), String(order.remainingAmount ?? 0), order.createdAt]),
      ...(detail.serviceOrders ?? []).map((order) => ["حجز خدمة", order.trackingCode ?? "", order.status, String(order.total ?? 0), String(order.remainingAmount ?? 0), order.createdAt]),
      ...(detail.invoices ?? []).map((invoice) => ["فاتورة", invoice.invoiceNo, invoice.paymentStatus, String(invoice.total), String(invoice.remainingAmount), invoice.createdAt]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ajn-customer-${detail.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-foreground">العملاء</h1>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={e => setSearch(formatIraqiPhoneInput(e.target.value) || e.target.value)}
          placeholder="بحث باسم أو هاتف..."
          className="w-full bg-card border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus:outline-none focus:border-primary/50" />
      </div>

      {isLoading ? <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
      : !data || data.length === 0 ? <EmptyState message="لا يوجد عملاء" /> : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-background/50">
              <tr className="text-muted-foreground border-b border-border/30">
                <th className="text-right p-3 font-medium">الاسم</th>
                <th className="text-right p-3 font-medium">الهاتف</th>
                <th className="text-right p-3 font-medium">عدد الطلبات</th>
                <th className="text-right p-3 font-medium">الإنفاق الإجمالي</th>
                <th className="text-right p-3 font-medium">النقاط</th>
                <th className="text-right p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {data.map(c => (
                <tr key={c.id} className="hover:bg-background/30 cursor-pointer" onClick={() => setSelectedId(c.id)}>
                  <td className="p-3 text-foreground">{c.name || "—"}</td>
                  <td className="p-3 text-muted-foreground" dir="ltr">{formatIraqiPhone(c.phone)}</td>
                  <td className="p-3"><span className="text-primary font-semibold">{c.orderCount}</span></td>
                  <td className="p-3 text-primary">{formatCurrency(c.totalSpent)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{(c.rewardPoints ?? 0).toLocaleString("ar-IQ")} نقطة</td>
                  <td className="p-3 text-xs text-primary">عرض ←</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId !== null && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={() => setSelectedId(null)}>
          <div className="bg-card border border-border/40 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 p-6 border-b border-border/30">
              <h3 className="font-bold text-foreground">ملف الزبون 360</h3>
              <button onClick={() => setSelectedId(null)}><X className="w-5 h-5 text-muted-foreground" /></button>
            </div>
            {!detail ? <div className="p-6"><Skeleton className="h-40" /></div> : (
              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <Info label="الاسم" value={detail.fullName || detail.name || "—"} />
                  <Info label="الهاتف" value={formatIraqiPhone(detail.phone)} ltr />
                  <Info label="البريد" value={detail.email || "—"} />
                  <Info label="المدينة" value={detail.city || detail.address || "—"} />
                  <Info label="منذ" value={new Date(detail.createdAt).toLocaleDateString("ar-IQ")} />
                  <Info label="النوع" value={detail.role} />
                  <Info label="المستوى" value={`${detail.rewardLevelLabel ?? "برونزي"} · ${(detail.rewardPoints ?? 0).toLocaleString("ar-IQ")} نقطة`} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={`https://wa.me/${detail.phone}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary hover:bg-primary/20"
                  >
                    <MessageCircle className="h-4 w-4" /> واتساب
                  </a>
                  <button
                    type="button"
                    onClick={() => exportCustomerCsv(detail)}
                    className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-sm text-foreground hover:border-primary/40"
                  >
                    <FileDown className="h-4 w-4" /> تصدير CSV
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Metric icon={ShoppingBag} label="الطلبات" value={(detail.summary?.productOrders ?? detail.orders.length).toLocaleString("ar-IQ")} />
                  <Metric icon={Sparkles} label="الحجوزات" value={(detail.summary?.serviceOrders ?? detail.serviceOrders.length).toLocaleString("ar-IQ")} />
                  <Metric icon={Wallet} label="المتبقي" value={formatCurrency(detail.summary?.remainingTotal ?? 0)} tone={(detail.summary?.remainingTotal ?? 0) > 0 ? "text-amber-400" : "text-primary"} />
                  <Metric icon={Receipt} label="الفواتير" value={(detail.summary?.invoices ?? detail.invoices?.length ?? 0).toLocaleString("ar-IQ")} />
                </div>

                <div className="rounded-xl bg-background/40 border border-border/25 p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-primary" /> إدارة النقاط
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-[120px_1fr_auto] gap-2">
                    <input
                      value={pointsDelta}
                      onChange={(e) => setPointsDelta(e.target.value.replace(/[^\d-]/g, ""))}
                      inputMode="numeric"
                      placeholder="+50"
                      className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    />
                    <input
                      value={pointsNote}
                      onChange={(e) => setPointsNote(e.target.value)}
                      placeholder="سبب التعديل"
                      className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    />
                    <button
                      type="button"
                      disabled={updateRewards.isPending || !Number(pointsDelta)}
                      onClick={() => updateRewards.mutate({ pointsDelta: Number(pointsDelta), note: pointsNote || "تعديل من الإدارة" })}
                      className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20 disabled:opacity-60"
                    >
                      حفظ
                    </button>
                  </div>
                </div>

                <div className="rounded-xl bg-background/40 border border-border/25 p-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <NotebookPen className="w-4 h-4 text-primary" /> ملاحظات الإدارة
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
                    <input
                      value={noteBody}
                      onChange={(e) => setNoteBody(e.target.value)}
                      placeholder="أضف ملاحظة داخلية عن الزبون..."
                      className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    />
                    <select
                      value={notePriority}
                      onChange={(e) => setNotePriority(e.target.value)}
                      className="bg-card border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    >
                      <option value="normal">اعتيادية</option>
                      <option value="important">مهمة</option>
                      <option value="urgent">عاجلة</option>
                    </select>
                    <button
                      type="button"
                      disabled={addNote.isPending || !noteBody.trim()}
                      onClick={() => addNote.mutate()}
                      className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20 disabled:opacity-60"
                    >
                      حفظ
                    </button>
                  </div>
                  {!detail.notes?.length ? <p className="mt-3 text-xs text-muted-foreground">لا توجد ملاحظات داخلية</p> : (
                    <div className="mt-3 space-y-2">
                      {detail.notes.map((note) => (
                        <div key={note.id} className="flex items-start justify-between gap-3 rounded-lg bg-card/70 border border-border/25 p-3">
                          <div>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{note.body}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">{note.priority === "urgent" ? "عاجلة" : note.priority === "important" ? "مهمة" : "اعتيادية"} · {new Date(note.createdAt).toLocaleString("ar-IQ", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                          </div>
                          <button type="button" onClick={() => deleteNote.mutate(note.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> العناوين المحفوظة</h4>
                    {!detail.addresses?.length ? <p className="text-xs text-muted-foreground">لا توجد عناوين محفوظة</p> : (
                      <div className="space-y-2">
                        {detail.addresses.slice(0, 3).map((address) => (
                          <div key={address.id} className="rounded-lg bg-background/40 border border-border/25 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm text-foreground">{address.type === "home" ? "المنزل" : address.type === "work" ? "العمل" : "عنوان آخر"}</p>
                              {address.isDefault && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">افتراضي</span>}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{[address.governorate, address.city, address.address].filter(Boolean).join(" / ")}</p>
                            {address.landmark && <p className="mt-1 text-[11px] text-muted-foreground">دالة: {address.landmark}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><MessageCircle className="w-4 h-4 text-primary" /> آخر واتساب ورسائل</h4>
                    {!detail.whatsappLogs?.length && !detail.messageThreads?.length ? <p className="text-xs text-muted-foreground">لا يوجد تواصل حديث</p> : (
                      <div className="space-y-2">
                        {(detail.whatsappLogs ?? []).slice(0, 3).map((row) => (
                          <div key={`wa-${row.id}`} className="flex items-center justify-between rounded-lg bg-background/40 border border-border/25 p-3 text-xs">
                            <span className="text-foreground">{row.event}</span>
                            <span className={row.status === "sent" ? "text-primary" : "text-amber-400"}>{row.status}</span>
                          </div>
                        ))}
                        {(detail.messageThreads ?? []).slice(0, 2).map((row) => (
                          <div key={`msg-${row.id}`} className="flex items-center justify-between rounded-lg bg-background/40 border border-border/25 p-3 text-xs">
                            <span className="text-foreground">{row.subject}</span>
                            <span className="text-muted-foreground">{row.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Receipt className="w-4 h-4 text-primary" /> الفواتير ({detail.invoices?.length ?? 0})</h4>
                  {!detail.invoices?.length ? <p className="text-xs text-muted-foreground">لا توجد فواتير</p> : (
                    <div className="space-y-2">
                      {detail.invoices.slice(0, 6).map((invoice) => (
                        <div key={invoice.id} className="flex items-center justify-between bg-background/40 rounded-lg p-3">
                          <div>
                            <p className="font-mono text-xs text-foreground">{invoice.invoiceNo}</p>
                            <p className="text-xs text-muted-foreground">{new Date(invoice.createdAt).toLocaleDateString("ar-IQ")}</p>
                          </div>
                          <div className="text-left">
                            <p className="text-primary font-semibold text-sm">{formatCurrency(invoice.total)}</p>
                            <p className="text-xs text-muted-foreground">متبقي {formatCurrency(invoice.remainingAmount)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-primary" /> طلبات المتجر ({detail.orders.length})</h4>
                  {detail.orders.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد طلبات</p> : (
                    <div className="space-y-2">
                      {detail.orders.map(o => (
                        <div key={o.id} className="flex items-center justify-between bg-background/40 rounded-lg p-3">
                          <div>
                            <p className="font-mono text-xs text-foreground">{o.trackingCode}</p>
                            <p className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("ar-IQ")}</p>
                          </div>
                          <div className="text-left">
                            <p className="text-primary font-semibold text-sm">{formatCurrency(o.total)}</p>
                            <p className="text-xs text-muted-foreground">{o.status} · متبقي {formatCurrency(o.remainingAmount ?? 0)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> حجوزات الخدمات ({detail.serviceOrders.length})</h4>
                  {detail.serviceOrders.length === 0 ? <p className="text-xs text-muted-foreground">لا توجد حجوزات</p> : (
                    <div className="space-y-2">
                      {detail.serviceOrders.map(o => (
                        <div key={o.id} className="flex items-center justify-between bg-background/40 rounded-lg p-3">
                          <div>
                            <p className="font-mono text-xs text-foreground">{o.trackingCode ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">{o.eventDate || new Date(o.createdAt).toLocaleDateString("ar-IQ")}</p>
                          </div>
                          <div className="text-left">
                            <p className="text-xs text-muted-foreground">{o.status}</p>
                            <p className="text-xs text-amber-400">متبقي {formatCurrency(o.remainingAmount ?? 0)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> سجل النشاط</h4>
                  {!detail.activity?.length ? <p className="text-xs text-muted-foreground">لا يوجد نشاط حديث</p> : (
                    <div className="space-y-2">
                      {detail.activity.slice(0, 8).map((item) => (
                        <div key={item.id} className="flex items-center justify-between bg-background/40 rounded-lg p-3">
                          <div>
                            <p className="text-sm text-foreground">{item.entityLabel || item.entityType || ACTIVITY_LABELS[item.action] || item.action}</p>
                            <p className="text-xs text-muted-foreground">{ACTIVITY_LABELS[item.action] || item.action}</p>
                          </div>
                          <p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleString("ar-IQ", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value, ltr = false }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm text-foreground ${ltr ? "font-mono" : ""}`} dir={ltr ? "ltr" : undefined}>{value}</p>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone = "text-primary" }: { icon: any; label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/25 bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon className={`h-4 w-4 ${tone}`} />
        <span className="text-[11px]">{label}</span>
      </div>
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
    </div>
  );
}
