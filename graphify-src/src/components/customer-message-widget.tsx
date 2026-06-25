import { useState } from "react";
import type { FormEvent } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { formatIraqiPhoneInput } from "@/lib/phone";

function sessionId() {
  if (typeof window === "undefined") return "anonymous";
  const key = "ajn_customer_activity_session";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, next);
  return next;
}

export function CustomerMessageWidget() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-session-id": sessionId() },
        body: JSON.stringify({ name, phone, message, sessionId: sessionId() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "تعذر إرسال الرسالة");
      setStatus("sent");
      setMessage("");
      setTimeout(() => setOpen(false), 900);
    } catch (err: any) {
      setError(err?.message || "تعذر إرسال الرسالة");
      setStatus("error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="رسالة للمحل"
        className="fixed bottom-36 left-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/30 bg-primary text-primary-foreground shadow-lg shadow-black/30 transition-transform hover:scale-105 md:bottom-20"
      >
        <MessageCircle className="h-6 w-6" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end justify-center p-4 md:items-center" dir="rtl" onClick={() => setOpen(false)}>
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-border/40 bg-card p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-bold text-foreground">رسالة للمحل</h2>
                <p className="text-xs text-muted-foreground mt-1">اكتب رسالتك وسنرد عليك من لوحة الإدارة.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="الاسم"
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(formatIraqiPhoneInput(e.target.value))}
                placeholder="رقم الهاتف"
                inputMode="numeric"
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="نص الرسالة"
                rows={4}
                className="w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              {status === "sent" && <p className="text-xs text-primary">تم إرسال الرسالة</p>}
              <button
                type="submit"
                disabled={status === "sending" || !message.trim()}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                <Send className="w-4 h-4" /> إرسال
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
