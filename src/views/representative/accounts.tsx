import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, Eye, EyeOff, KeyRound, MessageCircle, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";

/** Everything a representative needs inside their own group (same set as existing representative accounts). */
export const REPRESENTATIVE_ACCOUNT_PERMISSIONS = [
  "representative.portal.access",
  "representative.group.view",
  "representative.students.manage",
  "representative.payments.create",
  "representative.receipts.print",
  "representative.measurements.edit",
  "representative.reminders.send",
  "representative.delivery.confirm",
  "representative.issues.create",
  "representative.reports.export",
];

type GroupRow = {
  id: number;
  title: string;
  groupNo: string;
  representativeName?: string | null;
  representativePhone?: string | null;
  status?: string | null;
};
type AssignmentRow = {
  id: number;
  staffId: number;
  groupId: number;
  isActive: boolean;
  representativeName?: string | null;
  representativeUsername?: string | null;
};

function loginUrl() {
  return typeof window === "undefined" ? "/representative/login" : `${window.location.origin}/representative/login`;
}

function whatsappPhone(phone?: string | null) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.startsWith("0") ? `964${digits.slice(1)}` : digits;
}

function credentialsText(input: { name: string; group: string; username: string; password: string }) {
  return [
    `مرحباً ${input.name}،`,
    `تم إنشاء حسابك في بوابة ممثلي الدفعات — ${input.group}.`,
    `رابط الدخول: ${loginUrl()}`,
    `اسم المستخدم: ${input.username}`,
    `كلمة المرور: ${input.password}`,
    "بعد الدخول تشوف طلاب دفعتك ومدفوعاتهم وقياساتهم فقط.",
  ].join("\n");
}

/**
 * Groups and their recorded representative: who already has a login and who
 * does not, with one-step account creation (existing staff creation route,
 * then the existing assignment route).
 */
export function RepresentativeAccounts({ groups, items }: { groups: GroupRow[]; items: AssignmentRow[] }) {
  const [target, setTarget] = useState<GroupRow | null>(null);
  const linked = (groupId: number) => items.filter((item) => item.isActive && item.groupId === groupId);
  return (
    <Card className="border-rose-100 dark:border-slate-800">
      <CardContent className="space-y-3 p-4">
        <div>
          <h3 className="font-bold">ممثلو المجموعات وحسابات الدخول</h3>
          <p className="text-sm text-muted-foreground">
            الممثل يدخل من <b dir="ltr">/representative/login</b> باسم مستخدم وكلمة مرور. اسم الممثل المسجّل على المجموعة وحده لا يكفي للدخول — أنشئ له حساباً.
          </p>
        </div>
        <div className="divide-y rounded-xl border">
          {groups.map((group) => {
            const accounts = linked(group.id);
            return (
              <div key={group.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-semibold">{group.title} <span className="text-xs font-normal text-muted-foreground">{group.groupNo}</span></div>
                  <div className="text-sm text-muted-foreground">
                    الممثل: {group.representativeName || "غير مسجّل"}
                    {group.representativePhone ? <> · <span dir="ltr" className="inline-block">{group.representativePhone}</span></> : null}
                  </div>
                </div>
                {accounts.length ? (
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> له حساب: {accounts.map((item) => item.representativeUsername).join("، ")}
                  </Badge>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">بدون حساب دخول</Badge>
                    <Button size="sm" className="bg-[#e91e63] hover:bg-[#d81b60]" onClick={() => setTarget(group)}>
                      <UserPlus className="h-4 w-4" /> إنشاء حساب دخول
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
      {target ? <CreateAccountDialog group={target} onClose={() => setTarget(null)} /> : null}
    </Card>
  );
}

function CreateAccountDialog({ group, onClose }: { group: GroupRow; onClose: () => void }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const phoneDigits = String(group.representativePhone ?? "").replace(/\D/g, "");
  const [fullName, setFullName] = useState(group.representativeName || "");
  const [username, setUsername] = useState(phoneDigits ? `rep${phoneDigits.slice(-6)}` : "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(true);
  const [done, setDone] = useState<{ username: string; password: string; assigned: boolean } | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const staff = await adminFetch<{ id?: number; staff?: { id: number } }>("/admin/staff", {
        method: "POST",
        body: JSON.stringify({
          username: username.trim(),
          password,
          fullName: fullName.trim(),
          role: "employee",
          department: "graduation",
          jobTitle: "ممثل دفعة",
          permissions: REPRESENTATIVE_ACCOUNT_PERMISSIONS,
        }),
      });
      const staffId = Number(staff?.id ?? staff?.staff?.id);
      if (!staffId) throw new Error("تم إنشاء الحساب لكن لم يصل رقمه؛ اربطه بالمجموعة من القائمة أعلاه");
      try {
        await adminFetch("/admin/representative/assignments", {
          method: "POST",
          body: JSON.stringify({ staffId, groupId: group.id }),
        });
        return { assigned: true };
      } catch (cause) {
        // The login exists; linking can be retried from the assignment form.
        toast({ title: "أُنشئ الحساب لكن تعذّر ربطه بالمجموعة", description: apiErrorMessage(cause), variant: "destructive" });
        return { assigned: false };
      }
    },
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ["representative", "assignments"] });
      setDone({ username: username.trim(), password, assigned: result.assigned });
    },
    onError: (error) => toast({ title: "تعذر إنشاء حساب الممثل", description: apiErrorMessage(error), variant: "destructive" }),
  });

  const valid = fullName.trim().length >= 2 && /^[A-Za-z0-9._-]{3,50}$/.test(username.trim()) && password.trim().length >= 6;
  const message = done ? credentialsText({ name: fullName.trim(), group: group.title, username: done.username, password: done.password }) : "";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> حساب دخول ممثل — {group.title}</DialogTitle>
          <DialogDescription>
            يُنشأ حساب موظف بصلاحيات بوابة الممثلين فقط، ويُربط بهذه المجموعة. الممثل يرى مجموعته فقط.
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              {done.assigned ? "تم إنشاء الحساب وربطه بالمجموعة." : "تم إنشاء الحساب. اربطه بالمجموعة من نموذج التعيين."}
            </div>
            <pre className="whitespace-pre-wrap rounded-xl border bg-muted/40 p-3 text-sm" dir="rtl">{message}</pre>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(message).then(() => toast({ title: "تم نسخ بيانات الدخول" }))}>
                <Copy className="h-4 w-4" /> نسخ
              </Button>
              {group.representativePhone ? (
                <Button variant="outline" asChild>
                  <a href={`https://wa.me/${whatsappPhone(group.representativePhone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                    <MessageCircle className="h-4 w-4" /> إرسال للممثل عبر واتساب
                  </a>
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">كلمة المرور لا تُعرض مرة ثانية. يمكن تغييرها لاحقاً من إدارة الموظفين.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rep-full-name">اسم الممثل</Label>
              <Input id="rep-full-name" value={fullName} maxLength={120} onChange={(event) => setFullName(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rep-username">اسم المستخدم (إنجليزي أو أرقام)</Label>
              <Input id="rep-username" dir="ltr" value={username} maxLength={50} onChange={(event) => setUsername(event.target.value.replace(/\s/g, ""))} placeholder="rep123456" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rep-password">كلمة المرور (6 أحرف على الأقل)</Label>
              <div className="flex gap-2">
                <Input id="rep-password" dir="ltr" type={showPassword ? "text" : "password"} value={password} maxLength={100} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
                <Button type="button" variant="outline" size="icon" aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>{done ? "إغلاق" : "إلغاء"}</Button>
          {!done ? (
            <Button className="bg-[#e91e63] hover:bg-[#d81b60]" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
              <UserPlus className="h-4 w-4" /> إنشاء وربط الحساب
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
