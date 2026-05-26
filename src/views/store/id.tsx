import { useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetProduct, useListReviews, useCreateReview, useAddToCart, getGetCartQueryKey, getGetProductQueryKey, getListReviewsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Check, Star, ShoppingCart, ChevronRight, ChevronLeft, X, Minus, Plus } from "lucide-react";
import { ColorDot } from "@/components/product-colors";
import { colorImage, colorKey, normalizeColors, type ProductColor } from "@/lib/colors";
import { ModelViewerCard } from "@/components/interactive/model-viewer";
import { SmartSuggestions } from "@/components/interactive/smart-suggestions";

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

  const [selectedImage, setSelectedImage] = useState(0);
  const [selectedColor, setSelectedColor] = useState<ProductColor | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reviewerName, setReviewerName] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [addedToCart, setAddedToCart] = useState(false);

  const createReview = useCreateReview();

  const images = product?.images?.length
    ? product.images
    : ["/placeholder-product.jpg"];
  const imageMetadata = product?.imageMetadata ?? [];
  const colors = useMemo(() => normalizeColors(product?.colors ?? []), [product?.colors]);
  const productModelUrl = useMemo(() => {
    const metadata = imageMetadata.find((entry: any) => entry?.modelUrl);
    return metadata?.modelUrl ? String(metadata.modelUrl) : "";
  }, [imageMetadata]);

  function handleAddToCart() {
    if (!product) return;
    if (colors.length > 0 && !selectedColor) return;
    addToCart.mutate(
      { data: { productId: product.id, quantity, selectedColor: selectedColor?.name, selectedColorData: selectedColor ?? undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCartQueryKey() });
          setAddedToCart(true);
          setTimeout(() => setAddedToCart(false), 2000);
        },
      }
    );
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
      { onSuccess: () => { setReviewerName(""); setReviewComment(""); setReviewRating(5); } }
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
        <p className="text-lg">المنتج غير موجود</p>
        <Button onClick={() => navigate("/store")} className="mt-4">العودة للمتجر</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      {/* Breadcrumb */}
      <div className="border-b border-border/30 py-3">
        <div className="container mx-auto px-4 flex items-center gap-2 text-sm text-muted-foreground">
          <button onClick={() => navigate("/store")} className="hover:text-primary transition-colors">المتجر</button>
          <span>/</span>
          <span className="text-foreground">{product.nameAr}</span>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          {/* Images */}
          <div className="space-y-4">
            <div
              className="relative aspect-square rounded-xl overflow-hidden bg-card cursor-zoom-in border border-border/40"
              onClick={() => setPreviewOpen(true)}
            >
              <img
                src={images[selectedImage]}
                alt={product.nameAr}
                className="w-full h-full transition-transform duration-300 hover:scale-105"
                style={{ objectFit: String(imageMetadata[selectedImage]?.objectFit ?? "cover") as any }}
              />
              <span className="absolute bottom-3 left-3 text-xs text-white/70 bg-black/40 px-2 py-1 rounded">معاينة</span>
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedImage(i)}
                    className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${i === selectedImage ? "border-primary" : "border-transparent"}`}
                  >
                    <img src={img} alt="" className="w-full h-full" style={{ objectFit: String(imageMetadata[i]?.objectFit ?? "cover") as any }} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">{product.nameAr}</h1>
              {product.category && (
                <Badge variant="secondary" className="text-xs text-primary border border-primary/30">{product.category}</Badge>
              )}
            </div>

            {/* Rating */}
            {product.rating && (
              <div className="flex items-center gap-2">
                <div className="flex">
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} className={`w-4 h-4 ${s <= Math.round(product.rating!) ? "fill-primary text-primary" : "text-muted-foreground/40"}`} />
                  ))}
                </div>
                <span className="text-sm text-muted-foreground">({product.reviewCount} تقييم)</span>
              </div>
            )}

            {/* Price */}
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold text-primary">{Number(product.price).toLocaleString('ar-IQ')} د.ع</span>
              {product.originalPrice && (
                <span className="text-lg text-muted-foreground line-through">{Number(product.originalPrice).toLocaleString('ar-IQ')}</span>
              )}
            </div>

            {/* Stock */}
            <div>
              {product.stock > 0 ? (
                <span className="text-green-400 text-sm font-medium">متوفر في المخزن ({product.stock} قطعة)</span>
              ) : (
                <span className="text-red-400 text-sm font-medium">نفذت الكمية</span>
              )}
            </div>

            {/* Description */}
            {product.descriptionAr && (
              <p className="text-muted-foreground leading-relaxed">{product.descriptionAr}</p>
            )}

            {/* Color Picker */}
            {colors.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-3 text-foreground">
                  اللون: <span className="text-primary">{selectedColor?.name ?? "اختر لوناً"}</span>
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

            {/* Quantity */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-foreground">الكمية:</span>
              <div className="flex items-center gap-2 border border-border/40 rounded-lg overflow-hidden">
                <button
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="px-3 py-2 hover:bg-muted transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="px-4 py-2 text-foreground font-medium">{quantity}</span>
                <button
                  onClick={() => setQuantity(q => Math.min(product.stock, q + 1))}
                  className="px-3 py-2 hover:bg-muted transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Add to Cart Button */}
            <Button
              className="w-full py-6 text-lg gap-2"
              disabled={product.stock === 0 || addToCart.isPending || (colors.length > 0 && !selectedColor)}
              onClick={handleAddToCart}
            >
              <ShoppingCart className="w-5 h-5" />
              {addedToCart ? "تمت الإضافة!" : addToCart.isPending ? "جاري الإضافة..." : colors.length > 0 && !selectedColor ? "اختر اللون أولاً" : "أضف إلى السلة"}
            </Button>
          </div>
        </div>

        <div className="mt-10 space-y-6">
          <ModelViewerCard modelUrl={productModelUrl || null} title="معاينة المنتج ثلاثية الأبعاد" />
          <SmartSuggestions title="منتجات وخدمات مناسبة" />
        </div>

        {/* Reviews Section */}
        <div className="mt-16 border-t border-border/30 pt-10">
          <h2 className="text-2xl font-bold text-foreground mb-8">التقييمات</h2>
          
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
            <p className="text-muted-foreground mb-8">لا توجد تقييمات بعد. كن أول من يقيّم!</p>
          )}

          {/* Add Review Form */}
          <div className="bg-card rounded-xl p-6 border border-border/30 max-w-lg">
            <h3 className="text-lg font-semibold mb-4">أضف تقييمك</h3>
            <form onSubmit={handleSubmitReview} className="space-y-4">
              <input
                value={reviewerName}
                onChange={e => setReviewerName(e.target.value)}
                placeholder="اسمك"
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-2.5 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50"
              />
              <div className="flex gap-1">
                {[1,2,3,4,5].map(s => (
                  <button key={s} type="button" onClick={() => setReviewRating(s)}>
                    <Star className={`w-6 h-6 transition-colors ${s <= reviewRating ? "fill-primary text-primary" : "text-muted-foreground/40"}`} />
                  </button>
                ))}
              </div>
              <textarea
                value={reviewComment}
                onChange={e => setReviewComment(e.target.value)}
                placeholder="تعليقك (اختياري)"
                rows={3}
                className="w-full bg-background border border-border/40 rounded-lg px-4 py-2.5 text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary/50 resize-none"
              />
              <Button type="submit" className="w-full" disabled={createReview.isPending}>
                {createReview.isPending ? "جاري الإرسال..." : "إرسال التقييم"}
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
            <img src={images[selectedImage]} alt="" className="w-full max-h-[80vh] object-contain rounded-xl" />
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
