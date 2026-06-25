import { useState } from "react";
import { Languages, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "./_lib";
import { useToast } from "@/hooks/use-toast";

export type AutoTranslationResult = {
  nameKu: string;
  nameTr: string;
  descriptionKu: string;
  descriptionTr: string;
};

/**
 * زر «ترجمة تلقائية» — يرسل الاسم/الوصف العربي إلى السيرفر (الذي يحتفظ بمفتاح الـAPI)
 * ويعيد الترجمة الكردية والتركية لتعبئة الحقول. النتائج قابلة للتعديل قبل الحفظ.
 */
export function AutoTranslateButton({
  name,
  description,
  onResult,
  className,
}: {
  name: string;
  description?: string;
  onResult: (result: AutoTranslationResult) => void;
  className?: string;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!name.trim() && !(description ?? "").trim()) {
      toast({ title: "أدخل الاسم أو الوصف بالعربي أولاً", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await adminFetch<AutoTranslationResult>("/admin/translate", {
        method: "POST",
        body: JSON.stringify({ name: name ?? "", description: description ?? "" }),
      });
      onResult(result);
      toast({ title: "تمت الترجمة التلقائية", description: "يمكنك تعديل النتائج قبل الحفظ" });
    } catch (err: any) {
      toast({ title: "تعذّر تنفيذ الترجمة", description: err?.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" className={className} disabled={loading} onClick={run}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
      {loading ? "جاري الترجمة..." : "ترجمة تلقائية"}
    </Button>
  );
}
