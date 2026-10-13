import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ImageIcon, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, formatCurrency } from "@/views/admin/_lib";
import { PAYMENT_METHOD_LABELS, repApi } from "./shared";

export type PendingRepPayment = {
  id: number;
  group_id: number;
  graduation_order_id: number;
  amount: string;
  payment_method: string;
  receipt_number: string | null;
  occurred_at: string | null;
  notes: string | null;
  representative_name: string;
  created_at: string;
  has_receipt_image: boolean;
  status: "pending" | "processing";
  /** An approval was interrupted long enough ago to be retried safely. */
  staleProcessing: boolean;
  studentName: string;
  studentCode: string;
  studentRemaining: string;
  groupTitle: string;
  groupNo: string;
};

type PendingResponse = { items: PendingRepPayment[]; count: number; amount: number };

/** Every representative payment waiting for the administration (admins only). */
export function usePendingRepPayments(enabled: boolean) {
  return useQuery({
    queryKey: ["representative", "payments", "pending"],
    queryFn: () => repApi<PendingResponse>("/payments/pending"),
    enabled,
    refetchInterval: 60_000,
  });
}

/** Slim reminder shown across the portal while payments wait for approval. */
export function PendingPaymentsBanner({ count, amount }: { count: number; amount: number }) {
  if (!count) return null;
  return (
    <Link href="/representative/payments" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {count} دفعة من ممثلي المجموعات بانتظار اعتمادك بمجموع {formatCurrency(amount)}</span>
      <b>مراجعة واعتماد ←</b>
    </Link>
  );
}

/**
 * «دفعات بانتظار الاعتماد»: approve or reject representatives' payments from
 * one place, across all groups. Uses the existing approve/reject routes
 * (approval posts the payment through the canonical receivePayment path).
 */
export function PendingApprovals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const pending = usePendingRepPayments(true);
  const [image, setImage] = useState<{ title: string; src: string } | null>(null);
  const [loadingImage, setLoadingImage] = useState<number | null>(null);
  const decide = useMutation({
    mutationFn: ({ id, action, note }: { id: number; action: "approve" | "reject"; note?: string }) =>
      repApi(`/payments/${id}/${action}`, { method: "POST", body: JSON.stringify(note ? { note } : {}) }),
    onSuccess: (_data, variables) =>
      toast({ title: variables.action === "approve" ? "تم اعتماد الدفعة وإصدار الوصل" : "تم رفض الدفعة" }),
    onError: (error) => toast({ title: "تعذر تنفيذ الإجراء", description: apiErrorMessage(error), variant: "destructive" }),
    // Refresh after failures too: the request may have changed meanwhile.
    onSettled: () => void qc.invalidateQueries({ queryKey: ["representative"] }),
  });
  // Oldest first: a later request that pushes one student past the remaining
  // balance is most likely the same payment entered twice.
  const exceeding = new Set<number>();
  const running = new Map<number, number>();
  for (const item of pending.data?.items ?? []) {
    const total = (running.get(item.graduation_order_id) ?? 0) + Number(item.amount);
    running.set(item.graduation_order_id, total);
    if (total > Number(item.studentRemaining) + 0.009) exceeding.add(item.id);
  }
  async function showImage(item: PendingRepPayment) {
    setLoadingImage(item.id);
    try {
      const { image: src } = await repApi<{ image: string }>(`/payments/${item.id}/image`);
      setImage({ title: `${item.studentName} — ${formatCurrency(Number(item.amount))}`, src });
    } catch (error) {
      toast({ title: "تعذر عرض صورة الوصل", description: apiErrorMessage(error), variant: "destructive" });
    } finally {
      setLoadingImage(null);
    }
  }

  return (
    <Card className="border-amber-200 dark:border-amber-900">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold">دفعات بانتظار اعتماد الإدارة</h3>
            <p className="text-xs text-muted-foreground">لا تُحتسب على الطالب ولا تدخل الصندوق قبل الاعتماد. الاعتماد يسجّل الدفعة ويُصدر وصلها.</p>
          </div>
          {pending.data ? <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-200">{pending.data.count} · {formatCurrency(pending.data.amount)}</span> : null}
        </div>
        {pending.isPending ? <Skeleton className="h-24" /> : pending.isError ? (
          <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <span>{apiErrorMessage(pending.error)}</span>
            <Button size="sm" variant="outline" onClick={() => void pending.refetch()}>إعادة المحاولة</Button>
          </div>
        ) : !pending.data?.items.length ? (
          <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">لا توجد دفعات بانتظار الاعتماد.</p>
        ) : (
          <div className="divide-y rounded-xl border">
            {pending.data.items.map((item) => (
              <div key={item.id} className="grid gap-2 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="font-semibold">{item.studentName} <span className="text-xs font-normal text-muted-foreground">{item.studentCode}</span></div>
                  <div className="text-xs text-muted-foreground">{item.groupTitle} · {item.groupNo} · الممثل: {item.representative_name}</div>
                  {item.notes ? <div className="mt-1 text-xs">ملاحظة: {item.notes}</div> : null}
                </div>
                <div className="text-sm">
                  <div className="font-bold tabular-nums">{formatCurrency(Number(item.amount))}</div>
                  <div className="text-xs text-muted-foreground">
                    {PAYMENT_METHOD_LABELS[item.payment_method] || item.payment_method}
                    {item.receipt_number ? <> · وصل <bdi dir="ltr">{item.receipt_number}</bdi></> : null}
                    {" · "}<bdi dir="ltr">{new Date(item.occurred_at || item.created_at).toLocaleDateString("en-GB")}</bdi>
                  </div>
                  <div className="text-[11px] text-muted-foreground">متبقي الطالب حالياً: {formatCurrency(Number(item.studentRemaining))}</div>
                  {exceeding.has(item.id) ? (
                    <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-600">
                      <AlertTriangle className="h-3.5 w-3.5" />مع دفعات الطالب المعلّقة تتجاوز المتبقي — قد تكون مكررة
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.has_receipt_image ? (
                    <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={loadingImage === item.id} onClick={() => void showImage(item)}>
                      {loadingImage === item.id ? <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="ml-1 h-3.5 w-3.5" />}صورة الوصل
                    </Button>
                  ) : null}
                  {item.status === "processing" && !item.staleProcessing ? (
                    <span className="inline-flex h-8 items-center gap-1 rounded-md bg-amber-50 px-2 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />قيد الاعتماد
                    </span>
                  ) : (
                    <Button size="sm" className="h-8 bg-emerald-600 px-2 text-xs text-white hover:bg-emerald-700" disabled={decide.isPending}
                      onClick={() => { if (window.confirm(`اعتماد دفعة ${item.studentName} بمبلغ ${formatCurrency(Number(item.amount))}؟ ستُضاف إلى رصيد الطالب ويُصدر وصل.`)) decide.mutate({ id: Number(item.id), action: "approve" }); }}>
                      <Check className="ml-1 h-3.5 w-3.5" />{item.status === "processing" ? "إعادة الاعتماد" : "اعتماد"}
                    </Button>
                  )}
                  {item.status === "pending" ? (
                    <Button size="sm" variant="outline" className="h-8 px-2 text-xs text-destructive" disabled={decide.isPending}
                      onClick={() => { const note = window.prompt("سبب الرفض")?.trim(); if (note) decide.mutate({ id: Number(item.id), action: "reject", note }); }}>
                      <X className="ml-1 h-3.5 w-3.5" />رفض
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <Dialog open={Boolean(image)} onOpenChange={(open) => !open && setImage(null)}>
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader><DialogTitle>صورة الوصل — {image?.title}</DialogTitle></DialogHeader>
          {image ? <img src={image.src} alt="صورة وصل الدفعة" className="max-h-[70vh] w-full rounded-lg object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
