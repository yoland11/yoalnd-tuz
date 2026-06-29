import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { subscribeToPushNotifications } from "@/lib/pwa";
import { adminFetch } from "./_lib";

type NotificationRow = {
  id: number;
  title: string;
  body: string;
  type: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationResponse = {
  data: NotificationRow[];
  unreadCount: number;
};

export function AdminNotificationsBell() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const previousUnread = useRef(0);
  const { data, isLoading } = useQuery<NotificationResponse>({
    queryKey: ["admin", "notifications", "bell"],
    queryFn: () => adminFetch("/admin/notifications?limit=6"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  useEffect(() => {
    const next = data?.unreadCount ?? 0;
    if (previousUnread.current > 0 && next > previousUnread.current) {
      toast({ title: "إشعار جديد", description: data?.data?.[0]?.title });
    }
    previousUnread.current = next;
  }, [data?.data, data?.unreadCount, toast]);

  const markAll = useMutation({
    mutationFn: () => adminFetch("/admin/notifications/mark-all-read", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "notifications"] });
    },
  });

  const enablePush = useMutation({
    mutationFn: subscribeToPushNotifications,
    onSuccess: () => toast({ title: "تم تفعيل إشعارات المتصفح" }),
    onError: (err: any) => toast({ title: "تعذر تفعيل الإشعارات", description: err?.message, variant: "destructive" }),
  });

  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/30 bg-card text-muted-foreground hover:text-primary"
        aria-label="الإشعارات"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -left-1 min-w-5 rounded-full bg-status-danger px-1.5 py-0.5 text-[11px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount.toLocaleString("ar-IQ")}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border/40 bg-card p-3 shadow-2xl" dir="rtl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">الإشعارات</p>
              <p className="text-xs text-muted-foreground">{unreadCount.toLocaleString("ar-IQ")} غير مقروء</p>
            </div>
            <button type="button" onClick={() => markAll.mutate()} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-primary">
              <CheckCheck className="w-4 h-4" />
            </button>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : !data?.data.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">لا توجد إشعارات</p>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2">
              {data.data.map((item) => (
                <a
                  key={item.id}
                  href={item.href ?? "/admin/notifications"}
                  className={`block rounded-lg border p-3 transition-colors hover:border-primary/40 ${item.readAt ? "border-border/25 bg-background/40" : "border-primary/25 bg-primary/10"}`}
                >
                  <p className="text-sm font-medium text-foreground">{item.title}</p>
                  {item.body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.body}</p>}
                </a>
              ))}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => enablePush.mutate()}
              disabled={enablePush.isPending}
              className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20 disabled:opacity-60"
            >
              تفعيل Push
            </button>
            <Link href="/admin/notifications" className="inline-flex items-center justify-center gap-1 rounded-lg border border-border/30 px-3 py-2 text-xs text-muted-foreground hover:text-primary">
              عرض الكل <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
