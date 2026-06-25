import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type InventoryAlert = {
  id: number;
  name: string;
  nameAr: string;
  stock: number;
  minStock: number;
  barcode: string;
  category: string;
  images: string[];
};

export default function InventoryAlertsPage() {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useQuery<{ data: InventoryAlert[]; count: number; emailEnabled: boolean }>({
    queryKey: ["admin", "inventory-alerts"],
    queryFn: () => adminFetch("/admin/inventory-alerts"),
    staleTime: 60_000,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = data?.data ?? [];
    if (!q) return list;
    return list.filter((item) =>
      item.nameAr.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.barcode.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    );
  }, [data?.data, search]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">تنبيهات المخزون</h1>
          <p className="text-sm text-muted-foreground mt-1">المنتجات التي وصلت إلى الحد الأدنى أو نفدت.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          <AlertTriangle className="w-4 h-4" />
          {(data?.count ?? 0).toLocaleString("ar-IQ")} منتج
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border/30 p-4">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم المنتج أو الباركود..."
            className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        {!data?.emailEnabled && (
          <p className="mt-3 text-xs text-muted-foreground">تنبيه البريد غير مفعل لأن إعدادات الإيميل غير موجودة في البيئة.</p>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((item) => <Skeleton key={item} className="h-16 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState message="لا توجد منتجات ناقصة" />
      ) : (
        <div className="bg-card rounded-xl border border-border/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/50">
                <tr className="text-muted-foreground border-b border-border/30">
                  <th className="text-right p-3 font-medium">المنتج</th>
                  <th className="text-right p-3 font-medium">الباركود</th>
                  <th className="text-right p-3 font-medium">المخزون</th>
                  <th className="text-right p-3 font-medium">الحد الأدنى</th>
                  <th className="text-right p-3 font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {rows.map((item) => (
                  <tr key={item.id} className="hover:bg-background/30">
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {item.images?.[0]
                          ? <img src={item.images[0]} alt="" className="w-10 h-10 rounded-lg object-cover" />
                          : <div className="w-10 h-10 rounded-lg border border-border/30 bg-background" />}
                        <div>
                          <p className="font-medium text-foreground">{item.nameAr || item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.category || "بدون تصنيف"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground font-mono" dir="ltr">{item.barcode || "—"}</td>
                    <td className={`p-3 font-semibold ${item.stock <= 0 ? "text-status-danger" : "text-status-warning"}`}>{item.stock.toLocaleString("ar-IQ")}</td>
                    <td className="p-3 text-muted-foreground">{item.minStock.toLocaleString("ar-IQ")}</td>
                    <td className="p-3">
                      <Button asChild variant="outline" size="sm">
                        <a href="/admin/products">تعديل المنتج</a>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
