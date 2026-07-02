import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useGetProduct, useListReviews, useCreateReview, useAddToCart, getGetCartQueryKey, getGetProductQueryKey, getListReviewsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, Check, Star, ShoppingCart, ChevronRight, ChevronLeft, X, Minus, Plus, Heart, Loader2 } from "lucide-react";
import { ColorDot } from "@/components/product-colors";
import { useWishlist } from "@/lib/wishlist";
import { useT } from "@/lib/i18n";
import { useContentLocalizer } from "@/lib/content-i18n";
import { colorImage, colorKey, normalizeColors, type ProductColor } from "@/lib/colors";
import { ModelViewerCard } from "@/components/interactive/model-viewer";
import { SmartSuggestions } from "@/components/interactive/smart-suggestions";
import { logCustomerActivity } from "@/lib/customer-activity";
import { formatCurrency, formatMoney } from "@/lib/money";

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const productId = parseInt(id ?? "0");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: product, isLoading } = useGetProduct(productId, {
    query: { queryKey: getGetProductQueryKey(productId), enabled: !!productId },
  });
  const { data: reviews } = useListReviews({ productId }, {
    query: { queryKey: getListReviewsQueryKey({ productId }), enabled: !!productId },
  });

  const addToCart = useAddToCart();
  const { has: isFavorite, toggle: toggleFavorite } = useWishlist();
  const favorited = isFavorite(productId);
  const t = useT();
  const cl = useContentLocalizer();
  const productName = product ? cl.name(product) : "";
  const productDescription = product ? cl.description(product) : "";
  const isRental = Boolean((product as any)?.isRental);
  const rentalPricePerDay = Number((product as any)?.pricePerDay ?? product?.price ?? 0);

  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedColor, setSelectedColor] = useState<ProductColor | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [addedToCart, setAddedToCart] = useState(false);
  const [rentalStartDate, setRentalStartDate] = useState("");
  const [rentalEndDate, setRentalEndDate] = useState("");
  const [rentalCustomerName, setRentalCustomerName] = useState("");
  const [rentalPhone, setRentalPhone] = useState("");
  const [rentalNotes, setRentalNotes] = useState("");
  const [rentalSaving, setRentalSaving] = useState(false);
  const [rentalMessage, setRentalMessage] = useState("");
  const [rentalError, setRentalError] = useState("");

  const createReview = useCreateReview();

  const images = product?.images?.length
    ? product.images
    : ["/placeholder-product.jpg"];
  const videos = product?.videos?.filter(Boolean) ?? [];
  const imageMetadata = product?.imageMetadata ?? [];
  const colors = useMemo(() => normalizeColors(product?.colors ?? []), [product?.colors]);
  const rentalDaysCount = useMemo(() => {
    if (!rentalStartDate || !rentalEndDate) return 0;
    const start = Date.parse(`${rentalStartDate}T00:00:00`);
    const end = Date.parse(`${rentalEndDate}T00:00:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
    return Math.max(1, Math.floor((end - start) / 86_400_000) + 1);
  }, [rentalStartDate, rentalEndDate]);
  const rentalTotal = rentalDaysCount * rentalPricePerDay;
  const productModelUrl = useMemo(() => {
    const metadata = imageMetadata.find((entry: any) => entry?.modelUrl);
    return metadata?.modelUrl ? String(metadata.modelUrl) : "";
  }, [imageMetadata]);

  useEffect(() => {
    if (!product) return;
    logCustomerActivity({
      action: "product_open",
      entityType: "product",
      entityId: product.id,
      entityLabel: product.nameAr || product.name,
    });
  }, [product]);

  function handleAddToCart() {
    if (!product) return;
    if (isRental) return;
    if (colors.length > 0 && !selectedColor) return;
    addToCart.mutate(
      { data: { productId: product.id, quantity, selectedColor: selectedColor?.name, selectedColorData: selectedColor ?? undefined } },
      {
        onSuccess: () => {
          logCustomerActivity({
            action: "add_cart",
            entityType: "product",
            entityId: product.id,
            entityLabel: product.nameAr || product.name,
            metadata: { quantity, color: selectedColor?.name ?? "" },
          });
          queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
          setAddedToCart(true);
          setTimeout(() => setAddedToCart(false), 2000);
        },
      }
    );
  }

  async function handleRentalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product || !isRental || rentalSaving) return;
    setRentalSaving(true);
    setRentalError("");
    setRentalMessage("");
    try {
      const res = await fetch("/api/rental-orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          customerName: rentalCustomerName,
          phone: rentalPhone,
          startDate: rentalStartDate,
          endDate: rentalEndDate,
          notes: rentalNotes,
          paymentMethod: "cash",
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "تعذر إنشاء حجز الإيجار");
      setRentalMessage(`تم إنشاء حجز الإيجار ${payload.orderNo ?? ""}`);
      setRentalCustomerName("");
      setRentalPhone("");
      setRentalStartDate("");
      setRentalEndDate("");
      setRentalNotes("");
      queryClient.invalidateQueries({ queryKey: getGetProductQueryKey(product.id) });
    } catch (err: any) {
      setRentalError(err?.message || "تعذر إنشاء حجز الإيجار");
    } finally {
      setRentalSaving(false);
    }
  }

  function handleSelectColor(color: ProductColor) {
    setSelectedColor(color);
    const linkedImage = colorImage(color);
    if (!linkedImage) return;
    const index = images.findIndex((image) => image === linkedImage);
    if (index >= 0) setSelectedImage(index);
  }

  function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    createReview.mutate(
      { data: { productId: product.id, customerName: reviewerName, rating: reviewRating, comment: reviewComment } },
      { onSuccess: () => { setReviewerName(""); setReviewComment(""); setReviewRating(5); }, onError: () => {} }
    );
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <Skeleton className="aspect-square rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-24 text-center text-muted-foreground">
        <p className="text-lg">{t("المنتج غير موجود")}</p>
        <Button onClick={() => navigate("/store")} className="mt-4">{t("العودة للمتجر")}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Breadcrumb */}
      <div className="border-b border-border/30 py-3">
        <div className="container mx-auto px-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/store" className="hover:text-primary transition-colors">{t("المتجر")}</Link>
          <span>/</span>
          <span className="text-foreground">{productName}</span>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Images */}
          <div className="space-y-4">
            <div
              className="relative aspect-[4/3] max-h-72 rounded-xl overflow-hidden bg-card cursor-zoom-in border border-border/40"
              onClick={() => setPreviewOpen(true)}
            >
              <img
                src={images[selectedImage]}
                alt={productName}
                className="w-full h-full transition-transform duration-300 hover:scale-105"
                style={{ objectFit: String(imageMetadata[selectedImage]?.objectFit ?? "contain") as any }}
              />
              <span className="absolute bottom-3 left-3 text-xs text-white/70 bg-black/40 px-2 py-1 rounded">{t("معاينة")}</span>
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedImage(i)}
                    aria-label={`${t("صورة")} ${i + 1}`}
                    aria-pressed={i === selectedImage}
                    className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${i === selectedImage ? "border-primary" : "border-transparent hover:border-border/60"}`}
                  >
                    <img src={img} alt="" className="w-full h-full" style={{ objectFit: String(imageMetadata[i]?.objectFit ?? "cover") as any }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="space-y-6">
            <div className="text-center">
              <div className="flex items-start justify-center gap-3">
                <h1 className="text-3xl font-bold text-foreground mb-2">{productName}</h1>
                <button
                  type="button"
                  onClick={() => toggleFavorite(productId)}
                  aria-pressed={favorited}
                  aria-label={favorited ? t("إزالة من المفضّلة") : t("إضافة إلى المفضّلة")}
                  title={favorited ? t("إزالة من المفضّلة") : t("إضافة إلى المفضّلة")}
                  className={`shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${favorited ? "border-primary/50 bg-primary/10 text-primary" : "border-border/40 text-muted-foreground hover:text-primary"}`}
                >
                  <Heart className={`h-5 w-5 ${favorited ? "fill-current" : ""}`} />
                </button>
              </div>
              {product.category && (
                <Badge variant="secondary" className="text-xs text-primary border border-primary/30">{product.category}</Badge>
              )}
            </div>

            {/* Rating */}
            {product.rating && (
              <div className="flex items-center justify-center gap-2">
                <div className="flex">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} className={`w-4 h-4 ${s <= Math.round(product.rating!) ? "fill-primary text-primary" : "text-muted-foreground/40"}`} />
                  ))}
                </div>
                <span className="text-sm text-muted-foreground">({product.reviewCount} {t("تقييم")})</span>
              </div>
            )}

            {/* Price */}
            <div className="flex items-baseline justify-center gap-3">
              <span className="text-4xl font-bold text-primary">
                {formatCurrency(isRental ? rentalPricePerDay : product.price)}{isRental ? " / يوم" : ""}
              </span>
              {!isRental && product.originalPrice && (
                <span className="text-lg text-muted-foreground line-through">{formatCurrency(product.originalPrice)}</span>
              )}
            </div>

            {/* Stock */}
            <div className="text-center">
              {isRental ? (
                product.stock > 0 ? (
                  <span className="text-status-success text-sm font-medium">{t("متاح للإيجار")}</span>
                ) : (
                  <span className="text-status-warning text-sm font-medium">{t("محجوز حالياً")}</span>
                )
              ) : product.stock > 0 ? (
                <span className="text-status-success text-sm font-medium">{t("متوفر في المخزن")} ({product.stock} {t("قطعة")})</span>
              ) : (
                <span className="text-status-danger text-sm font-medium">{t("نفذت الكمية")}</span>
              )}
            </div>

            {/* Description */}
            {productDescription && (
              <p className="text-muted-foreground leading-relaxed text-center">{productDescription}</p>
            )}

            {/* Color Picker */}
            {colors.length > 0 && (
              <div className="text-center">
                <p className="text-sm font-medium mb-3 text-foreground">
                  {t("اللون")}: <span className="text-primary">{selectedColor?.name ?? t("اختر لوناً")}</span>
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {colors.map((color) => {
                    const selected = colorKey(selectedColor) === colorKey(color);
                    return (
                    <button
                      key={colorKey(color)}
                      onClick={() => handleSelectColor(color)}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition-all duration-200 ${
                        selected
                          ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "border-border/40 text-muted-foreground hover:border-primary/50 hover:bg-primary/5"
                      }`}
                      title={`${color.name} ${color.hex}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ColorDot color={color} size="md" />
                        <span className="truncate">{color.name}</span>
                      </span>
                      {selected && <Check className="h-4 w-4 shrink-0" />}
                    </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!isRental ? (
              <>
                {/* Quantity */}
                <div className="flex items-center justify-center gap-4">
                  <span className="text-sm font-medium text-foreground">{t("الكمية")}:</span>
                  <div className="flex items-center gap-2 border border-border/40 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      aria-label={t("تقليل الكمية")}
                      disabled={quantity <= 1}
                      className="px-3 py-2 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="px-4 py-2 text-foreground font-medium" aria-live="polite">{quantity}</span>
                    <button
                      onClick={() => setQuantity(q => Math.min(product.stock, q + 1))}
                      aria-label={t("زيادة الكمية")}
                      disabled={quantity >= product.stock}
                      className="px-3 py-2 hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Add to Cart Button */}
                <div className="flex justify-center">
                  <Button
                    className="w-1/2 py-6 text-lg gap-2"
                    disabled={product.stock === 0 || addToCart.isPending || (colors.length > 0 && !selectedColor)}
                    onClick={handleAddToCart}
                  >
                    <ShoppingCart className="w-5 h-5" />
                    {addedToCart ? t("تمت الإضافة!") : addToCart.isPending ? t("جاري الإضافة...") : colors.length > 0 && !selectedColor ? t("اختر اللون أولاً") : t("أضف إلى السلة")}
                  </Button>
                </div>
              </>
            ) : (
              <form onSubmit={handleRentalSubmit} className="rounded-2xl border border-border/30 bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <CalendarDays className="h-4 w-4 text-primary" />
                  {t("حجز المنتج للإيجار")}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">{t("اسم العميل")}</span>
                    <input value={rentalCustomerName} onChange={(e) => setRentalCustomerName(e.target.value)} className="w-full bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">{t("رقم الهاتف")}</span>
                    <input value={rentalPhone} onChange={(e) => setRentalPhone(e.target.value)} inputMode="tel" className="w-full bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">{t("تاريخ البداية")}</span>
                    <input type="date" value={rentalStartDate} onChange={(e) => setRentalStartDate(e.target.value)} className="w-full bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-muted-foreground mb-1">{t("تاريخ النهاية")}</span>
                    <input type="date" value={rentalEndDate} onChange={(e) => setRentalEndDate(e.target.value)} className="w-full bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                  </label>
                </div>
                <label className="block">
                  <span className="block text-xs text-muted-foreground mb-1">{t("ملاحظات")}</span>
                  <textarea value={rentalNotes} onChange={(e) => setRentalNotes(e.target.value)} rows={2} className="w-full bg-background border border-border/40 rounded-xl px-4 py-3 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                </label>
                <div className="rounded-xl border border-border/25 bg-background/60 p-3 text-sm text-muted-foreground">
                  {rentalDaysCount > 0 ? (
                    <span>{rentalDaysCount} {t("يوم")} × {formatMoney(rentalPricePerDay)} = <strong className="text-primary">{formatCurrency(rentalTotal)}</strong></span>
                  ) : (
                    <span>{t("اختر تاريخ البداية والنهاية لاحتساب السعر.")}</span>
                  )}
                </div>
                {rentalError && <p className="text-sm text-status-danger">{rentalError}</p>}
                {rentalMessage && <p className="text-sm text-status-success">{rentalMessage}</p>}
                <Button type="submit" className="w-full py-6 text-lg gap-2" disabled={product.stock === 0 || rentalSaving || !rentalStartDate || !rentalEndDate || !rentalPhone || rentalDaysCount <= 0}>
                  {rentalSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <CalendarDays className="h-5 w-5" />}
                  {rentalSaving ? t("جاري الحجز...") : t("تأكيد حجز الإيجار")}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="mt-10 space-y-6">
          {videos.length > 0 && (
            <section className="rounded-2xl border border-border/30 bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-foreground">{t("فيديوهات المنتج")}</h2>
                  <p className="text-xs text-muted-foreground">{t("معاينة سريعة قبل الإضافة للسلة")}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {videos.map((video, index) => (
                  <video
                    key={`${video}-${index}`}
                    src={video}
                    controls
                    preload="metadata"
                    className="aspect-video w-full rounded-xl border border-border/30 bg-black object-contain"
                  />
                ))}
              </div>
            </section>
          )}
          <ModelViewerCard modelUrl={productModelUrl || null} title={t("معاينة المنتج ثلاثية الأبعاد")} />
          <SmartSuggestions title={t("منتجات وخدمات مناسبة")} />
        </div>

        {/* Reviews Section */}
        <div className="mt-16 border-t border-border/30 pt-10">
          <h2 className="text-2xl font-bold text-foreground mb-8">{t("التقييمات")}</h2>
          
          {reviews && reviews.length > 0 ? (
            <div className="space-y-4 mb-10">
              {reviews.map((r) => (
                <div key={r.id} className="bg-card rounded-xl p-5 border border-border/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-foreground">{r.customerName}</span>
                    <div className="flex">
                      {[1,2,3,4,5].map(s => (
                        <Star key={s} className={`w-3.5 h-3.5 ${s <= r.rating ? "fill-primary text-primary" : "text-muted-foreground/30"}`} />
                      ))}
                    </div>
                  </div>
                  {r.comment && <p className="text-muted-foreground text-sm">{r.comment}</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground mb-8">{t("لا توجد تقييمات بعد. كن أول من يقيّم!")}</p>
          )}

          {/* Add Review Form */}
          <div className="bg-card rounded-xl p-6 border border-border/30 max-w-lg">
            <h3 className="text-lg font-semibold mb-4">{t("أضف تقييمك")}</h3>
            <form onSubmit={handleSubmitReview} className="space-y-4">
              <div>
                <label htmlFor="review-name" className="block text-sm font-medium text-foreground mb-1.5">
                  {t("الاسم")}
                </label>
                <input
                  id="review-name"
                  value={reviewerName}
                  onChange={e => setReviewerName(e.target.value)}
                  placeholder={t("اسمك")}
                  className="w-full bg-background border border-border/40 rounded-lg px-4 py-2.5 text-foreground placeholder-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">{t("التقييم")}</label>
                <div className="flex gap-1" role="group" aria-label={t("التقييم")}>
                  {[1,2,3,4,5].map(s => (
                    <button
                      key={s}
                      type="button"
                      aria-label={`${s} ${t("نجوم")}`}
                      aria-pressed={s <= reviewRating}
                      onClick={() => setReviewRating(s)}
                      className="rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <Star className={`w-6 h-6 transition-colors ${s <= reviewRating ? "fill-primary text-primary" : "text-muted-foreground/40"}`} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="review-comment" className="block text-sm font-medium text-foreground mb-1.5">
                  {t("التعليق")} <span className="text-muted-foreground font-normal">({t("اختياري")})</span>
                </label>
                <textarea
                  id="review-comment"
                  value={reviewComment}
                  onChange={e => setReviewComment(e.target.value)}
                  placeholder={t("تعليقك (اختياري)")}
                  rows={3}
                  className="w-full bg-background border border-border/40 rounded-lg px-4 py-2.5 text-foreground placeholder-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
              </div>
              <Button type="submit" className="w-full" disabled={createReview.isPending}>
                {createReview.isPending ? t("جاري الإرسال...") : t("إرسال التقييم")}
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* Fullscreen Preview Modal */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <button
            className="absolute top-4 right-4 text-white/70 hover:text-white"
            onClick={() => setPreviewOpen(false)}
          >
            <X className="w-8 h-8" />
          </button>
          <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <img src={images[selectedImage]} alt="" className="w-full max-h-[80dvh] object-contain rounded-xl" />
            {images.length > 1 && (
              <>
                <button
                  className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/80 transition-colors"
                  onClick={() => setSelectedImage(i => (i - 1 + images.length) % images.length)}
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 text-white p-2 rounded-full hover:bg-black/80 transition-colors"
                  onClick={() => setSelectedImage(i => (i + 1) % images.length)}
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </>
            )}
          </div>
          <div className="absolute bottom-6 flex gap-2">
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setSelectedImage(i)}
                className={`w-2 h-2 rounded-full transition-colors ${i === selectedImage ? "bg-primary" : "bg-white/40"}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
