import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_STAGES, eventStage } from "@/lib/event-messaging";
import { FOLLOWUP_SERVICES, formatFollowupDate, type FollowupRow } from "@/lib/customer-followups";
import { adminFetch } from "./_lib";
import { MessageError } from "./event-messaging";
export function FollowupEventDetails({
  row,
  scope,
  onClose,
}: {
  row: FollowupRow;
  scope: string;
  onClose: () => void;
}) {
  const [stage, setStage] = useState(eventStage(row.status, row.contactStage)),
    [date, setDate] = useState(row.expectedEventDate || ""),
    [note, setNote] = useState(row.note),
    key = useRef(crypto.randomUUID()),
    client = useQueryClient();
  const history = useQuery({
    queryKey: ["event-followup-history", row.id, scope],
    queryFn: () =>
      adminFetch<any>(`/admin/customer-followups/${row.id}/history${scope}`),
    retry: false,
  });
  const save = useMutation({
    mutationFn: () =>
      adminFetch(`/admin/customer-followups/${row.id}/actions${scope}`, {
        method: "POST",
        body: JSON.stringify({
          action: "event_details",
          contactStage: stage,
          expectedEventDate: date || null,
          note,
          expectedVersion: row.version,
          idempotencyKey: key.current,
        }),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["customer-followups"] });
      onClose();
    },
  });
  function changed() {
    key.current = crypto.randomUUID();
    save.reset();
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v && !save.isPending) onClose();
      }}
    >
      <DialogContent
        dir="rtl"
        className="ajn-event-dialog w-[min(calc(100%-2rem),48rem)] max-w-3xl max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>ملف متابعة المناسبة</DialogTitle>
          <DialogDescription>
            البيانات مرتبطة بالعميل الأصلي. التاريخ المتوقع لا يغيّر موعد أي
            حجز.
          </DialogDescription>
        </DialogHeader>
        <p className="font-semibold">{row.customer.name}</p>
        <bdi dir="ltr" className="text-sm">
          {row.customer.phone}
        </bdi>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm space-y-1">
              حالة التواصل
              <select
                className="min-h-11 w-full border rounded-md bg-background px-3"
                disabled={["converted", "uninterested"].includes(row.status)}
                value={stage}
                onChange={(e) => {
                  setStage(e.target.value as typeof stage);
                  changed();
                }}
              >
                {Object.entries(EVENT_STAGES)
                  .filter(
                    ([key]) =>
                      !["booked", "declined"].includes(key) || stage === key,
                  )
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm space-y-1">
              تاريخ المناسبة المتوقع
              <Input
                nativePicker
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  changed();
                }}
              />
            </label>
            <label className="block text-sm space-y-1">
              ملاحظة الموظف
              <Textarea
                value={note}
                maxLength={4000}
                onChange={(e) => {
                  setNote(e.target.value);
                  changed();
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              المتابعة القادمة: {formatFollowupDate(row.followupAt)}
            </p>
            {row.sourceBooking ? (
              <a className="text-sm underline" href={row.sourceBooking.href}>
                الحجز السابق {row.sourceBooking.number}
              </a>
            ) : null}
            {row.booking ? (
              <a className="block text-sm underline" href={row.booking.href}>
                الحجز المؤكد {row.booking.number}
              </a>
            ) : null}
            {save.isError ? <MessageError error={save.error} /> : null}
            <Button
              className="min-h-11"
              disabled={
                save.isPending ||
                ["converted", "uninterested"].includes(row.status)
              }
              onClick={() => save.mutate()}
            >
              حفظ المتابعة والملاحظة
            </Button>
          </div>
          <div className="min-w-0 space-y-4">
            {history.isError ? (
              <MessageError error={history.error} />
            ) : history.isPending ? (
              <p role="status">جارٍ تحميل سجل العميل…</p>
            ) : (
              <>
                <section>
                  <h3 className="font-semibold text-sm">
                    المناسبات والخدمات المهتم بها
                  </h3>
                  <ul className="mt-2 space-y-2 text-sm">
                    {history.data.related.map((f: FollowupRow) => (
                      <li key={f.id} className="rounded-lg border p-2">
                        {f.occasionKey==='marriage_contract'?'عقد قران':FOLLOWUP_SERVICES.find(service=>service.key===(f.occasionKey||f.serviceKey))?.label||f.occasionKey||f.serviceKey} ·{" "}
                        {EVENT_STAGES[eventStage(f.status, f.contactStage)]}
                        {f.expectedEventDate ? (
                          <bdi className="block text-xs">
                            {f.expectedEventDate}
                          </bdi>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="font-semibold text-sm">
                    الحجوزات السابقة والقادمة
                  </h3>
                  <ul className="mt-2 space-y-2 text-xs">
                    {history.data.bookings.map((b: any) => (
                      <li key={`${b.source}:${b.id}`}>
                        <a
                          className="underline"
                          href={`/admin/bookings/${b.source}/${b.id}`}
                        >
                          {b.number || "حجز"} ·{" "}
                          {b.event_date || "تاريخ غير محدد"} · {b.status}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="font-semibold text-sm">سجل المتابعة</h3>
                  <ol className="mt-2 space-y-3 text-xs">
                    {history.data.history.map((h: any, i: number) => (
                      <li key={i} className="border-r-2 pr-3">
                        <span className="font-medium">{h.employee}</span> ·{" "}
                        {(
                          {
                            create: "أضاف المتابعة",
                            complete: "أكمل التواصل",
                            postpone: "أجّل المتابعة",
                            event_details: "حدّث المناسبة والملاحظة",
                            auto_created: "متابعة تلقائية بعد الخطوبة",
                            status: "حدّث الحالة",
                            link_booking: "ربط حجزاً",
                            assign: "غيّر الموظف",
                            stop_contact: "أوقف التواصل",
                          } as Record<string, string>
                        )[h.action] || h.action}
                        <time className="block mt-1 text-muted-foreground">
                          {formatFollowupDate(h.created_at)}
                        </time>
                        {h.result?.followup?.note ? (
                          <p className="mt-1 whitespace-pre-wrap">
                            {h.result.followup.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
