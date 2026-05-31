import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { Barcode, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { adminFetch } from "./_lib";
import { EmptyState } from "./_layout";

type Product = {
  id: number;
  name: string;
  nameAr: string;
  price: string;
  barcode?: string;
  stock: string;
};

type BarcodeSize = "small" | "medium" | "large";

const SIZE_CONFIG: Record<BarcodeSize, { label: string; widthClass: string; height: number; fontSize: number }> = {
  small: { label: "صغير", widthClass: "w-36", height: 42, fontSize: 10 },
  medium: { label: "متوسط", widthClass: "w-44", height: 54, fontSize: 12 },
  large: { label: "كبير", widthClass: "w-56", height: 68, fontSize: 14 },
};

export default function BarcodesPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState("24");
  const [size, setSize] = useState<BarcodeSize>("medium");
  const [barcodeLib, setBarcodeLib] = useState<any>(null);
  const previewRefs = useRef<(SVGSVGElement | null)[]>([]);
  const printRefs = useRef<(SVGSVGElement | null)[]>([]);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["admin", "barcode-products"],
    queryFn: () => adminFetch("/admin/products?limit=1000"),
    staleTime: 3 * 60 * 1000,
  });

  useEffect(() => {
    let alive = true;
    import("jsbarcode").then((mod) => {
      if (alive) setBarcodeLib(() => mod.default);
    });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 60);
    return products.filter((product) =>
      product.nameAr?.toLowerCase().includes(q) ||
      product.name?.toLowerCase().includes(q) ||
      product.barcode?.toLowerCase().includes(q)
    ).slice(0, 80);
  }, [products, search]);

  const selected = products.find((product) => product.id === selectedId) ?? filtered[0] ?? null;
  const count = Math.min(Math.max(Number.parseInt(quantity, 10) || 1, 1), 200);
  const copies = selected ? Array.from({ length: count }, (_, index) => index) : [];
  const config = SIZE_CONFIG[size];

  useEffect(() => {
    if (!barcodeLib || !selected?.barcode) return;
    [previewRefs.current, printRefs.current].forEach((group) => {
      group.forEach((svg) => {
        if (!svg) return;
        barcodeLib(svg, selected.barcode, {
          format: "CODE128",
          displayValue: true,
          height: config.height,
          fontSize: config.fontSize,
          margin: 4,
          textMargin: 2,
        });
      });
    });
  }, [barcodeLib, config.fontSize, config.height, copies.length, selected?.barcode]);

  function printLabels() {
    window.print();
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="no-print flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">طباعة الباركود</h1>
          <p className="text-sm text-muted-foreground mt-1">اختيار منتج وكمية الملصقات قبل الطباعة.</p>
        </div>
        <Button onClick={printLabels} disabled={!selected?.barcode} className="gap-2">
          <Printer className="w-4 h-4" /> طباعة
        </Button>
      </div>

      <div className="no-print grid gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <div className="bg-card rounded-xl border border-border/30 p-4 space-y-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو الباركود..."
              className="w-full bg-background border border-border/40 rounded-lg pr-10 pl-3 py-2 text-sm focus:outline-none focus:border-primary/50"
            />
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {isLoading ? (
              [1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-14 rounded-lg" />)
            ) : filtered.length === 0 ? (
              <EmptyState message="لا توجد منتجات" />
            ) : filtered.map((product) => {
              const active = (selectedId ?? selected?.id) === product.id;
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => setSelectedId(product.id)}
                  className={`w-full flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-right transition-colors ${
                    active ? "border-primary/60 bg-primary/10" : "border-border/30 bg-background/50 hover:border-primary/35"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{product.nameAr || product.name}</p>
                    <p className="text-xs text-muted-foreground font-mono" dir="ltr">{product.barcode || "بدون باركود"}</p>
                  </div>
                  <Barcode className="w-4 h-4 text-primary shrink-0" />
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <label className="text-xs text-muted-foreground">
              الكمية
              <input
                type="number"
                min={1}
                max={200}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              الحجم
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as BarcodeSize)}
                className="mt-1 w-full bg-background border border-border/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
              >
                {Object.entries(SIZE_CONFIG).map(([value, item]) => (
                  <option key={value} value={value}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border/30 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">{selected?.nameAr || selected?.name || "اختر منتجاً"}</p>
              <p className="text-xs text-muted-foreground font-mono" dir="ltr">{selected?.barcode ?? "—"}</p>
            </div>
            <span className="text-xs text-muted-foreground">{count} ملصق</span>
          </div>
          {!selected?.barcode ? (
            <EmptyState message="اختر منتجاً يحتوي على باركود" />
          ) : (
            <BarcodeSheet
              copies={copies}
              refs={previewRefs}
              selected={selected}
              config={config}
            />
          )}
        </div>
      </div>

      <div className="hidden print:block">
        {selected?.barcode && (
          <BarcodeSheet copies={copies} refs={printRefs} selected={selected} config={config} printMode />
        )}
      </div>
    </div>
  );
}

function BarcodeSheet({
  copies,
  refs,
  selected,
  config,
  printMode = false,
}: {
  copies: number[];
  refs: MutableRefObject<(SVGSVGElement | null)[]>;
  selected: Product;
  config: { widthClass: string };
  printMode?: boolean;
}) {
  return (
    <div className={`grid gap-2 ${printMode ? "grid-cols-3 barcode-print-sheet" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-4"}`}>
      {copies.map((index) => (
        <div
          key={index}
          className={`${config.widthClass} max-w-full rounded-lg border border-border/30 bg-white p-2 text-center text-black break-inside-avoid`}
        >
          <p className="text-[10px] font-semibold truncate">{selected.nameAr || selected.name}</p>
          <svg ref={(node) => { refs.current[index] = node; }} className="mx-auto max-w-full" />
        </div>
      ))}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .barcode-print-sheet, .barcode-print-sheet * { visibility: visible !important; }
          .no-print { display: none !important; }
          body { background: #fff !important; }
          main { padding: 0 !important; margin: 0 !important; max-width: none !important; }
          .barcode-print-sheet { position: absolute; top: 0; right: 0; left: 0; display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6mm; direction: rtl; }
        }
      `}</style>
    </div>
  );
}
