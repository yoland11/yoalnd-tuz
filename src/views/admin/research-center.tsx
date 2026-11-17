import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bot,
  ExternalLink,
  FileCheck2,
  GraduationCap,
  Loader2,
  Plus,
  QrCode,
  Search,
  Settings,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, type AdminMe } from "./_lib";
import { researchAccess } from "./research/ui-model";
import { ResearchDashboard, ResearchOrders } from "./research/overview";
import { ResearchOrderForm } from "./research/order-form";
import { ResearchWorkspace } from "./research/workspace";
import {
  ResearchReceivables,
  ResearchStudentStatement,
} from "./research/finance";
import { ResearchReports } from "./research/reports";
import {
  researchFetch,
  ResearchFailure,
  ResearchLoading,
  RESEARCH_TYPES as TYPE_LABELS,
} from "./research/shared";

const MODES: Record<string, string> = {
  dashboard: "لوحة قسم البحوث العلمية",
  new: "طلب بحث جديد",
  orders: "طلبات الأبحاث",
  receivables: "الذمم والتحصيل",
  accounts: "حسابات الطلاب",
  library: "مكتبة الأبحاث",
  sources: "مكتبة المصادر",
  ai: "المساعد الذكي",
  writers: "الكتّاب",
  supervisors: "المشرفون",
  universities: "الجامعات",
  templates: "قوالب الأبحاث",
  plagiarism: "تقارير الاستلال",
  citations: "التوثيق والمراجع",
  portal: "بوابة الطالب",
  reports: "التقارير والإحصائيات",
  settings: "الإعدادات",
};
const MODE_PERMISSIONS: Record<string, string> = {
  new: "research.create",
  receivables: "research.financials.view",
  accounts: "research.financials.view",
  reports: "research.reports.view",
  sources: "research.sources.manage",
  ai: "research.ai.use",
  writers: "research.assign",
  supervisors: "research.assign",
  universities: "research.settings.manage",
  templates: "research.settings.manage",
  settings: "research.settings.manage",
  plagiarism: "research.plagiarism.manage",
  citations: "research.citations.manage",
};
function SourcesCenter() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState("all");
  const [orderId, setOrderId] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    year: "",
    author: "",
    journal: "",
    language: "",
    category: "",
  });
  const orders = useQuery<any>({
    queryKey: ["research", "source-orders"],
    queryFn: () => researchFetch("/orders?page=1"),
  });
  const search = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams({ q, provider, ...filters });
      return researchFetch<any>(`/sources/search?${params.toString()}`);
    },
    onSuccess: (data) => setResults(data.results),
    onError: (error) =>
      toast({
        title: "تعذر البحث",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  const add = useMutation({
    mutationFn: (source: any) =>
      researchFetch(`/orders/${orderId}/sources`, {
        method: "POST",
        body: JSON.stringify({ source }),
      }),
    onSuccess: () => toast({ title: "تم حفظ المصدر وربطه بالبحث" }),
    onError: (error) =>
      toast({
        title: "تعذر حفظ المصدر",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  if (orders.isError)
    return (
      <ResearchFailure
        error={orders.error}
        retry={() => void orders.refetch()}
      />
    );
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">محرك البحث عن المصادر</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          نتائج موحدة من Crossref وOpenAlex وSemantic Scholar وPubMed وDOAJ
          وarXiv، مع وصول مباشر إلى Google Scholar.
        </p>
      </div>
      <div className="space-y-3 rounded-xl bg-card p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[220px_180px_minmax(260px,1fr)_120px]">
          <Select value={orderId} onValueChange={setOrderId}>
            <SelectTrigger>
              <SelectValue placeholder="اختر البحث" />
            </SelectTrigger>
            <SelectContent>
              {(orders.data?.items || []).map((item: any) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.researchNo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={provider} onValueChange={setProvider}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل القواعد</SelectItem>
              <SelectItem value="crossref">Crossref</SelectItem>
              <SelectItem value="openalex">OpenAlex</SelectItem>
              <SelectItem value="semantic_scholar">Semantic Scholar</SelectItem>
              <SelectItem value="pubmed">PubMed</SelectItem>
              <SelectItem value="doaj">DOAJ</SelectItem>
              <SelectItem value="arxiv">arXiv</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="كلمة مفتاحية، عنوان أو DOI..."
            onKeyDown={(e) =>
              e.key === "Enter" && q.length > 1 && search.mutate()
            }
          />
          <Button
            disabled={search.isPending || q.length < 2}
            onClick={() => search.mutate()}
          >
            {search.isPending ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="ml-2 h-4 w-4" />
            )}
            بحث
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Input
            value={filters.author}
            onChange={(e) =>
              setFilters((current) => ({ ...current, author: e.target.value }))
            }
            placeholder="المؤلف"
          />
          <Input
            value={filters.journal}
            onChange={(e) =>
              setFilters((current) => ({ ...current, journal: e.target.value }))
            }
            placeholder="المجلة"
          />
          <Input
            inputMode="numeric"
            value={filters.year}
            onChange={(e) =>
              setFilters((current) => ({ ...current, year: e.target.value }))
            }
            placeholder="السنة"
          />
          <Input
            value={filters.language}
            onChange={(e) =>
              setFilters((current) => ({
                ...current,
                language: e.target.value,
              }))
            }
            placeholder="اللغة"
          />
          <Input
            value={filters.category}
            onChange={(e) =>
              setFilters((current) => ({
                ...current,
                category: e.target.value,
              }))
            }
            placeholder="التصنيف"
          />
        </div>
      </div>
      {q.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>بحث إضافي:</span>
          <Button variant="outline" size="sm" asChild>
            <a
              href={`https://scholar.google.com/scholar?q=${encodeURIComponent([q, filters.author, filters.journal].filter(Boolean).join(" "))}`}
              target="_blank"
              rel="noreferrer"
            >
              Google Scholar <ExternalLink className="mr-2 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      ) : null}
      <div className="space-y-3">
        {results.map((source) => (
          <article
            key={`${source.provider}:${source.externalId}`}
            className="rounded-xl bg-card p-4 shadow-sm"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{source.provider}</Badge>
                  {source.openAccess ? <Badge>PDF متاح</Badge> : null}
                  {source.year ? (
                    <Badge variant="secondary">{source.year}</Badge>
                  ) : null}
                </div>
                <h3 className="mt-3 font-bold leading-7">{source.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {source.authors?.join("، ") || "مؤلف غير مسجل"}
                  {source.journal ? ` · ${source.journal}` : ""}
                </p>
                {source.abstract ? (
                  <p className="mt-3 line-clamp-3 max-w-4xl text-sm leading-6 text-muted-foreground">
                    {source.abstract}
                  </p>
                ) : null}
                {source.doi ? (
                  <p className="mt-2 font-mono text-xs">DOI: {source.doi}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                {source.url ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={source.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="ml-2 h-4 w-4" />
                      فتح
                    </a>
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={!orderId || add.isPending}
                  onClick={() => add.mutate(source)}
                >
                  <Plus className="ml-2 h-4 w-4" />
                  إضافة
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function AiCenter() {
  const { toast } = useToast();
  const [orderId, setOrderId] = useState("");
  const [action, setAction] = useState("literature_review");
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [output, setOutput] = useState("");
  const orders = useQuery<any>({
    queryKey: ["research", "ai-orders"],
    queryFn: () => researchFetch("/orders"),
  });
  const detail = useQuery<any>({
    queryKey: ["research", "ai-detail", orderId],
    queryFn: () => researchFetch(`/orders/${orderId}`),
    enabled: Boolean(orderId),
  });
  const generate = useMutation({
    mutationFn: () =>
      researchFetch<any>("/ai", {
        method: "POST",
        body: JSON.stringify({ orderId, action, prompt, sourceIds: selected }),
      }),
    onSuccess: (data) => setOutput(data.output),
    onError: (error) =>
      toast({
        title: "تعذر التوليد",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  if (orders.isError || detail.isError)
    return (
      <ResearchFailure
        error={orders.error || detail.error}
        retry={() => {
          void orders.refetch();
          if (orderId) void detail.refetch();
        }}
      />
    );
  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-xl bg-card p-4 shadow-sm">
        <div>
          <h2 className="font-bold">مساعد البحث الأكاديمي</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            لا يعمل دون مصادر مرتبطة، ولا يسمح بإشارات مرجعية خارجها.
          </p>
        </div>
        <div>
          <Label>البحث</Label>
          <Select
            value={orderId}
            onValueChange={(value) => {
              setOrderId(value);
              setSelected([]);
            }}
          >
            <SelectTrigger className="mt-2">
              <SelectValue placeholder="اختر البحث" />
            </SelectTrigger>
            <SelectContent>
              {(orders.data?.items || []).map((item: any) => (
                <SelectItem key={item.id} value={String(item.id)}>
                  {item.researchNo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>الإجراء</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                ["title", "توليد أو تحسين العنوان"],
                ["abstract", "إنشاء الملخص"],
                ["introduction", "كتابة المقدمة"],
                ["literature_review", "مراجعة الأدبيات"],
                ["methodology", "المنهجية"],
                ["discussion", "المناقشة"],
                ["conclusion", "الخاتمة والتوصيات"],
                ["research_questions", "أسئلة البحث"],
                ["objectives", "الأهداف"],
                ["hypothesis", "الفرضيات"],
                ["limitations", "المحددات"],
                ["future_work", "الأعمال المستقبلية"],
                ["keywords", "استخراج الكلمات المفتاحية"],
                ["rewrite", "إعادة صياغة أكاديمية"],
                ["expand", "توسيع النص"],
                ["shorten", "اختصار النص"],
                ["grammar", "التدقيق اللغوي"],
                ["translate", "ترجمة"],
                ["summarize", "تلخيص"],
              ].map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>المصادر المسموحة</Label>
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {(detail.data?.sources || []).map((source: any) => (
              <label
                key={source.id}
                className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2 text-sm"
              >
                <Checkbox
                  checked={selected.includes(source.id)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, source.id]
                        : current.filter((id) => id !== source.id),
                    )
                  }
                />
                <span className="line-clamp-2">{source.title}</span>
              </label>
            ))}
          </div>
        </div>
      </aside>
      <section className="rounded-xl bg-card p-4 shadow-sm">
        <Textarea
          className="min-h-44"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="اكتب المطلوب بدقة، وسيستخدم المساعد المصادر المحددة فقط..."
        />
        <div className="mt-3 flex justify-end">
          <Button
            disabled={
              generate.isPending ||
              !orderId ||
              selected.length === 0 ||
              prompt.length < 2
            }
            onClick={() => generate.mutate()}
          >
            {generate.isPending ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="ml-2 h-4 w-4" />
            )}
            توليد موثق
          </Button>
        </div>
        {output ? (
          <div className="mt-5 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 text-sm leading-7">
            {output}
          </div>
        ) : (
          <div className="flex min-h-80 items-center justify-center text-center text-muted-foreground">
            <div>
              <Bot className="mx-auto mb-3 h-10 w-10 text-primary" />
              <p>اختر البحث والمصادر ثم اكتب المطلوب.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function CatalogPage({ mode }: { mode: string }) {
  const { toast } = useToast();
  const catalog = useQuery<any>({
    queryKey: ["research", "catalog"],
    queryFn: () => researchFetch("/catalog"),
  });
  const [university, setUniversity] = useState({
    nameAr: "",
    nameEn: "",
    country: "العراق",
    city: "",
  });
  const [template, setTemplate] = useState({
    name: "",
    code: "",
    researchType: "graduation",
    language: "ar",
    citationStyle: "APA7",
  });
  const saveUniversity = useMutation({
    mutationFn: () =>
      researchFetch("/universities", {
        method: "POST",
        body: JSON.stringify(university),
      }),
    onSuccess: () => {
      catalog.refetch();
      setUniversity({ nameAr: "", nameEn: "", country: "العراق", city: "" });
      toast({ title: "تم حفظ الجامعة" });
    },
    onError: (error) =>
      toast({
        title: "تعذر حفظ الجامعة",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  const saveTemplate = useMutation({
    mutationFn: () =>
      researchFetch("/templates", {
        method: "POST",
        body: JSON.stringify(template),
      }),
    onSuccess: () => {
      catalog.refetch();
      setTemplate({
        name: "",
        code: "",
        researchType: "graduation",
        language: "ar",
        citationStyle: "APA7",
      });
      toast({ title: "تم حفظ قالب البحث" });
    },
    onError: (error) =>
      toast({
        title: "تعذر حفظ القالب",
        description: apiErrorMessage(error),
        variant: "destructive",
      }),
  });
  if (catalog.isPending) return <ResearchLoading />;
  if (catalog.isError)
    return (
      <ResearchFailure
        error={catalog.error}
        retry={() => void catalog.refetch()}
      />
    );
  if (mode === "universities")
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold">دليل الجامعات</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            مرجع موحد للجامعات والكليات ومتطلبات التوثيق.
          </p>
        </div>
        <div className="grid gap-4 rounded-xl bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          <Input
            value={university.nameAr}
            onChange={(e) =>
              setUniversity((c) => ({ ...c, nameAr: e.target.value }))
            }
            placeholder="اسم الجامعة بالعربية"
          />
          <Input
            value={university.nameEn}
            onChange={(e) =>
              setUniversity((c) => ({ ...c, nameEn: e.target.value }))
            }
            placeholder="الاسم بالإنجليزية"
          />
          <Input
            value={university.country}
            onChange={(e) =>
              setUniversity((c) => ({ ...c, country: e.target.value }))
            }
            placeholder="الدولة"
          />
          <Input
            value={university.city}
            onChange={(e) =>
              setUniversity((c) => ({ ...c, city: e.target.value }))
            }
            placeholder="المدينة"
          />
          <Button
            disabled={university.nameAr.length < 2 || saveUniversity.isPending}
            onClick={() => saveUniversity.mutate()}
          >
            إضافة جامعة
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(catalog.data?.universities || []).map((item: any) => (
            <div key={item.id} className="rounded-xl bg-card p-4 shadow-sm">
              <GraduationCap className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-bold">{item.nameAr}</h3>
              <p className="text-sm text-muted-foreground">
                {item.nameEn || item.city || "—"}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  if (["writers", "supervisors"].includes(mode))
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold">
            {mode === "writers" ? "الكتّاب والمراجعين" : "المشرفون"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            يعتمد هذا الدليل على موظفي AJN الحاليين ولا ينشئ حسابات مكررة.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(catalog.data?.writers || []).map((item: any) => (
            <div key={item.id} className="rounded-xl bg-card p-4 shadow-sm">
              <UserRoundCheck className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-bold">{item.name || item.username}</h3>
              <p className="text-sm text-muted-foreground">{item.role}</p>
            </div>
          ))}
        </div>
      </div>
    );
  if (mode === "templates")
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold">قوالب الأبحاث</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            هيكل محفوظ للفصول واللغة ونمط التوثيق، قابل لإعادة الاستخدام.
          </p>
        </div>
        <div className="grid gap-3 rounded-xl bg-card p-4 shadow-sm md:grid-cols-5">
          <Input
            value={template.name}
            onChange={(e) =>
              setTemplate((current) => ({ ...current, name: e.target.value }))
            }
            placeholder="اسم القالب"
          />
          <Input
            value={template.code}
            onChange={(e) =>
              setTemplate((current) => ({ ...current, code: e.target.value }))
            }
            placeholder="الكود (اختياري)"
          />
          <Select
            value={template.researchType}
            onValueChange={(value) =>
              setTemplate((current) => ({ ...current, researchType: value }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={template.citationStyle}
            onValueChange={(value) =>
              setTemplate((current) => ({ ...current, citationStyle: value }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["APA7", "IEEE", "MLA", "Harvard", "Chicago"].map((style) => (
                <SelectItem key={style} value={style}>
                  {style}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={template.name.trim().length < 2 || saveTemplate.isPending}
            onClick={() => saveTemplate.mutate()}
          >
            حفظ القالب
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(catalog.data?.templates || []).map((item: any) => (
            <div key={item.id} className="rounded-xl bg-card p-4 shadow-sm">
              <FileCheck2 className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-bold">{item.name}</h3>
              <p className="text-sm text-muted-foreground">
                {item.code} · {item.citationStyle}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  if (mode === "portal")
    return (
      <div className="rounded-xl bg-card p-8 text-center shadow-sm">
        <QrCode className="mx-auto h-10 w-10 text-primary" />
        <h2 className="mt-4 text-xl font-bold">بوابة متابعة الزبون</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          بوابة آمنة برمز QR لكل بحث، تعرض التقدم والفصول والملفات العامة
          والاستلال والفاتورة والمراسلات.
        </p>
        <Button className="mt-5" asChild>
          <a href="/research" target="_blank">
            فتح البوابة
          </a>
        </Button>
      </div>
    );
  if (mode === "settings") {
    const integrations = catalog.data?.integrations || {};
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-bold">تكاملات مركز الأبحاث</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            حالة الربط مع خدمات AJN ومصادر البحث الخارجية.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["المساعد الذكي", integrations.ai],
            ["Supabase Storage", integrations.storage],
          ].map(([label, active]) => (
            <div
              key={String(label)}
              className="rounded-xl bg-card p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <strong>{String(label)}</strong>
                <Badge variant={active ? "default" : "secondary"}>
                  {active ? "متصل" : "يحتاج إعداد"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-card p-8 text-center shadow-sm">
      <Settings className="mx-auto h-10 w-10 text-primary" />
      <h2 className="mt-4 text-xl font-bold">{MODES[mode] || mode}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        هذه الصفحة مرتبطة بمركز الأبحاث وتستخدم القوالب والصلاحيات والإعدادات
        العامة الحالية. تُدار البيانات من سجل الطلب المركزي.
      </p>
    </div>
  );
}

export default function ResearchCenterPage({ me }: { me: AdminMe | null }) {
  const mode =
    window.location.pathname.split("/").filter(Boolean)[2] || "dashboard";
  const [selected, setSelected] = useState<number | null>(
    () =>
      Number(new URLSearchParams(window.location.search).get("order")) || null,
  );
  useEffect(() => {
    const sync = () =>
      setSelected(
        Number(new URLSearchParams(window.location.search).get("order")) ||
          null,
      );
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const financial = researchAccess(me, "research.financials.view");
  const editable = researchAccess(me, "research.edit");
  function openOrder(id: number) {
    const url = new URL(window.location.href);
    url.searchParams.set("order", String(id));
    window.history.pushState(null, "", url);
    setSelected(id);
  }
  function closeOrder() {
    const url = new URL(window.location.href);
    url.searchParams.delete("order");
    window.history.replaceState(null, "", url);
    setSelected(null);
  }
  const allowed =
    researchAccess(
      me,
      selected ? "research.view" : MODE_PERMISSIONS[mode] || "research.view",
    ) &&
    (mode !== "reports" || financial);
  const title = MODES[mode] || MODES.dashboard;
  let content;
  if (!me || !allowed)
    content = (
      <ResearchFailure error={new Error("لا تملك صلاحية عرض هذه الصفحة")} />
    );
  else if (selected)
    content = (
      <ResearchWorkspace
        key={selected}
        id={selected}
        me={me}
        onClose={closeOrder}
      />
    );
  else if (mode === "new")
    content = (
      <ResearchOrderForm
        receive={researchAccess(me, "research.payment.receive")}
        financial={financial}
        assignable={researchAccess(me, "research.assign")}
        onSaved={openOrder}
      />
    );
  else if (["orders", "library", "plagiarism", "citations"].includes(mode))
    content = (
      <ResearchOrders
        library={mode === "library"}
        financial={financial}
        editable={editable}
        onOpen={openOrder}
      />
    );
  else if (mode === "receivables")
    content = <ResearchReceivables onOpen={openOrder} />;
  else if (mode === "accounts")
    content = <ResearchStudentStatement onOpen={openOrder} />;
  else if (mode === "reports") content = <ResearchReports onOpen={openOrder} />;
  else if (mode === "sources") content = <SourcesCenter />;
  else if (mode === "ai") content = <AiCenter />;
  else if (
    [
      "writers",
      "supervisors",
      "universities",
      "templates",
      "portal",
      "settings",
    ].includes(mode)
  )
    content = <CatalogPage mode={mode} />;
  else
    content = (
      <ResearchDashboard
        financial={financial}
        editable={editable}
        onOpen={openOrder}
      />
    );
  return (
    <main
      dir="rtl"
      className="research-department min-h-full bg-background p-3 text-foreground sm:p-6"
    >
      <style>{`
    .research-department,.research-dialog { --research-navy:#142c46; --research-gold:#bc984e; --primary:211 56% 18%; --primary-foreground:0 0% 100%; --accent:40 45% 52%; --accent-foreground:211 56% 18%; --ring:40 45% 52%; --background:215 30% 97%; --foreground:211 47% 18%; --card:0 0% 100%; --card-foreground:211 47% 18%; --muted:213 22% 95%; --muted-foreground:213 13% 44%; --secondary:215 27% 94%; --secondary-foreground:211 56% 18%; --border:214 24% 88%; --input:214 24% 85%; --popover:0 0% 100%; --popover-foreground:211 47% 18%; --primary-border:#142c46; color-scheme:light; }
    .research-welcome { background:#142c46; color:#fff; border-inline-start:5px solid #bc984e; }
    .research-department .research-welcome h2 { color:#fff !important; }
    .research-welcome button { color:#142c46; background:#fff; }
    .research-department [data-slot=card] { box-shadow:0 2px 10px #142c4606; }
    .research-order-card { border-top:2px solid #bc984e; }
    .research-department h1,.research-department h2,.research-department h3 { letter-spacing:0; }
    .research-department a:focus-visible,.research-department button:focus-visible { outline-offset:3px; }
  `}</style>
      <div className="mx-auto flex max-w-[1760px] flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-accent">
              <GraduationCap className="size-7" />
            </span>
            <div>
              <p className="text-xs font-semibold text-muted-foreground">
                مجموعة علي جان نهاد · قسم البحوث العلمية
              </p>
              <h1 className="mt-1 text-xl font-bold sm:text-2xl">{title}</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href="/research" target="_blank" rel="noreferrer">
                <QrCode data-icon="inline-start" />
                بوابة الطالب
              </a>
            </Button>
            {researchAccess(me, "research.create") && (
              <Button asChild>
                <a href="/admin/research/new">
                  <Plus data-icon="inline-start" />
                  بحث جديد
                </a>
              </Button>
            )}
          </div>
        </header>
        <nav
          aria-label="صفحات قسم البحوث العلمية"
          className="flex gap-2 overflow-x-auto border-b pb-3"
        >
          {[
            ["dashboard", "الرئيسية"],
            ["orders", "الأبحاث"],
            ["receivables", "الذمم والتحصيل"],
            ["accounts", "حسابات الطلاب"],
            ["reports", "التقارير"],
          ]
            .filter(
              ([key]) =>
                researchAccess(me, MODE_PERMISSIONS[key] || "research.view") &&
                (key !== "reports" || financial),
            )
            .map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={mode === key ? "default" : "ghost"}
                asChild
              >
                <a
                  href={
                    key === "dashboard"
                      ? "/admin/research"
                      : `/admin/research/${key}`
                  }
                  aria-current={mode === key ? "page" : undefined}
                >
                  {label}
                </a>
              </Button>
            ))}
        </nav>
        {content}
      </div>
    </main>
  );
}
