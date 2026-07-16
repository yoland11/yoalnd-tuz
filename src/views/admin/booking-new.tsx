"use client";

import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Save } from "lucide-react";
import { toast } from "sonner";
import { adminFetch, apiErrorMessage, formatCurrency } from "./_lib";
import { PAYMENT_METHOD_LABELS } from "./booking-shared";

type Catalog = { services: { key: string; label: string; icon: string }[] };

type ServiceLine = { qty: string; price: string };

export default function BookingNewPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [hallName, setHallName] = useState("");
  const [hallAddress, setHallAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState("cash");
  const [lines, setLines] = useState<Record<string, ServiceLine>>({});

  const { data: catalog } = useQuery<Catalog>({
    queryKey: ["admin", "booking-center", "catalog"],
    queryFn: () => adminFetch("/admin/booking-center/services-catalog"),
    staleTime: 10 * 60_000,
  });

  const servicesTotal = useMemo(
    () =>
      Object.values(lines).reduce(
        (sum, line) => sum + (Number(line.qty) || 0) * (Number(line.price) || 0),
        0,
      ),
    [lines],
  );
  const grandTotal = Math.max(0, servicesTotal - (Number(discount) || 0));
  const remaining = Math.max(0, grandTotal - (Number(paid) || 0));

  const mutation = useMutation({
    mutationFn: async ({ print }: { print: boolean }) => {
      const booking: any = await adminFetch("/admin/booking-center/bookings", {
        method: "POST",
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          eventDate: eventDate || null,
          eventTime: eventTime || null,
          hallName: hallName.trim() || null,
          hallAddress: hallAddress.trim() || null,
          notes: notes.trim() || null,
          discount: Number(discount) || 0,
          status: "confirmed",
          services: Object.entries(lines).map(([key, line]) => ({
            serviceKey: key,
            amount: (Number(line.qty) || 0) * (Number(line.price) || 0),
            // Quantity and unit price are not first-class columns on
            // booking_services; they are kept in details so the existing API
            // stays unchanged while the line stays auditable.
            details: { quantity: Number(line.qty) || 1, unitPrice: Number(line.price) || 0 },
          })),
        }),
      });

      // The create endpoint does not take an opening payment, so an initial
      // amount is submitted as a normal receipt voucher against the new
      // booking — the same approval path as any other payment.
      const initial = Number(paid) || 0;
      if (initial > 0) {
        await adminFetch(`/admin/booking-center/bookings/${booking.id}/payments`, {
          method: "POST",
          body: JSON.stringify({ amount: initial, method }),
        });
      }
      return { booking, print };
    },
    onSuccess: ({ booking, print }) => {
      toast.success(`تم إنشاء الحجز ${booking.bookingNo}`, {
        description:
          Number(paid) > 0 ? "الدفعة أُرسلت للاعتماد ولم تُحتسب بعد." : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "booking-center"] });
      navigate(`/admin/booking-center/bookings/${booking.id}${print ? "?print=1" : ""}`);
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  });

  function toggle(key: string) {
    setLines((prev) => {
      const next = { ...prev };
      if (key in next) delete next[key];
      else next[key] = { qty: "1", price: "" };
      return next;
    });
  }

  function submit(print: boolean) {
    if (!customerName.trim()) {
      toast.error("اسم الزبون مطلوب");
      return;
    }
    if (!Object.keys(lines).length) {
      toast.error("اختر خدمة واحدة على الأقل");
      return;
    }
    if ((Number(paid) || 0) > grandTotal) {
      toast.error("المبلغ المدفوع أكبر من الإجمالي");
      return;
    }
    mutation.mutate({ print });
  }

  const field =
    "w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm";

  return (
    <div className="space-y-4" dir="rtl">
      <header>
        <h1 className="text-2xl font-bold text-foreground">حجز جديد</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          إذا كان رقم الهاتف مسجّلاً مسبقاً سيُربط الحجز بحساب الزبون تلقائياً، وإلا يُنشأ حساب جديد.
        </p>
      </header>

      <form
        className="grid gap-4 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit(false);
        }}
      >
        <div className="space-y-4 lg:col-span-2">
          {/* Customer + event */}
          <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">بيانات الزبون والمناسبة</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="اسم الزبون *"
                aria-label="اسم الزبون"
                className={field}
              />
              <input
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
                placeholder="رقم الهاتف"
                inputMode="tel"
                dir="ltr"
                aria-label="رقم الهاتف"
                className={field}
              />
              <input
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
                aria-label="تاريخ المناسبة"
                className={field}
              />
              <input
                type="time"
                value={eventTime}
                onChange={(event) => setEventTime(event.target.value)}
                aria-label="وقت المناسبة"
                className={field}
              />
              <input
                value={hallName}
                onChange={(event) => setHallName(event.target.value)}
                placeholder="القاعة"
                aria-label="القاعة"
                className={field}
              />
              <input
                value={hallAddress}
                onChange={(event) => setHallAddress(event.target.value)}
                placeholder="الموقع / العنوان"
                aria-label="الموقع"
                className={field}
              />
            </div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="ملاحظات"
              aria-label="ملاحظات"
              rows={2}
              className={`${field} mt-2 resize-none`}
            />
          </section>

          {/* Services */}
          <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">الخدمات</h2>
            <div className="space-y-2">
              {(catalog?.services ?? []).map((service) => {
                const active = service.key in lines;
                return (
                  <div
                    key={service.key}
                    className="rounded-lg border border-border/30 p-2.5"
                  >
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggle(service.key)}
                        className="accent-rose-400"
                      />
                      <span aria-hidden="true">{service.icon}</span>
                      <span className="font-medium text-foreground">{service.label}</span>
                      {active ? (
                        <span className="mr-auto text-[12px] font-semibold text-muted-foreground">
                          {formatCurrency(
                            (Number(lines[service.key].qty) || 0) *
                              (Number(lines[service.key].price) || 0),
                          )}
                        </span>
                      ) : null}
                    </label>
                    {active ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input
                          value={lines[service.key].qty}
                          onChange={(event) =>
                            setLines((prev) => ({
                              ...prev,
                              [service.key]: { ...prev[service.key], qty: event.target.value },
                            }))
                          }
                          inputMode="numeric"
                          placeholder="الكمية"
                          aria-label={`كمية ${service.label}`}
                          className={field}
                        />
                        <input
                          value={lines[service.key].price}
                          onChange={(event) =>
                            setLines((prev) => ({
                              ...prev,
                              [service.key]: { ...prev[service.key], price: event.target.value },
                            }))
                          }
                          inputMode="decimal"
                          placeholder="السعر"
                          aria-label={`سعر ${service.label}`}
                          className={field}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Financial summary */}
        <aside className="lg:sticky lg:top-4 lg:h-fit">
          <section className="rounded-2xl border border-border/40 bg-card p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-foreground">الملخص المالي</h2>
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">إجمالي الخدمات</dt>
                <dd className="text-foreground">{formatCurrency(servicesTotal)}</dd>
              </div>
            </dl>
            <div className="mt-2 space-y-2">
              <input
                value={discount}
                onChange={(event) => setDiscount(event.target.value)}
                inputMode="decimal"
                placeholder="الخصم"
                aria-label="الخصم"
                className={field}
              />
            </div>
            <dl className="mt-2 space-y-1.5 border-t border-border/30 pt-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="font-semibold text-foreground">الإجمالي الكلي</dt>
                <dd className="font-bold text-foreground">{formatCurrency(grandTotal)}</dd>
              </div>
            </dl>
            <div className="mt-2 space-y-2">
              <input
                value={paid}
                onChange={(event) => setPaid(event.target.value)}
                inputMode="decimal"
                placeholder="المدفوع الآن"
                aria-label="المدفوع"
                className={field}
              />
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                aria-label="طريقة الدفع"
                className={field}
              >
                {["cash", "transfer", "pos", "other"].map((key) => (
                  <option key={key} value={key}>
                    {PAYMENT_METHOD_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            <dl className="mt-2 border-t border-border/30 pt-2 text-[13px]">
              <div className="flex justify-between">
                <dt className="font-semibold text-foreground">المتبقي</dt>
                <dd className="font-bold text-red-600 dark:text-red-400">
                  {formatCurrency(remaining)}
                </dd>
              </div>
            </dl>
            {Number(paid) > 0 ? (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                الدفعة تُرسل كسند قبض للاعتماد. لن تُحتسب ضمن المدفوع قبل موافقة المدير.
              </p>
            ) : null}

            <div className="mt-3 flex flex-col gap-2">
              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-l from-rose-400 to-pink-400 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {mutation.isPending ? "جارٍ الحفظ…" : "حفظ"}
              </button>
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={mutation.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border/40 px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-50"
              >
                <Printer className="h-4 w-4" /> حفظ وطباعة
              </button>
            </div>
          </section>
        </aside>
      </form>
    </div>
  );
}
