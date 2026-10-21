import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus, Search, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/query-client";
import {
  PRIORITY_LABELS,
  catalogDepartment,
  newCatalogKey,
  type WorkCatalog,
  type WorkDepartmentConfig,
  type WorkOrderTypeConfig,
} from "@/lib/work-commands";
import { adminFetch, apiErrorMessage } from "@/views/admin/_lib";
import { Empty, Failure, fieldClass, useWorkCatalog, useWorkMe, workKeys } from "./shared";

type TeamMember = {
  id: number;
  name: string;
  role: string;
  jobTitle: string | null;
  staffDepartment: string | null;
  departmentLabel: string;
  canIssue: boolean;
  explicit: boolean;
  lockedBy: "manager" | "task_create" | "booking_tasks_manage" | null;
};
type TeamData = { members: TeamMember[]; staffDepartments: Array<{ value: string; department: string }>; canGrant: boolean };

const LOCK_LABELS: Record<string, string> = {
  manager: "مفعّلة لأنه من الإدارة",
  task_create: "مفعّلة عبر صلاحية «إنشاء مهام الموظفين»",
  booking_tasks_manage: "مفعّلة عبر صلاحية مهام الحجوزات",
};

function Section({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold">{title}</h2>
          <p className="mt-0.5 max-w-prose text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function useTeam() {
  return useQuery({ queryKey: workKeys.team, queryFn: () => adminFetch<TeamData>("/admin/work-commands/team") });
}

// ─── Order types and departments ────────────────────────────────────────────

function OrderTypeRow({
  item,
  departments,
  expanded,
  onToggle,
  onChange,
}: {
  item: WorkOrderTypeConfig;
  departments: WorkDepartmentConfig[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (next: WorkOrderTypeConfig) => void;
}) {
  const department = departments.find((entry) => entry.key === item.department);
  const set = (patch: Partial<WorkOrderTypeConfig>) => onChange({ ...item, ...patch });
  return (
    <li className={item.active ? undefined : "bg-muted/30"}>
      <div className="flex min-h-14 items-center gap-3 px-4 py-2">
        <Button type="button" variant="ghost" onClick={onToggle} aria-expanded={expanded} className="flex h-auto min-w-0 flex-1 items-center justify-start gap-2 px-1 py-1 text-start">
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          <span className="min-w-0">
            <span className={`block truncate text-sm font-extrabold ${item.active ? "" : "text-muted-foreground"}`}>{item.label || "نوع جديد"}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {department?.label ?? "الإدارة العامة"}
              {item.requiresApproval ? " · يتطلب اعتماد" : ""}
              {item.evidenceRequired ? " · دليل إنجاز" : ""}
              {item.builtIn ? "" : " · مضاف"}
            </span>
          </span>
        </Button>
        <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-muted-foreground">
          {item.active ? "مفعّل" : "متوقف"}
          <Switch checked={item.active} onCheckedChange={(active) => set({ active })} aria-label={`تفعيل ${item.label}`} />
        </label>
      </div>
      {expanded ? (
        <div className="grid gap-3 border-t border-dashed border-border bg-muted/20 px-4 py-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-bold">اسم النوع<Input value={item.label} onChange={(event) => set({ label: event.target.value })} placeholder="مثال: أمر تصميم دعوة" className="min-h-11 font-normal" maxLength={60} /></label>
          <label className="space-y-1 text-sm font-bold">العنوان الافتراضي للأمر<Input value={item.title} onChange={(event) => set({ title: event.target.value })} className="min-h-11 font-normal" maxLength={120} /></label>
          <label className="space-y-1 text-sm font-bold">القسم
            <select value={item.department} onChange={(event) => set({ department: event.target.value })} className={`${fieldClass} font-normal`}>
              {departments.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}{entry.active ? "" : " (متوقف)"}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm font-bold">الأولوية
              <select value={item.priority} onChange={(event) => set({ priority: event.target.value as WorkOrderTypeConfig["priority"] })} className={`${fieldClass} font-normal`}>
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-sm font-bold">الوقت (دقيقة)<Input type="number" inputMode="numeric" min={0} value={item.estimatedMinutes || ""} onChange={(event) => set({ estimatedMinutes: Number(event.target.value) || 0 })} className="min-h-11 font-normal" dir="ltr" /></label>
          </div>
          <label className="space-y-1 text-sm font-bold sm:col-span-2">قائمة التحقق (بند في كل سطر)
            <Textarea value={item.checklist.join("\n")} onChange={(event) => set({ checklist: event.target.value.split("\n").map((line) => line.trimStart()).slice(0, 30) })} rows={3} className="font-normal" />
          </label>
          <div className="divide-y divide-border rounded-xl border border-border bg-card sm:col-span-2">
            <label className="flex min-h-12 items-center justify-between gap-3 px-3 text-sm font-bold">يتطلب اعتماد الإنجاز<Switch checked={item.requiresApproval} onCheckedChange={(requiresApproval) => set({ requiresApproval })} /></label>
            <label className="flex min-h-12 items-center justify-between gap-3 px-3 text-sm font-bold">يتطلب دليل إنجاز<Switch checked={item.evidenceRequired} onCheckedChange={(evidenceRequired) => set({ evidenceRequired })} /></label>
            {item.evidenceRequired ? (
              <label className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm font-bold">نوع الدليل<Input value={item.evidenceHint} onChange={(event) => set({ evidenceHint: event.target.value })} placeholder="مثال: صورة بعد التنفيذ" className="min-h-10 flex-1 font-normal" maxLength={120} /></label>
            ) : null}
            <label className="flex min-h-12 items-center justify-between gap-3 px-3 text-sm font-bold">يرتبط عادة بحجز<Switch checked={item.needsBooking} onCheckedChange={(needsBooking) => set({ needsBooking })} /></label>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function DepartmentRow({
  item,
  expanded,
  onToggle,
  onChange,
  onAssign,
  staffDepartments,
  catalog,
}: {
  item: WorkDepartmentConfig;
  expanded: boolean;
  onToggle: () => void;
  onChange: (next: WorkDepartmentConfig) => void;
  /** Move a staff department value to this department (or back to its default). */
  onAssign: (value: string, key: string | null) => void;
  staffDepartments: TeamData["staffDepartments"];
  catalog: WorkCatalog;
}) {
  const set = (patch: Partial<WorkDepartmentConfig>) => onChange({ ...item, ...patch });
  return (
    <li className={item.active ? undefined : "bg-muted/30"}>
      <div className="flex min-h-14 items-center gap-3 px-4 py-2">
        <Button type="button" variant="ghost" onClick={onToggle} aria-expanded={expanded} className="flex h-auto min-w-0 flex-1 items-center justify-start gap-2 px-1 py-1 text-start">
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          <span className="min-w-0">
            <span className={`block truncate text-sm font-extrabold ${item.active ? "" : "text-muted-foreground"}`}>{item.label || "قسم جديد"}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {item.key === "general"
                ? ["يراها كل الموظفين", staffDepartments.some((entry) => catalogDepartment(catalog, entry.value) === "general" && entry.value !== "general") ? `أقسام غير مرتبطة: ${staffDepartments.filter((entry) => catalogDepartment(catalog, entry.value) === "general" && entry.value !== "general").map((entry) => entry.value).join("، ")}` : ""].filter(Boolean).join(" · ")
                : staffDepartments.filter((entry) => catalogDepartment(catalog, entry.value) === item.key).map((entry) => entry.value).join("، ") || "لا يوجد موظفون مرتبطون بعد"}
            </span>
          </span>
        </Button>
        <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-muted-foreground">
          {item.active ? "مفعّل" : "متوقف"}
          <Switch checked={item.active} disabled={item.key === "general"} onCheckedChange={(active) => set({ active })} aria-label={`تفعيل ${item.label}`} />
        </label>
      </div>
      {expanded ? (
        <div className="space-y-3 border-t border-dashed border-border bg-muted/20 px-4 py-4">
          <label className="block space-y-1 text-sm font-bold">اسم القسم (واسم قناته)<Input value={item.label} onChange={(event) => set({ label: event.target.value })} className="min-h-11 font-normal" maxLength={60} /></label>
          <div className="space-y-1.5">
            <p className="text-sm font-bold">موظفو هذه الأقسام يرون قناته</p>
            <p className="text-xs leading-5 text-muted-foreground">القيم من حقل «القسم» في بطاقات الموظفين.</p>
            <div className="flex flex-wrap gap-1.5">
              {staffDepartments.map((entry) => {
                const mappedTo = catalogDepartment(catalog, entry.value);
                const explicit = item.aliases.includes(entry.value);
                const selected = mappedTo === item.key;
                // Mapped by a built-in rule: change it by assigning the value to another department.
                const automatic = selected && !explicit;
                const elsewhere = !selected ? catalog.departments.find((department) => department.key === mappedTo) : null;
                return (
                  <Button
                    key={entry.value}
                    type="button"
                    size="compact"
                    variant={selected ? "selected" : "outline"}
                    aria-pressed={selected}
                    disabled={automatic}
                    title={automatic ? "مرتبط تلقائياً بهذا القسم" : undefined}
                    onClick={() => onAssign(entry.value, explicit ? null : item.key)}
                  >
                    {entry.value}
                    {automatic ? <span className="text-[11px] font-normal">(تلقائي)</span> : null}
                    {elsewhere && elsewhere.key !== "general" ? <span className="text-[11px] font-normal text-muted-foreground">({elsewhere.label})</span> : null}
                  </Button>
                );
              })}
              {!staffDepartments.length ? <span className="text-xs text-muted-foreground">لا توجد أقسام في بطاقات الموظفين.</span> : null}
            </div>
          </div>
          {item.key === "general" ? <p className="text-xs text-muted-foreground">الإدارة العامة لا تُوقف: يراها كل الموظفين.</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function CatalogEditor() {
  const { toast } = useToast();
  const me = useWorkMe();
  const catalog = useWorkCatalog();
  const team = useTeam();
  const [draft, setDraft] = useState<WorkCatalog>(catalog);
  const [open, setOpen] = useState<string | null>(null);
  const saved = JSON.stringify(catalog);
  useEffect(() => setDraft(JSON.parse(saved)), [saved]);
  const dirty = JSON.stringify(draft) !== saved;
  const save = useMutation({
    mutationFn: () => adminFetch<{ catalog: WorkCatalog }>("/admin/work-commands/catalog", { method: "PUT", body: JSON.stringify(draft) }),
    onSuccess: (result) => {
      queryClient.setQueryData(workKeys.me, (current: unknown) => (current && typeof current === "object" ? { ...current, catalog: result.catalog } : current));
      void queryClient.invalidateQueries({ queryKey: ["work-commands"] });
      toast({ title: "تم حفظ الأقسام وأنواع الأوامر" });
    },
    onError: (error) => toast({ variant: "destructive", title: "تعذر الحفظ", description: apiErrorMessage(error) }),
  });
  const staffDepartments = team.data?.staffDepartments ?? [];

  if (!me.data?.access.canManageCatalog) return null;
  return (
    <>
      <Section
        title="أنواع الأوامر"
        description="تظهر في نافذة إصدار الأمر. النوع يحدد القسم وقائمة التحقق والاعتماد والدليل الافتراضي. الأنواع الأساسية تُوقف ولا تُحذف حتى تبقى الأوامر القديمة مفهومة."
        action={
          <Button type="button" variant="outline" size="compact" className="gap-1" onClick={() => {
            const key = newCatalogKey("type", draft.orderTypes.map((item) => item.key));
            setDraft({ ...draft, orderTypes: [...draft.orderTypes, { key, label: "", title: "", department: "general", priority: "medium", estimatedMinutes: 0, checklist: [], evidenceRequired: false, evidenceHint: "", requiresApproval: false, needsBooking: false, active: true, builtIn: false }] });
            setOpen(`type:${key}`);
          }}><Plus className="h-3.5 w-3.5" />نوع جديد</Button>
        }
      >
        <ul className="divide-y divide-border">
          {draft.orderTypes.map((item) => (
            <OrderTypeRow
              key={item.key}
              item={item}
              departments={draft.departments}
              expanded={open === `type:${item.key}`}
              onToggle={() => setOpen(open === `type:${item.key}` ? null : `type:${item.key}`)}
              onChange={(next) => setDraft({ ...draft, orderTypes: draft.orderTypes.map((entry) => (entry.key === item.key ? next : entry)) })}
            />
          ))}
        </ul>
      </Section>

      <Section
        title="الأقسام"
        description="كل قسم مفعّل له قناة محادثة. اسم القسم هو اسم قناته، والموظف يرى قناة قسمه حسب حقل «القسم» في بطاقته."
        action={
          <Button type="button" variant="outline" size="compact" className="gap-1" onClick={() => {
            const key = newCatalogKey("dept", draft.departments.map((item) => item.key));
            setDraft({ ...draft, departments: [...draft.departments, { key, label: "", aliases: [], active: true, builtIn: false }] });
            setOpen(`dept:${key}`);
          }}><Plus className="h-3.5 w-3.5" />قسم جديد</Button>
        }
      >
        {team.isError ? <div className="p-4"><Failure title="تعذر تحميل أقسام الموظفين" error={team.error} onRetry={() => void team.refetch()} /></div> : null}
        <ul className="divide-y divide-border">
          {draft.departments.map((item) => (
            <DepartmentRow
              key={item.key}
              item={item}
              catalog={draft}
              staffDepartments={staffDepartments}
              expanded={open === `dept:${item.key}`}
              onToggle={() => setOpen(open === `dept:${item.key}` ? null : `dept:${item.key}`)}
              onChange={(next) => setDraft({ ...draft, departments: draft.departments.map((entry) => (entry.key === item.key ? next : entry)) })}
              onAssign={(value, key) =>
                setDraft({
                  ...draft,
                  departments: draft.departments.map((entry) => ({
                    ...entry,
                    aliases: entry.key === key ? [...entry.aliases.filter((alias) => alias !== value), value] : entry.aliases.filter((alias) => alias !== value),
                  })),
                })
              }
            />
          ))}
        </ul>
      </Section>

      {dirty ? (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/30 bg-card p-3 shadow-[0_8px_24px_-12px_hsl(var(--foreground)/0.35)]" role="status">
          <span className="me-auto text-sm font-bold">تغييرات غير محفوظة على الأقسام وأنواع الأوامر</span>
          <Button type="button" variant="outline" size="compact" disabled={save.isPending} onClick={() => setDraft(JSON.parse(saved))}>تراجع</Button>
          <Button type="button" size="compact" className="gap-1.5" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}حفظ التغييرات</Button>
        </div>
      ) : null}
    </>
  );
}

// ─── Who may issue orders ───────────────────────────────────────────────────

function IssuePermissions() {
  const { toast } = useToast();
  const team = useTeam();
  const [filter, setFilter] = useState("");
  const grant = useMutation({
    mutationFn: ({ member, allowed }: { member: TeamMember; allowed: boolean }) =>
      adminFetch<{ allowed: boolean; name: string }>(`/admin/work-commands/team/${member.id}/issue`, { method: "POST", body: JSON.stringify({ allowed }) }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: workKeys.team });
      toast({ title: result.allowed ? `${result.name} يستطيع الآن إصدار الأوامر` : `سُحبت صلاحية الإصدار من ${result.name}` });
    },
    onError: (error) => toast({ variant: "destructive", title: "تعذر تغيير الصلاحية", description: apiErrorMessage(error) }),
  });
  const members = useMemo(
    () => (team.data?.members ?? []).filter((member) => !filter.trim() || member.name.includes(filter.trim()) || member.departmentLabel.includes(filter.trim())),
    [team.data, filter],
  );
  const canGrant = Boolean(team.data?.canGrant);
  return (
    <Section
      title="من يستطيع إصدار الأوامر"
      description="فعّل الصلاحية لأي موظف ليصدر أوامر العمل من المحادثات. تُحفظ في صلاحيات الموظف نفسها وتظهر في شاشة الموظفين."
      action={
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="بحث عن موظف" aria-label="بحث عن موظف" className="min-h-10 pr-9" />
        </div>
      }
    >
      {team.isLoading ? <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />تحميل الفريق...</div> : null}
      {team.isError ? <div className="p-4"><Failure title="تعذر تحميل الفريق" error={team.error} onRetry={() => void team.refetch()} /></div> : null}
      {team.data && !canGrant ? <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-bold text-muted-foreground">منح الصلاحيات يحتاج صلاحية «إدارة الموظفين».</p> : null}
      {team.data ? (
        members.length ? (
          <ul className="divide-y divide-border">
            {members.map((member) => {
              const busy = grant.isPending && grant.variables?.member.id === member.id;
              return (
                <li key={member.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold">{member.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[member.jobTitle, member.departmentLabel].filter(Boolean).join(" · ")}</span>
                  </span>
                  {member.lockedBy ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" /><span className="max-sm:hidden">{LOCK_LABELS[member.lockedBy]}</span><span className="sm:hidden">مفعّلة</span></span>
                  ) : (
                    <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-muted-foreground">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : member.explicit ? "يصدر أوامر" : "لا يصدر"}
                      <Switch checked={member.explicit} disabled={!canGrant || grant.isPending || member.role === "admin"} onCheckedChange={(allowed) => grant.mutate({ member, allowed })} aria-label={`صلاحية إصدار الأوامر لـ ${member.name}`} />
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4"><Empty>لا يوجد موظف مطابق.</Empty></div>
        )
      ) : null}
    </Section>
  );
}

export function WorkSettingsPanel() {
  const me = useWorkMe();
  return (
    <div className="space-y-4">
      {me.data?.access.canManageCatalog ? <CatalogEditor /> : null}
      <IssuePermissions />
    </div>
  );
}
