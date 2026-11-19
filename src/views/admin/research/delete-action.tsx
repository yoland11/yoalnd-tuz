import React, { useRef, useState } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "../_lib";
import { researchFetch, type ResearchRecord } from "./shared";

/** Safe deletion reuses the original archive transaction and preserves all financial history. */
export function ResearchDeleteAction({ order, archivable, onDeleted, disabled = false }: { order: ResearchRecord; archivable: boolean; onDeleted?: () => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  const cache = useQueryClient();
  const { toast } = useToast();
  const archived = order.status === "archived" || Boolean(order.archivedAt);
  const delivered = order.status === "delivered" || Boolean(order.deliveredAt);
  const writing = useIsMutating({ mutationKey: ["research", "order-write"] }) > 0;
  const remove = useMutation({
    mutationKey: ["research", "order-write", order.id],
    mutationFn: async () => {
      const result = await researchFetch<{ order: ResearchRecord }>(`/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ status: "archived", archiveFromActive: true }) });
      if (!result?.order || result.order.id !== order.id || result.order.status !== "archived" || !result.order.archivedAt) throw new Error("لم يتم تأكيد حذف الطلب؛ حدّث البيانات قبل المحاولة مرة أخرى.");
      return result.order;
    },
    onSuccess: () => {
      setOpen(false);
      void cache.invalidateQueries({ queryKey: ["research"] });
      toast({ title: "تم حذف الطلب من القائمة النشطة", description: "حُفظ في الأرشيف مع ملفاته وسجله المالي." });
    },
    onSettled: () => { busy.current = false; },
  });
  if (!archivable || archived) return null;
  return <AlertDialog open={open} onOpenChange={value => { if (!busy.current) { setOpen(value); remove.reset(); } }}>
    <AlertDialogTrigger asChild>
      <Button type="button" size="sm" variant="outline" disabled={disabled || writing} className="text-destructive hover:text-destructive" aria-label={`حذف الطلب ${order.researchNo}`}><Trash2 data-icon="inline-start" />حذف</Button>
    </AlertDialogTrigger>
    <AlertDialogContent dir="rtl" className="research-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>حذف طلب البحث؟</AlertDialogTitle>
        <AlertDialogDescription>سيُزال الطلب من القائمة النشطة ويُحفظ في الأرشيف مع ملفاته وسجله. لا يمكن حذف طلب مسلّم أو مرتبط بمبالغ أو دفعات أو مصاريف أو مشتريات؛ الحذف لا يلغي المبالغ المستحقة. يمكن الرجوع إليه من قائمة الطلبات باختيار الحالة «مؤرشف». يُسجل تغيير الحالة ويظهر للطالب في بوابته.</AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-muted/40 p-3 text-sm">
        <bdi className="font-bold">{order.researchNo}</bdi>
        <span className="break-words">{order.title}</span>
        <span className="break-words text-muted-foreground">{order.customerName || "الطالب"}</span>
      </div>
      {delivered && <p role="alert" className="text-sm text-destructive">لا يمكن حذف بحث سبق تسليمه؛ يبقى محفوظاً في سجل الإنجاز والتقارير.</p>}
      {remove.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(remove.error)}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={remove.isPending}>إلغاء</AlertDialogCancel>
        <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={remove.isPending || disabled || delivered || writing} onClick={event => { event.preventDefault(); if (!busy.current && archivable && !archived && !disabled && !delivered && !writing) { busy.current = true; remove.mutate(undefined, { onSuccess: () => onDeleted?.() }); } }}>
          {remove.isPending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
          {remove.isPending ? "جارٍ الحذف…" : "تأكيد الحذف"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
