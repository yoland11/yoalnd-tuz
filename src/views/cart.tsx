import { useLocation } from "wouter";
import { useGetCart, useUpdateCartItem, useRemoveCartItem, useClearCart, getGetCartQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShoppingCart, Trash2, Minus, Plus, ArrowLeft } from "lucide-react";
import { SelectedColorLabel } from "@/components/product-colors";
import { SmartSuggestions } from "@/components/interactive/smart-suggestions";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/money";

export default function Cart() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const t = useT();
  const { data: cart, isLoading } = useGetCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const clearCart = useClearCart();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
  }

  function handleUpdate(itemId: number, quantity: number) {
    updateItem.mutate({ itemId, data: { quantity } }, { onSuccess: invalidate });
  }

  function handleRemove(itemId: number) {
    removeItem.mutate({ itemId }, { onSuccess: invalidate });
  }

  function handleClear() {
    clearCart.mutate(undefined, { onSuccess: invalidate });
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Skeleton className="h-10 w-40 mb-8" />
        {[1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl mb-4" />)}
      </div>
    );
  }

  const items = cart?.items ?? [];

  return (
    <div className="container mx-auto px-4 py-10 min-h-screen">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
          <ShoppingCart className="w-7 h-7 text-primary" />
          {t("سلة المشتريات")}
        </h1>
        {items.length > 0 && (
          <button
            onClick={handleClear}
            className="text-sm text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-4 h-4" />
            {t("مسح الكل")}
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ShoppingCart className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <p className="text-lg text-muted-foreground mb-6">{t("سلتك فارغة")}</p>
          <Button onClick={() => navigate("/store")}>{t("تصفح المتجر")}</Button>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Items List */}
            <div className="lg:col-span-2 space-y-4">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="bg-card rounded-xl border border-border/30 p-4 flex gap-4 items-center"
                >
                  <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                    {item.product?.images?.[0] ? (
                      <img src={item.product.images[0]} alt={item.product?.nameAr} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-muted" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground truncate">{item.product?.nameAr}</p>
                    <SelectedColorLabel color={(item as any).selectedColorData} fallback={item.selectedColor} className="mt-0.5 flex text-xs text-muted-foreground" />
                    <p className="text-primary font-bold mt-1">{formatCurrency(item.price)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleUpdate(item.id, item.quantity - 1)}
                      aria-label={t("تقليل الكمية")}
                      className="w-8 h-8 rounded-full border border-border/40 flex items-center justify-center hover:border-primary/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      disabled={item.quantity <= 1}
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-8 text-center text-foreground font-medium" aria-live="polite">{item.quantity}</span>
                    <button
                      onClick={() => handleUpdate(item.id, item.quantity + 1)}
                      aria-label={t("زيادة الكمية")}
                      className="w-8 h-8 rounded-full border border-border/40 flex items-center justify-center hover:border-primary/50 transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-foreground">{formatCurrency(Number(item.price) * item.quantity)}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(item.id)}
                    aria-label={t("حذف المنتج من السلة")}
                    className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 mr-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="bg-card rounded-xl border border-border/30 p-6 sticky top-6">
                <h2 className="text-lg font-bold text-foreground mb-6">{t("ملخص الطلب")}</h2>
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("المجموع الفرعي")}</span>
                    <span className="text-foreground">{formatCurrency(cart?.total)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("التوصيل")}</span>
                    <span className="text-muted-foreground">{t("يحدد عند الدفع")}</span>
                  </div>
                  <div className="border-t border-border/30 pt-3 flex justify-between font-bold text-lg">
                    <span className="text-foreground">{t("الإجمالي")}</span>
                    <span className="text-primary">{formatCurrency(cart?.total)}</span>
                  </div>
                </div>
                <Button className="w-full py-5 text-base gap-2" onClick={() => navigate("/checkout")}>
                  {t("إتمام الطلب")}
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <button
                  onClick={() => navigate("/store")}
                  className="w-full mt-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("متابعة التسوق")}
                </button>
              </div>
            </div>
          </div>
          <SmartSuggestions title={t("قد يناسب سلتك أيضاً")} />
        </div>
      )}
    </div>
  );
}
