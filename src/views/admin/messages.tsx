import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";
import { formatIraqiPhone } from "@/lib/phone";

type Reply = { id: number; senderType: "customer" | "admin"; body: string; createdAt: string };
type Thread = {
  id: number;
  phone: string | null;
  customerName: string;
  subject: string;
  status: string;
  lastMessageAt: string | null;
  createdAt: string | null;
  replies: Reply[];
};

const STATUS_LABELS: Record<string, string> = {
  new: "جديدة",
  read: "مقروءة",
  replied: "تم الرد",
  closed: "مغلقة",
};

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("ar-IQ", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function MessagesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reply, setReply] = useState("");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (search.trim()) params.set("q", search.trim());
    return params.toString();
  }, [search, status]);

  const { data: threads, isLoading } = useQuery<Thread[]>({
    queryKey: ["admin", "messages", queryString],
    queryFn: () => adminFetch(`/admin/messages${queryString ? `?${queryString}` : ""}`),
    staleTime: 15_000,
  });

  const { data: selected } = useQuery<Thread>({
    queryKey: ["admin", "messages", selectedId],
    queryFn: () => adminFetch(`/admin/messages/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 5_000,
  });

  const sendReply = useMutation({
    mutationFn: () => adminFetch<Thread>(`/admin/messages/${selectedId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body: reply }),
    }),
    onSuccess: () => {
      toast({ title: "تم إرسال الرد" });
      setReply("");
      qc.invalidateQueries({ queryKey: ["admin", "messages"] });
      qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    onError: (err: any) => toast({ title: "تعذر إرسال الرد", description: err?.message, variant: "destructive" }),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, nextStatus }: { id: number; nextStatus: string }) => adminFetch(`/admin/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "messages"] }),
    onError: (err: any) => toast({ title: "تعذر تعديل الحالة", description: err?.message, variant: "destructive" }),
  });

  const activeThread = selected ?? threads?.find((thread) => thread.id === selectedId) ?? null;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">مركز رسائل الزبائن</h1>
          <p className="text-sm text-muted-foreground mt-1">استقبال رسائل الموقع والرد عليها من داخل لوحة الإدارة.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-muted-foreground">
          <MessageCircle className="w-4 h-4 text-primary" />
          {(threads?.filter((thread) => thread.status === "new").length ?? 0).toLocaleString("ar-IQ")} جديدة
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الهاتف أو الموضوع..."
              className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-background border border-border/40 rounded-lg px-3 py-2 text-sm">
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Button type="button" variant="outline" onClick={() => { setStatus(""); setSearch(""); }}>تصفية</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          {isLoading ? (
            <div className="p-3 space-y-2">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-20 rounded-xl" />)}</div>
          ) : !threads?.length ? (
            <EmptyState message="لا توجد رسائل" />
          ) : (
            <div className="divide-y divide-border/20">
              {threads.map((thread) => {
                const last = thread.replies?.[0];
                return (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => setSelectedId(thread.id)}
                    className={`w-full text-right p-4 hover:bg-background/40 transition-colors ${selectedId === thread.id ? "bg-primary/10" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-foreground truncate">{thread.customerName || "زبون"}</p>
                      <span className="rounded-full bg-background border border-border/30 px-2 py-0.5 text-[11px] text-muted-foreground">{STATUS_LABELS[thread.status] ?? thread.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{formatIraqiPhone(thread.phone ?? "") || thread.phone || "بدون هاتف"}</p>
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{last?.body || thread.subject}</p>
                    <p className="text-[11px] text-muted-foreground mt-2">{formatDate(thread.lastMessageAt)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border/30 min-h-[460px] flex flex-col">
          {!activeThread ? (
            <EmptyState message="اختر محادثة لعرض الرسائل" />
          ) : (
            <>
              <div className="p-4 border-b border-border/30 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-foreground">{activeThread.customerName || "زبون"}</h2>
                  <p className="text-xs text-muted-foreground">{activeThread.subject} · {formatIraqiPhone(activeThread.phone ?? "") || activeThread.phone}</p>
                </div>
                <select
                  value={activeThread.status}
                  onChange={(e) => changeStatus.mutate({ id: activeThread.id, nextStatus: e.target.value })}
                  className="bg-background border border-border/40 rounded-lg px-3 py-2 text-xs"
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[520px]">
                {(activeThread.replies ?? []).map((item) => (
                  <div key={item.id} className={`flex ${item.senderType === "admin" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm border ${
                      item.senderType === "admin"
                        ? "bg-primary/10 border-primary/25 text-foreground"
                        : "bg-background border-border/30 text-foreground"
                    }`}>
                      <p className="whitespace-pre-wrap">{item.body}</p>
                      <p className="text-[10px] text-muted-foreground mt-2">{formatDate(item.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <form
                className="p-4 border-t border-border/30 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendReply.mutate();
                }}
              >
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="اكتب ردك..."
                  className="flex-1 bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                />
                <Button type="submit" disabled={!reply.trim() || sendReply.isPending} className="gap-2">
                  <Send className="w-4 h-4" /> إرسال
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
