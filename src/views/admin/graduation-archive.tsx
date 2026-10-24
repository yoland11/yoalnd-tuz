import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage, hasPerm, type AdminMe } from "./_lib";

export type GraduationArchiveTarget = {
  id: number;
  groupId?: number | null;
  orderNo: string;
  customerName: string;
};

/** One controller per list, shared by its desktop and mobile row actions.
 * Eligibility is deliberately server-owned; no payment/production guesses. */
export function useGraduationOrderArchive(user: AdminMe | null | undefined) {
  const client = useQueryClient();
  const { toast } = useToast();
  const [target, setTarget] = useState<GraduationArchiveTarget | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const submitting = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const canArchive = (item: GraduationArchiveTarget) =>
    Number.isSafeInteger(item.id) && item.id > 0 &&
    (item.groupId == null || (Number.isSafeInteger(item.groupId) && item.groupId > 0)) &&
    hasPerm(user ?? null, item.groupId != null ? "graduation.student.delete" : "graduation.delete");
  const remove = useMutation({
    mutationFn: async (item: GraduationArchiveTarget) => {
      const result = await adminFetch<{archived:boolean}>(item.groupId != null
        ? `/admin/graduation/groups/${item.groupId}/students/${item.id}`
        : `/admin/graduation/orders/${item.id}`, {method:"DELETE"});
      if (result?.archived !== true) throw new Error("تعذر تأكيد أرشفة الطلب؛ حدّث القائمة للتحقق من حالته قبل إعادة المحاولة");
      return result;
    },
    retry: false,
    onSuccess: () => {
      setTarget(null);
      setIssue(null);
      void client.invalidateQueries({queryKey:["admin", "graduation"]});
      toast({title:"تم إلغاء وأرشفة الطلب مع حفظ سجله"});
    },
    onError: (cause) => setIssue(apiErrorMessage(cause)),
    onSettled: () => { submitting.current = false; },
  });
  const request = (item: GraduationArchiveTarget) => {
    if (submitting.current || !canArchive(item)) return;
    opener.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    setIssue(null);
    setTarget({...item});
  };
  const confirm = () => {
    if (!target || submitting.current || !canArchive(target)) return;
    submitting.current = true;
    setIssue(null);
    return remove.mutate(target);
  };
  const confirmation = <AlertDialog open={target !== null} onOpenChange={(open) => {
    if (!open && !submitting.current) { setTarget(null); setIssue(null); }
  }}>
    <AlertDialogContent dir="rtl" aria-busy={remove.isPending} onCloseAutoFocus={(event) => {
      // One controlled dialog serves many rows, so there is no Radix Trigger.
      // Restore a surviving action on cancel/error; successful refetch may remove it.
      event.preventDefault();
      if (opener.current?.isConnected) opener.current.focus();
    }}>
      <AlertDialogHeader>
        <AlertDialogTitle>{target?.groupId != null ? "أرشفة طلب هذا الطالب فقط" : "أرشفة الطلب الفردي"}</AlertDialogTitle>
        <AlertDialogDescription>
          {target?.groupId != null
            ? "يُلغى طلب هذا الطالب وحده ويُؤرشف مع حفظ سجله. لن تُمسح المجموعة أو دفعاتها."
            : "يُلغى هذا الطلب الفردي ويُؤرشف من القوائم مع الاحتفاظ بسجله التاريخي."}
          {" إذا عليه دفعة أو بدأ إنتاجه، سيمنع النظام الأرشفة ويوضح السبب."}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="flex min-w-0 flex-col gap-1">
        <strong className="break-words">{target?.customerName}</strong>
        <bdi className="break-words text-sm text-muted-foreground">{target?.orderNo}</bdi>
      </div>
      {issue ? <Alert variant="destructive"><AlertTitle>تعذرت الأرشفة</AlertTitle><AlertDescription className="break-words">{issue}</AlertDescription></Alert> : null}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={remove.isPending}>رجوع بدون أرشفة</AlertDialogCancel>
        <Button type="button" variant="destructive" disabled={remove.isPending || !target || !canArchive(target)} onClick={confirm}>
          {remove.isPending ? <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          {remove.isPending ? "جارٍ الأرشفة…" : "تأكيد إلغاء وأرشفة الطلب"}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
  return {canArchive, request, isPending:remove.isPending, confirmation};
}
