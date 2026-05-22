import { useState } from "react";
import { Link } from "wouter";
import { useListProducts, useListProductCategories } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShoppingCart, Search, Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Store() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("");
  
  const { data: products, isLoading } = useListProducts(
    { search, category: category !== "all" ? category : undefined },
    { query: { enabled: true, queryKey: ['/api/products', search, category] } }
  );

  const { data: categories } = useListProductCategories();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground">المتجر</h1>
          <p className="text-muted-foreground mt-1">تسوق أحدث منتجات وتجهيزات المناسبات</p>
        </div>
        
        <div className="flex w-full md:w-auto gap-2">
          <div className="relative w-full md:w-64">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="ابحث عن منتج..." 
              className="pr-9 bg-card border-border"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[140px] bg-card border-border">
              <SelectValue placeholder="كل الفئات" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الفئات</SelectItem>
              {categories?.map(c => (
                <SelectItem key={c.name} value={c.name}>{c.name} ({c.count})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {isLoading ? (
          Array(8).fill(0).map((_, i) => (
            <Card key={i} className="bg-card border-border overflow-hidden">
              <Skeleton className="aspect-square w-full rounded-none" />
              <CardContent className="p-4">
                <Skeleton className="h-4 w-2/3 mb-2" />
                <Skeleton className="h-4 w-1/3 mb-4" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))
        ) : products?.length === 0 ? (
          <div className="col-span-full py-20 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
              <Filter className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-medium text-foreground mb-2">لا توجد منتجات</h3>
            <p className="text-muted-foreground">لم يتم العثور على منتجات تطابق بحثك</p>
            <Button variant="link" className="text-primary mt-4" onClick={() => { setSearch(""); setCategory("all"); }}>
              مسح عوامل التصفية
            </Button>
          </div>
        ) : (
          products?.map((product) => (
            <Link key={product.id} href={`/store/${product.id}`}>
              <Card className="bg-card border-border overflow-hidden group cursor-pointer hover:border-primary/50 transition-colors h-full flex flex-col">
                <div className="relative aspect-square overflow-hidden bg-muted">
                  <img 
                    src={product.images[0] || 'https://placehold.co/400x400/1a1a1a/c9a84c?text=AJN'} 
                    alt={product.nameAr}
                    className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-110"
                  />
                  {product.stock <= 0 && (
                    <div className="absolute top-2 right-2 bg-destructive/90 text-destructive-foreground text-xs font-bold px-2 py-1 rounded backdrop-blur-sm">
                      نفذت الكمية
                    </div>
                  )}
                  {product.originalPrice && product.originalPrice > product.price && (
                    <div className="absolute top-2 left-2 bg-primary/90 text-primary-foreground text-xs font-bold px-2 py-1 rounded backdrop-blur-sm">
                      تخفيض
                    </div>
                  )}
                </div>
                <CardContent className="p-4 flex flex-col flex-1">
                  <div className="text-xs text-muted-foreground mb-1">{product.category}</div>
                  <h3 className="font-medium text-sm md:text-base line-clamp-2 mb-2 text-foreground group-hover:text-primary transition-colors">
                    {product.nameAr}
                  </h3>
                  
                  <div className="mt-auto pt-4 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="font-bold text-primary">{product.price.toLocaleString('en-US')} د.ع</span>
                      {product.originalPrice && product.originalPrice > product.price && (
                        <span className="text-xs text-muted-foreground line-through">
                          {product.originalPrice.toLocaleString('en-US')} د.ع
                        </span>
                      )}
                    </div>
                    <span className="h-8 w-8 flex items-center justify-center rounded-full text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors shrink-0">
                      <ShoppingCart className="h-4 w-4" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}