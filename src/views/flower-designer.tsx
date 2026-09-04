"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Copy, Flower2, ImageOff, ImagePlus, Minus, Package, Play, Plus, RefreshCw, Search, ShoppingBag, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

type Variant = { id:number; color:string|null; colorHex:string|null; sku:string|null; image:string|null; price:number|null; cost?:number|null; stock:number; available:number; isActive:boolean };
type RecipeLine = { productId:number; quantity:number; unit:string; unitCost:number; notes:string|null };
type DesignerSection = "flowers"|"bridal_bouquets"|"ready_bouquets"|"wrapping"|"ribbons"|"extras";
type DesignerView = DesignerSection|"gallery"|"bouquet_gallery";
type CatalogProduct = { id:number; name:string; nameAr:string; price:number; costPrice?:number; originalPrice:number|null; stock:number; category:string|null; categoryName:string|null; designerSection:DesignerSection; availableInBouquetDesigner:boolean; showInBouquetBuilder:boolean; images:string[]; variants:Variant[]; recipe:RecipeLine[]; bouquetRecipe:RecipeLine[]; isReadyMadeBouquet:boolean; isBouquetTemplate:boolean };
type CatalogResponse = { catalogScope:"flower-only-v2"; allowedCategoryIds:number[]; products:CatalogProduct[] };
type GalleryItem = { id:number; mediaUrl:string; mediaType:"image"|"video"; title:string|null; titleAr:string|null; category:string|null; createdAt:string };
type Selection = { key:string; product:CatalogProduct; variant:Variant|null; quantity:number };
const catalogKey=["/api/products/designer-catalog","catalog-grid-v3"] as const;
const galleryKey=["/api/gallery?status=published","bouquet-designer-gallery"] as const;
const SECTIONS:DesignerSection[]=["flowers","bridal_bouquets","ready_bouquets","wrapping","ribbons","extras"];
const LABEL:Record<string,string>={flowers:"الورود",bridal_bouquets:"المسكات",ready_bouquets:"الباقات الجاهزة",wrapping:"التغليف",ribbons:"الأشرطة",extras:"إكسسوارات الباقة"};
const CATEGORY_ICON:Record<DesignerSection,string>={flowers:"🌹",bridal_bouquets:"💐",ready_bouquets:"🎁",wrapping:"🎀",ribbons:"🎗️",extras:"🌸"};
const GROUP:Record<DesignerSection,string>={flowers:"الورود",bridal_bouquets:"المسكة أو الباقة",ready_bouquets:"المسكة أو الباقة",wrapping:"التغليف",ribbons:"الشريط",extras:"الإكسسوارات"};
const FLOWER_GALLERY_CATEGORIES = new Set(["ورد", "الورد", "ورود", "flower", "flowers"]);
const BOUQUET_GALLERY_CATEGORIES = new Set(["باقات ورد", "باقة ورد", "مسكات ورد", "مسكة ورد", "bridal bouquets", "bridal bouquet", "ready bouquets", "ready bouquet"]);
const keyOf=(productId:number,variantId?:number|null)=>variantId?`v:${variantId}`:`p:${productId}`;
const productName=(product:CatalogProduct)=>product.nameAr||product.name;
const linePrice=(line:Selection)=>Number(line.variant?.price??line.product.price??0);
const stockOf=(product:CatalogProduct,variant:Variant|null)=>Math.max(0,Number(variant?(variant.available??variant.stock):product.variants.length?0:product.stock));
const isFlowerGalleryItem=(item:GalleryItem)=>FLOWER_GALLERY_CATEGORIES.has(item.category?.trim().toLocaleLowerCase("ar")??"");
const isBouquetGalleryItem=(item:GalleryItem)=>BOUQUET_GALLERY_CATEGORIES.has(item.category?.trim().toLocaleLowerCase("ar")??"");
async function fetchCatalog():Promise<CatalogResponse>{const response=await fetch("/api/products/designer-catalog",{credentials:"include"});if(!response.ok)throw new Error("تعذر تحميل كتالوج مصمم الباقات");return response.json();}
async function fetchDesignerGallery():Promise<GalleryItem[]>{const response=await fetch("/api/gallery?status=published",{credentials:"include"});if(!response.ok)throw new Error("تعذر تحميل معرض الصور");return response.json();}

export default function FlowerDesigner(){
 const [,navigate]=useLocation(); const client=useQueryClient(); const {toast}=useToast();
 const [active,setActive]=useState<DesignerView>("flowers"); const [search,setSearch]=useState(""); const [sort,setSort]=useState("popular"); const [availability,setAvailability]=useState("all"); const [color,setColor]=useState("all"); const [price,setPrice]=useState("all");
 const [quantities,setQuantities]=useState<Record<string,number>>({}); const [order,setOrder]=useState<string[]>([]); const [chosen,setChosen]=useState<Record<number,number|undefined>>({}); const [draftQty,setDraftQty]=useState<Record<number,number>>({}); const [note,setNote]=useState(""); const [templateName,setTemplateName]=useState(""); const [details,setDetails]=useState<CatalogProduct|null>(null); const [summaryOpen,setSummaryOpen]=useState(false); const [adding,setAdding]=useState(false); const [limit,setLimit]=useState(24); const [galleryPreview,setGalleryPreview]=useState<GalleryItem|null>(null);
 const catalog=useQuery({queryKey:catalogKey,queryFn:fetchCatalog,staleTime:30_000,refetchInterval:30_000,refetchOnWindowFocus:true});
 const gallery=useQuery({queryKey:galleryKey,queryFn:fetchDesignerGallery,enabled:active==="gallery"||active==="bouquet_gallery",staleTime:60_000,refetchOnWindowFocus:true});
 // The designer API already resolves the active Flowers / Bouquets store root
 // and every active child category.  Filtering again by the optional Admin
 // toggle hid valid store bouquets from this page.
 const products=useMemo(()=>{const data=catalog.data;if(!data||data.catalogScope!=="flower-only-v2")return[];return data.products.filter(p=>SECTIONS.includes(p.designerSection));},[catalog.data]);
 useEffect(()=>{if(typeof EventSource==="undefined")return;const stream=new EventSource("/api/products/designer-stream");const refresh=()=>void client.invalidateQueries({queryKey:catalogKey});stream.addEventListener("products",refresh);return()=>stream.close();},[client]);
 useEffect(()=>{products.slice(0,20).forEach(product=>{const src=product.images[0];if(src){const image=new Image();image.src=src;}});},[products]);
 const enabled=useMemo(()=>SECTIONS.filter(section=>products.some(product=>product.designerSection===section)),[products]);
 useEffect(()=>{if(active!=="gallery"&&active!=="bouquet_gallery"&&!enabled.includes(active))setActive(enabled[0]??"gallery");},[active,enabled]);
 const filtered=useMemo(()=>{if(active==="gallery"||active==="bouquet_gallery")return[];const needle=search.trim().toLocaleLowerCase();const rows=products.filter(product=>{const matchingCategory=product.designerSection===active;const colors=product.variants.map(v=>`${v.color??""} ${v.sku??""}`).join(" ").toLocaleLowerCase();const matchesSearch=!needle||`${productName(product)} ${product.name} ${colors}`.toLocaleLowerCase().includes(needle);const variants=product.variants.length?product.variants:[null];const available=variants.some(v=>stockOf(product,v)>0);const matchesAvailability=availability==="all"||(availability==="available"&&available)||(availability==="ready"&&available)||(availability==="made"&&!available);const matchesColor=color==="all"||product.variants.some(v=>(v.color||"")===color);const min=Math.min(...variants.map(v=>Number(v?.price??product.price)));const matchesPrice=price==="all"||(price==="under10"&&min<10_000)||(price==="10to30"&&min>=10_000&&min<=30_000)||(price==="over30"&&min>30_000);return matchingCategory&&matchesSearch&&matchesAvailability&&matchesColor&&matchesPrice;});return rows.sort((a,b)=>sort==="low"?a.price-b.price:sort==="high"?b.price-a.price:sort==="new"?b.id-a.id:b.stock-a.stock);},[active,availability,color,price,products,search,sort]);
 // The bouquet designer is a flower-only surface. Gallery sections remain
 // available in Admin Gallery, but only images filed under the flower section
 // are suitable references while composing a bouquet.
 const galleryItems=useMemo(()=> (gallery.data??[]).filter(isFlowerGalleryItem),[gallery.data]);
 const bouquetGalleryItems=useMemo(()=> (gallery.data??[]).filter(isBouquetGalleryItem),[gallery.data]);
 const visible=filtered.slice(0,limit); useEffect(()=>setLimit(24),[active,search,sort,availability,color,price]);
 const selected=useMemo<Selection[]>(()=>{const rows:Selection[]=[];products.forEach(product=>{if(!product.variants.length){const key=keyOf(product.id);if(quantities[key]>0)rows.push({key,product,variant:null,quantity:quantities[key]});}product.variants.forEach(variant=>{const key=keyOf(product.id,variant.id);if(quantities[key]>0)rows.push({key,product,variant,quantity:quantities[key]});});});const rank=new Map(order.map((key,index)=>[key,index]));return rows.sort((a,b)=>(rank.get(a.key)??999)-(rank.get(b.key)??999));},[order,products,quantities]);
 const subtotal=selected.reduce((sum,line)=>sum+linePrice(line)*line.quantity,0); const discount=selected.reduce((sum,line)=>sum+Math.max(0,Number(line.product.originalPrice??linePrice(line))-linePrice(line))*line.quantity,0); const total=Math.max(0,subtotal); const unavailable=selected.some(line=>line.quantity>stockOf(line.product,line.variant));
 const totals=useMemo(()=>{const by=(section:DesignerSection)=>selected.filter(line=>line.product.designerSection===section).reduce((sum,line)=>sum+linePrice(line)*line.quantity,0);return{items:selected.reduce((sum,line)=>sum+line.quantity,0),flowers:selected.filter(line=>line.product.designerSection==="flowers").reduce((sum,line)=>sum+line.quantity,0),flowersPrice:by("flowers"),wrapping:by("wrapping"),ribbons:by("ribbons"),extras:by("extras")};},[selected]);
 const colors=useMemo(()=>Array.from(new Set(products.flatMap(product=>product.variants.map(v=>v.color).filter(Boolean) as string[]))),[products]);
 function change(lineProduct:CatalogProduct,variant:Variant|null,delta:number){const key=keyOf(lineProduct.id,variant?.id);const max=stockOf(lineProduct,variant);setQuantities(current=>({...current,[key]:Math.max(0,Math.min(max,(current[key]??0)+delta))}));if(delta>0)setOrder(current=>current.includes(key)?current:[...current,key]);}
 function addProduct(product:CatalogProduct,variant?:Variant|null,quantity?:number){const selectedVariant=variant??(product.variants.find(item=>item.id===chosen[product.id])??product.variants.find(item=>stockOf(product,item)>0)??null);const max=stockOf(product,selectedVariant);if(max<=0){toast({title:"نفذت الكمية",variant:"destructive"});return;}const qty=Math.min(max,Math.max(1,quantity??draftQty[product.id]??1));if(product.designerSection==="wrapping"||product.designerSection==="ribbons")setQuantities(current=>{const next={...current};products.filter(row=>row.designerSection===product.designerSection).forEach(row=>{next[keyOf(row.id)]=0;row.variants.forEach(v=>next[keyOf(row.id,v.id)]=0);});next[keyOf(product.id,selectedVariant?.id)]=qty;return next;});else change(product,selectedVariant,qty);setOrder(current=>current.includes(keyOf(product.id,selectedVariant?.id))?current:[...current,keyOf(product.id,selectedVariant?.id)]);toast({title:"تمت إضافة المنتج إلى الباقة"});}
 function applyTemplate(template:CatalogProduct){const recipe=template.recipe.length?template.recipe:template.bouquetRecipe;const entries=recipe.map(row=>({product:products.find(product=>product.id===row.productId),quantity:row.quantity})).filter((row):row is {product:CatalogProduct;quantity:number}=>Boolean(row.product));if(!entries.length){toast({title:"لا تحتوي هذه الباقة على مكونات صالحة",variant:"destructive"});return;}setQuantities(current=>{const next={...current};entries.forEach(({product,quantity})=>{if(!product.variants.length)next[keyOf(product.id)]=Math.min(product.stock,Math.max(0,quantity));});return next;});setOrder(current=>[...new Set([...current,...entries.map(({product})=>keyOf(product.id))])]);setTemplateName(productName(template));toast({title:"تمت إضافة مكونات الباقة الجاهزة"});}
 function remove(line:Selection){setQuantities(current=>({...current,[line.key]:0}));}
 async function checkout(){if(!selected.length){toast({title:"اختر منتجاً واحداً على الأقل",variant:"destructive"});return;}setAdding(true);try{const check=await fetch("/api/products/designer-inventory/validate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:selected.map(line=>({productId:line.product.id,variantId:line.variant?.id??null,quantity:line.quantity}))})});const inventory=await check.json().catch(()=>({}));if(!check.ok||!inventory.ok){await catalog.refetch();throw new Error(inventory?.shortages?.map((row:any)=>`${row.name}: المتاح ${row.available}`).join("، ")||"تغيرت كمية المخزون، راجع اختياراتك.");}const snapshot={source:"bouquet_designer",templateName:templateName||undefined,giftCard:note.trim()||undefined,createdAt:new Date().toISOString(),items:selected.map(line=>({productId:line.product.id,variantId:line.variant?.id??null,sku:line.variant?.sku??line.product.id,image:line.variant?.image||line.product.images?.[0]||null,name:productName(line.product),price:linePrice(line),cost:Number(line.variant?.cost??line.product.costPrice??0),quantity:line.quantity,flowerColor:line.variant?.color??null,category:LABEL[line.product.designerSection]}))};for(const line of selected){const response=await fetch("/api/cart",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId:line.product.id,variantId:line.variant?.id,quantity:line.quantity,selectedColor:line.variant?.color||undefined,selectedColorData:line.variant?.color?{name:line.variant.color,hex:line.variant.colorHex||"",image:line.variant.image}:undefined,customization:JSON.stringify(snapshot)})});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body?.error||"تعذر إضافة المنتج إلى السلة");}await client.invalidateQueries({queryKey:["/api/cart"]});navigate("/checkout");}catch(error:any){toast({title:"لا يمكن متابعة الطلب",description:error?.message||"حاول مرة أخرى.",variant:"destructive"});}finally{setAdding(false);}}
 return <main dir="rtl" className="flower-design-studio"><div className="flower-design-studio__shell">
  <header className="flower-design-studio__header"><div className="flower-design-studio__title"><span><Flower2/></span><div><h1>تصميم باقة حسب الطلب</h1><p>اختر المنتجات وأضفها مباشرة إلى ملخص الباقة.</p></div></div><div className="flower-design-studio__header-actions"><Button variant="ghost" size="icon" title="تحديث الكتالوج" onClick={()=>void catalog.refetch()}><RefreshCw className={cn("h-4 w-4",catalog.isFetching&&"animate-spin")}/></Button><Button variant="ghost" asChild><Link href="/store">المتجر</Link></Button></div></header>
  <div className="flower-design-studio__layout"><section className="flower-design-studio__catalog"><div className="flower-design-studio__toolbar"><div className="flower-design-studio__search"><Search/><Input value={search} onChange={event=>setSearch(event.target.value)} placeholder="ابحث عن ورد أو مسكة أو باقة…"/></div><div className="flower-design-studio__filters"><SlidersHorizontal/><select value={sort} onChange={event=>setSort(event.target.value)} aria-label="ترتيب المنتجات"><option value="popular">الأكثر طلباً</option><option value="low">الأقل سعراً</option><option value="high">الأعلى سعراً</option><option value="new">الأحدث</option></select><select value={availability} onChange={event=>setAvailability(event.target.value)} aria-label="توفر المنتجات"><option value="all">كل الحالات</option><option value="available">متوفر الآن</option><option value="ready">مخزون جاهز</option><option value="made">يجهز حسب الطلب</option></select><select value={color} onChange={event=>setColor(event.target.value)} aria-label="لون المنتج"><option value="all">كل الألوان</option>{colors.map(value=><option value={value} key={value}>{value}</option>)}</select><select value={price} onChange={event=>setPrice(event.target.value)} aria-label="السعر"><option value="all">كل الأسعار</option><option value="under10">أقل من 10,000</option><option value="10to30">10,000 — 30,000</option><option value="over30">أكثر من 30,000</option></select></div></div>
  <nav className="flower-design-studio__categories" aria-label="فئات مصمم الباقات">
   {enabled.map(section=><button key={section} type="button" data-section={section} className={cn("flower-design-studio__category",active===section&&"is-active")} onClick={()=>setActive(section)}><span className="flower-design-studio__category-icon" aria-hidden="true">{CATEGORY_ICON[section]}</span><span>{LABEL[section]}</span></button>)}
   <button type="button" data-section="gallery" className={cn("flower-design-studio__category",active==="gallery"&&"is-active")} onClick={()=>setActive("gallery")}><span className="flower-design-studio__category-icon" aria-hidden="true">🖼️</span><span>معرض الورد</span></button>
   <button type="button" data-section="bouquet_gallery" className={cn("flower-design-studio__category",active==="bouquet_gallery"&&"is-active")} onClick={()=>setActive("bouquet_gallery")}><span className="flower-design-studio__category-icon" aria-hidden="true">💐</span><span>إلهام الباقات والمسكات</span></button>
  </nav>
  <div className="flower-design-studio__catalog-title"><div><h2>{active==="gallery"?"معرض صور الورد":active==="bouquet_gallery"?"إلهام الباقات والمسكات":LABEL[active]}</h2><p>{active==="gallery"?"صور قسم الورد المنشورة من مكتبة AJN.":active==="bouquet_gallery"?"صور باقات ومسكات الورد المنشورة من مكتبة AJN.":`${filtered.length} منتج متاح ضمن مصمم الباقات`}</p></div></div>
  {active==="gallery"?<DesignGallery items={galleryItems} isLoading={gallery.isLoading} isError={gallery.isError} onPreview={setGalleryPreview} onRetry={()=>void gallery.refetch()}/>:active==="bouquet_gallery"?<DesignGallery items={bouquetGalleryItems} isLoading={gallery.isLoading} isError={gallery.isError} onPreview={setGalleryPreview} onRetry={()=>void gallery.refetch()}/>:catalog.isLoading?<CatalogSkeleton/>:catalog.isError?<Empty text="تعذر تحميل كتالوج المصمم" action={()=>void catalog.refetch()}/>:visible.length?<div className="flower-design-studio__product-grid">{visible.map(product=><ProductCard key={product.id} product={product} chosen={chosen[product.id]} quantity={draftQty[product.id]??1} onChoose={variant=>setChosen(current=>({...current,[product.id]:variant.id}))} onQuantity={value=>setDraftQty(current=>({...current,[product.id]:value}))} onAdd={()=>product.designerSection==="ready_bouquets"||product.isReadyMadeBouquet||product.isBouquetTemplate?applyTemplate(product):addProduct(product)} onDetails={()=>setDetails(product)}/>)}</div>:<Empty text="لا توجد نتائج مطابقة لعوامل البحث والتصفية." action={()=>{setSearch("");setAvailability("all");setColor("all");setPrice("all");}} actionLabel="مسح التصفية"/>}{active!=="gallery"&&active!=="bouquet_gallery"&&filtered.length>limit&&<Button variant="outline" className="mt-5 w-full" onClick={()=>setLimit(value=>value+24)}>عرض المزيد</Button>}</section>
  <OrderSummary open={summaryOpen} setOpen={setSummaryOpen} selected={selected} note={note} setNote={setNote} totals={totals} subtotal={subtotal} discount={discount} total={total} isAdding={adding} unavailable={unavailable} onChange={(line:Selection,delta:number)=>change(line.product,line.variant,delta)} onRemove={remove} onDuplicate={(line:Selection)=>change(line.product,line.variant,line.quantity)} onCheckout={()=>void checkout()}/></div>
  <button type="button" className="flower-design-studio__mobile-cart" onClick={()=>setSummaryOpen(true)}><span>عرض السلة</span><b>{formatCurrency(total)}</b><small>{totals.items} منتجات</small></button>
  <ProductDetails product={details} chosen={details?chosen[details.id]:undefined} quantity={details?(draftQty[details.id]??1):1} onClose={()=>setDetails(null)} onChoose={(variant:Variant)=>details&&setChosen(current=>({...current,[details.id]:variant.id}))} onQuantity={(value:number)=>details&&setDraftQty(current=>({...current,[details.id]:value}))} onAdd={()=>{if(details){if(details.designerSection==="ready_bouquets"||details.isReadyMadeBouquet||details.isBouquetTemplate)applyTemplate(details);else addProduct(details);setDetails(null);}}}/>
  <GalleryPreview item={galleryPreview} onClose={()=>setGalleryPreview(null)}/>
 </div></main>;
}

function DesignGallery({items,isLoading,isError,onPreview,onRetry}:{items:GalleryItem[];isLoading:boolean;isError:boolean;onPreview:(item:GalleryItem)=>void;onRetry:()=>void}){return <section className="flower-design-studio__gallery" aria-label="معرض صور الورد"><div className="flower-design-studio__gallery-toolbar"><div className="flower-design-studio__gallery-categories"><span className="flower-design-studio__gallery-category is-active">الورد</span></div><Button type="button" variant="outline" className="flower-design-studio__gallery-manage" asChild><Link href="/admin/gallery"><ImagePlus/>إدارة وإضافة الصور</Link></Button></div>{isLoading?<GallerySkeleton/>:isError?<Empty text="تعذر تحميل معرض الصور" action={onRetry}/>:items.length?<div className="flower-design-studio__gallery-grid">{items.map(item=>{const title=item.titleAr||item.title||"صورة من معرض الورد";return <button key={item.id} type="button" className="flower-design-studio__gallery-card" onClick={()=>onPreview(item)} aria-label={`عرض ${title}`}><span className="flower-design-studio__gallery-media">{item.mediaType==="video"?<><video src={item.mediaUrl} muted playsInline preload="metadata" aria-hidden="true"/><span className="flower-design-studio__gallery-play" aria-hidden="true"><Play/></span></>:<img src={item.mediaUrl} alt="" loading="lazy" decoding="async"/>}</span><span className="flower-design-studio__gallery-caption"><b>{title}</b><small>الورد</small></span></button>;})}</div>:<Empty text="لا توجد صور في قسم الورد حتى الآن."/>}</section>}
function GalleryPreview({item,onClose}:{item:GalleryItem|null;onClose:()=>void}){const title=item?.titleAr||item?.title||"صورة من معرض الباقات";return <Dialog open={Boolean(item)} onOpenChange={open=>!open&&onClose()}><DialogContent dir="rtl" className="max-w-4xl"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>{item&&<div className="flower-design-studio__gallery-preview">{item.mediaType==="video"?<video src={item.mediaUrl} controls playsInline preload="metadata" aria-label={title}/>:<img src={item.mediaUrl} alt={title} loading="eager" decoding="async"/>}{item.category&&<p>{item.category}</p>}</div>}</DialogContent></Dialog>}
function GallerySkeleton(){return <div className="flower-design-studio__gallery-grid">{Array.from({length:6},(_,index)=><div className="space-y-3 rounded-xl border p-2" key={index}><Skeleton className="aspect-[4/3] w-full"/><Skeleton className="h-4 w-2/3"/></div>)}</div>}
function ProductCard({product,chosen,quantity,onChoose,onQuantity,onAdd,onDetails}:{product:CatalogProduct;chosen?:number;quantity:number;onChoose:(variant:Variant)=>void;onQuantity:(value:number)=>void;onAdd:()=>void;onDetails:()=>void}){const variant=product.variants.find(item=>item.id===chosen)??product.variants.find(item=>stockOf(product,item)>0)??product.variants[0]??null;const available=stockOf(product,variant);const discounted=product.originalPrice&&product.originalPrice>Number(variant?.price??product.price);return <article className={cn("flower-design-studio__product-card",available<=0&&"is-unavailable")}><ProductImage product={product} variant={variant} className="flower-design-studio__product-image"/><div className="flower-design-studio__product-body"><div className="flower-design-studio__product-meta"><span>{LABEL[product.designerSection]}</span>{available<=0?<em>نفذت الكمية</em>:product.stock<=0?<em>يجهز حسب الطلب</em>:<small>متوفر {available}</small>}</div><h3>{productName(product)}</h3><div className="flower-design-studio__price"><b>{formatCurrency(Number(variant?.price??product.price))}</b>{discounted&&<><del>{formatCurrency(Number(product.originalPrice))}</del><mark>خصم {Math.round((1-Number(variant?.price??product.price)/Number(product.originalPrice))*100)}%</mark></>}</div>{product.variants.length?<div className="flower-design-studio__colors" aria-label="اختيار اللون">{product.variants.slice(0,8).map(item=><button key={item.id} type="button" title={`${item.color||item.sku||"خيار"} — ${stockOf(product,item)}`} disabled={stockOf(product,item)<=0} onClick={()=>onChoose(item)} className={cn(chosen===item.id&&"is-selected")} style={{backgroundColor:item.colorHex||"#7e8790"}}><span className="sr-only">{item.color||item.sku||"خيار"}</span></button>)}<button type="button" className="flower-design-studio__color-label" onClick={onDetails}>اختيار اللون</button></div>:null}<div className="flower-design-studio__card-actions"><Quantity value={quantity} max={Math.max(1,available)} onChange={onQuantity}/><Button size="sm" disabled={available<=0} onClick={onAdd}><Plus/>إضافة</Button></div><button type="button" className="flower-design-studio__details" onClick={onDetails}>التفاصيل</button></div></article>}
function OrderSummary({open,setOpen,selected,note,setNote,totals,subtotal,discount,total,isAdding,unavailable,onChange,onRemove,onDuplicate,onCheckout}:any){const grouped=Object.entries(GROUP).map(([section,title])=>({section:section as DesignerSection,title,lines:selected.filter((line:Selection)=>line.product.designerSection===section)})).filter(group=>group.lines.length);return <aside className={cn("flower-design-studio__summary",open&&"is-open")}><div className="flower-design-studio__summary-head"><div><ShoppingBag/><h2>ملخص الباقة</h2></div><button className="flower-design-studio__summary-close" type="button" onClick={()=>setOpen(false)}><X/></button></div><BouquetPreview selected={selected}/><div className="flower-design-studio__summary-lines">{grouped.length?grouped.map(group=><section key={group.section}><h3>{group.title}</h3>{group.lines.map((line:Selection)=><div className="flower-design-studio__summary-row" key={line.key}><ProductImage product={line.product} variant={line.variant} className="flower-design-studio__summary-image"/><div><b>{productName(line.product)}</b><small>{line.variant?.color||"الخيار القياسي"} · SKU: {line.variant?.sku||line.product.id}</small><span>{formatCurrency(linePrice(line))} × {line.quantity}</span></div><Quantity value={line.quantity} max={stockOf(line.product,line.variant)} onChange={(value:number)=>onChange(line,value-line.quantity)}/><button type="button" title="مضاعفة" onClick={()=>onDuplicate(line)}><Copy/></button><button type="button" title="حذف" className="is-remove" onClick={()=>onRemove(line)}><Trash2/></button></div>)}</section>):<p className="flower-design-studio__summary-empty">أضف منتجاتك لتظهر تفاصيل الباقة هنا.</p>}</div><label className="flower-design-studio__gift-note">بطاقة الإهداء <small>اختياري</small><Input value={note} onChange={event=>setNote(event.target.value)} placeholder="رسالة البطاقة"/></label><div className="flower-design-studio__totals"><Total label="عدد المنتجات" value={totals.items} plain/><Total label="عدد الورود" value={totals.flowers} plain/><Total label="سعر الورود" value={totals.flowersPrice}/><Total label="سعر التغليف" value={totals.wrapping}/><Total label="سعر الشريط" value={totals.ribbons}/><Total label="سعر الإكسسوارات" value={totals.extras}/>{discount>0&&<Total label="الخصم" value={-discount}/>}<div className="flower-design-studio__grand"><span>المجموع النهائي</span><b>{formatCurrency(total)}</b></div></div><Button className="flower-design-studio__checkout" disabled={!selected.length||isAdding||unavailable} onClick={onCheckout}>{isAdding?"جارٍ التحقق…":"المتابعة إلى الدفع"}</Button></aside>}
function ProductDetails({product,chosen,quantity,onClose,onChoose,onQuantity,onAdd}:any){if(!product)return null;const variant=product.variants.find((item:Variant)=>item.id===chosen)??product.variants.find((item:Variant)=>stockOf(product,item)>0)??product.variants[0]??null;return <Dialog open onOpenChange={open=>!open&&onClose()}><DialogContent dir="rtl" className="max-w-3xl"><DialogHeader><DialogTitle>{productName(product)}</DialogTitle></DialogHeader><div className="grid gap-5 sm:grid-cols-2"><ProductGallery product={product} variant={variant}/><div className="space-y-4"><p className="text-sm text-muted-foreground">{product.categoryName||LABEL[product.designerSection]}</p><b className="block text-xl">{formatCurrency(Number(variant?.price??product.price))}</b>{product.variants.length?<div><p className="mb-2 text-sm font-medium">الألوان والخيارات</p><div className="flex flex-wrap gap-2">{product.variants.map((item:Variant)=><button key={item.id} type="button" disabled={stockOf(product,item)<=0} onClick={()=>onChoose(item)} className={cn("rounded-md border px-3 py-2 text-sm",chosen===item.id&&"border-primary bg-primary/10")}><i className="ml-2 inline-block h-3 w-3 rounded-full border" style={{background:item.colorHex||"transparent"}}/>{item.color||item.sku||"خيار"} · {stockOf(product,item)}</button>)}</div></div>:null}<Quantity value={quantity} max={Math.max(1,stockOf(product,variant))} onChange={onQuantity}/><Button className="w-full" disabled={stockOf(product,variant)<=0} onClick={onAdd}>إضافة إلى الباقة</Button></div></div></DialogContent></Dialog>}
function ProductGallery({product,variant}:{product:CatalogProduct;variant:Variant|null}){const images=Array.from(new Set([variant?.image,...product.images].filter((image):image is string=>Boolean(image))));const [active,setActive]=useState(images[0]);useEffect(()=>setActive(images[0]),[images[0]]);return <div className="space-y-2">{active?<img src={active} alt={productName(product)} className="aspect-square w-full rounded-lg bg-muted object-cover" loading="lazy" decoding="async"/>:<ProductImage product={product} variant={variant} className="aspect-square w-full rounded-lg bg-muted"/>}{images.length>1&&<div className="grid grid-cols-4 gap-2">{images.map(image=><button key={image} type="button" onClick={()=>setActive(image)} className={cn("overflow-hidden rounded border",active===image&&"border-primary")}><img src={image} alt="" className="aspect-square w-full object-cover" loading="lazy"/></button>)}</div>}</div>}
function ProductImage({product,variant,className}:{product:CatalogProduct;variant?:Variant|null;className:string}){const [failed,setFailed]=useState(false);const src=variant?.image||product.images[0];useEffect(()=>setFailed(false),[src]);return !src||failed?<span className={cn("grid place-items-center bg-muted text-muted-foreground",className)}><ImageOff className="h-5 w-5"/></span>:<img src={src} alt={productName(product)} className={cn("object-cover",className)} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>}
function Quantity({value,max,onChange}:{value:number;max:number;onChange:(value:number)=>void}){return <div className="flower-design-studio__quantity"><button type="button" disabled={value<=1} onClick={()=>onChange(Math.max(1,value-1))}><Minus/></button><span>{value}</span><button type="button" disabled={value>=max} onClick={()=>onChange(Math.min(max,value+1))}><Plus/></button></div>}
function Total({label,value,plain}:{label:string;value:number;plain?:boolean}){return <p><span>{label}</span><b>{plain?value:formatCurrency(value)}</b></p>}
function Empty({text,action,actionLabel="إعادة المحاولة"}:{text:string;action?:()=>void;actionLabel?:string}){return <div className="flower-design-studio__empty"><Package/><p>{text}</p>{action&&<Button variant="outline" onClick={action}>{actionLabel}</Button>}</div>}
function CatalogSkeleton(){return <div className="flower-design-studio__product-grid">{Array.from({length:8},(_,index)=><div className="space-y-3 rounded-lg border p-3" key={index}><Skeleton className="aspect-[4/3] w-full"/><Skeleton className="h-4 w-2/3"/><Skeleton className="h-8 w-full"/></div>)}</div>}

// ─────────────────────────────────────────────────────────────────────────────
// Live bouquet preview (illustrative, procedural SVG — NOT a product photo).
// Re-derives from the current selection on every render, so quantity, flower
// colour, wrapping colour and ribbon colour all update instantly. Blooms are
// arranged as a hand-tied florist dome (phyllotaxis spiral) that grows with the
// total flower count, cradled by a wrapping cone and finished with a ribbon bow.
// ─────────────────────────────────────────────────────────────────────────────
type BloomKind = "focal" | "filler" | "greenery";
const NAMED_COLORS: [RegExp, string][] = [
  [/(أحمر|احمر|red|قرمزي|عنابي|بوردو|burgundy|maroon)/i, "#d1273a"],
  [/(أبيض|ابيض|white|عاجي|ivory|كريمي|cream)/i, "#f6f2ea"],
  [/(فوشيا|fuchsia|ماجنتا|magenta)/i, "#c0356b"],
  [/(وردي|زهري|pink|روز|rose|باهت)/i, "#ec7f9e"],
  [/(أصفر|اصفر|yellow)/i, "#f2c14e"],
  [/(برتقالي|orange|مشمشي|peach|خوخي)/i, "#ef8a3b"],
  [/(أزرق|ازرق|blue|سماوي|تركوازي|turquoise)/i, "#5b7fbd"],
  [/(بنفسج|purple|violet|lavender|لافندر|موف|أرجواني)/i, "#8e6bb0"],
  [/(أخضر|اخضر|green|زيتي|olive)/i, "#6fae6f"],
  [/(ذهبي|gold|golden)/i, "#c9a24b"],
  [/(فضي|silver|رمادي|gray|grey)/i, "#c3c7cc"],
  [/(بيج|beige|كرافت|kraft|بني|brown|tan)/i, "#d8c2a0"],
  [/(أسود|black)/i, "#3f3f45"],
];
function nameToHex(...names: (string | null | undefined)[]): string | null {
  const text = names.filter(Boolean).join(" ");
  if (!text) return null;
  for (const [re, hex] of NAMED_COLORS) if (re.test(text)) return hex;
  return null;
}
function validHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(v) ? (v.startsWith("#") ? v : `#${v}`) : null;
}
function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h.slice(0, 6), 16);
  return Number.isNaN(n) ? { r: 209, g: 39, b: 58 } : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// amt in [-1,1]: negative darkens toward black, positive lightens toward white.
function shade(hex: string, amt: number): string {
  const c = parseHex(hex);
  const target = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  const mix = (v: number) => Math.round(v + (target - v) * p);
  return `#${[mix(c.r), mix(c.g), mix(c.b)].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}
// Deterministic pseudo-random from an index so the arrangement is stable across
// re-renders (no jitter when an unrelated value changes) yet looks organic.
function jitter(i: number, salt = 1): number {
  const x = Math.sin((i + 1) * 12.9898 * salt) * 43758.5453;
  return x - Math.floor(x);
}
function classifyFlower(name: string, color: string): BloomKind {
  const t = `${name} ${color}`.toLowerCase();
  if (/(بيبي|بيبى|نثري|جبسوفيليا|جبسوفيلا|gyp|baby|breath|فيلر|filler)/i.test(t)) return "filler";
  if (/(أوكالبتوس|يوكالبتوس|eucalyptus|ورق|أوراق|leaf|leaves|foliage|خضرة|نعناع|فرن|fern|سرخس)/i.test(t)) return "greenery";
  return "focal";
}

function Bloom({ x, y, size, hex, seed }: { x: number; y: number; size: number; hex: string; seed: number }) {
  const petal = shade(hex, 0.1);
  const dark = shade(hex, -0.2);
  const darker = shade(hex, -0.36);
  const light = shade(hex, 0.34);
  const rot = jitter(seed, 3) * Math.PI * 2;
  return (
    <g>
      {Array.from({ length: 6 }).map((_, k) => {
        const a = rot + (k / 6) * Math.PI * 2;
        return <circle key={k} cx={x + Math.cos(a) * size * 0.66} cy={y + Math.sin(a) * size * 0.66} r={size * 0.44} fill={petal} opacity={0.95} />;
      })}
      <circle cx={x} cy={y} r={size} fill={hex} />
      <circle cx={x} cy={y} r={size * 0.62} fill={dark} opacity={0.85} />
      <circle cx={x} cy={y} r={size * 0.3} fill={darker} />
      <circle cx={x - size * 0.28} cy={y - size * 0.3} r={size * 0.24} fill={light} opacity={0.55} />
    </g>
  );
}

function BouquetPreview({ selected }: { selected: Selection[] }) {
  const model = useMemo(() => {
    const focal: { hex: string; qty: number }[] = [];
    let fillerQty = 0;
    let greeneryQty = 0;
    for (const line of selected) {
      const section = line.product.designerSection;
      if (section !== "flowers" && section !== "bridal_bouquets") continue;
      const name = productName(line.product);
      const colorName = line.variant?.color ?? "";
      const kind = classifyFlower(name, colorName);
      if (kind === "filler") { fillerQty += line.quantity; continue; }
      if (kind === "greenery") { greeneryQty += line.quantity; continue; }
      const hex = validHex(line.variant?.colorHex) ?? nameToHex(colorName, name) ?? "#d1273a";
      focal.push({ hex, qty: line.quantity });
    }
    const wrapLine = selected.find((l) => l.product.designerSection === "wrapping");
    const ribbonLine = selected.find((l) => l.product.designerSection === "ribbons");
    const wrapHex = validHex(wrapLine?.variant?.colorHex) ?? nameToHex(wrapLine?.variant?.color, wrapLine ? productName(wrapLine.product) : "") ?? "#e9dcc4";
    const ribbonHex = validHex(ribbonLine?.variant?.colorHex) ?? nameToHex(ribbonLine?.variant?.color, ribbonLine ? productName(ribbonLine.product) : "") ?? "#c9a24b";
    const totalFocal = focal.reduce((s, f) => s + f.qty, 0);
    // Cap rendered blooms for performance while keeping true colour ratios and
    // letting the DOME SIZE reflect the real total count.
    const cap = 54;
    const scale = totalFocal > cap ? cap / totalFocal : 1;
    const groups = focal.map((f) => ({ hex: f.hex, n: Math.max(1, Math.round(f.qty * scale)) }));
    const beads: string[] = [];
    let remaining = groups.reduce((s, g) => s + g.n, 0);
    while (remaining > 0) for (const g of groups) if (g.n > 0) { beads.push(g.hex); g.n--; remaining--; }
    return { beads, totalFocal, fillerQty, greeneryQty, wrapHex, ribbonHex };
  }, [selected]);

  const { beads, totalFocal, fillerQty, greeneryQty, wrapHex, ribbonHex } = model;
  const hasContent = totalFocal > 0 || fillerQty > 0 || greeneryQty > 0;

  const cx = 160;
  const cy = 148;
  const R = Math.max(46, Math.min(140, 44 + 9 * Math.sqrt(Math.max(1, totalFocal))));
  const neckW = 18;
  const neckY = cy + R * 0.58;
  const bottomY = 338;

  // Focal blooms placed on a golden-angle (phyllotaxis) spiral, flattened into a
  // dome; painted back-to-front so front blooms overlap for a hand-tied look.
  const placed = beads.map((hex, i) => {
    const t = i + 0.5;
    const rr = R * 0.94 * Math.sqrt(t / Math.max(1, beads.length));
    const a = t * 2.399963;
    const jx = (jitter(i, 2) - 0.5) * R * 0.08;
    const jy = (jitter(i, 5) - 0.5) * R * 0.08;
    const x = cx + Math.cos(a) * rr + jx;
    const y = cy + Math.sin(a) * rr * 0.82 - R * 0.06 + jy;
    const size = R * (0.16 + jitter(i, 7) * 0.05);
    return { x, y, size, hex, seed: i };
  }).sort((p, q) => p.y - q.y);

  // Filler (baby's breath) accents scattered around the outer rim/gaps.
  const fillerCount = Math.min(24, Math.round(fillerQty));
  const fillers = Array.from({ length: fillerCount }).map((_, i) => {
    const a = i * 2.399963 + 0.6;
    const rr = R * (0.55 + jitter(i, 11) * 0.5);
    return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.82 - R * 0.06 };
  });

  // Greenery sprigs poking out at the lower edges.
  const greeneryCount = greeneryQty > 0 ? Math.min(7, Math.round(greeneryQty)) : 0;

  const wrapGradId = "ajn-wrap-grad";

  return (
    <div className="mb-4 rounded-2xl border border-border/40 bg-gradient-to-b from-muted/40 to-background p-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-foreground">معاينة الباقة المباشرة</span>
        <span className="text-[10px] text-muted-foreground">
          {totalFocal + fillerQty + greeneryQty > 0 ? `${totalFocal} وردة` : ""}
        </span>
      </div>
      <svg viewBox="0 0 320 360" role="img" aria-label="معاينة تخيلية للباقة" className="mx-auto block h-56 w-full">
        <defs>
          <linearGradient id={wrapGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={shade(wrapHex, 0.18)} />
            <stop offset="55%" stopColor={wrapHex} />
            <stop offset="100%" stopColor={shade(wrapHex, -0.2)} />
          </linearGradient>
        </defs>

        {hasContent ? (
          <>
            {/* Greenery behind the dome */}
            {Array.from({ length: greeneryCount }).map((_, i) => {
              const side = i % 2 === 0 ? -1 : 1;
              const bx = cx + side * (R * 0.5 + i * 4);
              const by = cy + R * 0.2;
              const tipX = bx + side * (18 + jitter(i, 4) * 14);
              const tipY = by - 30 - jitter(i, 6) * 26;
              return (
                <g key={`g${i}`} opacity={0.9}>
                  <path d={`M ${bx} ${by} Q ${(bx + tipX) / 2 + side * 8} ${(by + tipY) / 2} ${tipX} ${tipY}`} fill="none" stroke="#5f9e5f" strokeWidth={2} strokeLinecap="round" />
                  {Array.from({ length: 3 }).map((__, k) => {
                    const f = (k + 1) / 4;
                    const lx = bx + (tipX - bx) * f;
                    const ly = by + (tipY - by) * f;
                    return <ellipse key={k} cx={lx} cy={ly} rx={5} ry={2.4} fill="#6fae6f" transform={`rotate(${side * (35 + k * 8)} ${lx} ${ly})`} />;
                  })}
                </g>
              );
            })}

            {/* Wrapping cone (back sheet + front sheet) */}
            <path
              d={`M ${cx - R * 1.28} ${cy - R * 0.05} C ${cx - R * 1.0} ${cy + R * 0.55}, ${cx - neckW * 2} ${neckY}, ${cx - neckW * 0.5} ${neckY + 4} L ${cx} ${bottomY} L ${cx + neckW * 0.5} ${neckY + 4} C ${cx + neckW * 2} ${neckY}, ${cx + R * 1.0} ${cy + R * 0.55}, ${cx + R * 1.28} ${cy - R * 0.05} Z`}
              fill={shade(wrapHex, 0.12)}
              opacity={0.85}
            />
            <path
              d={`M ${cx - R * 1.05} ${cy + R * 0.02} C ${cx - R * 0.85} ${cy + R * 0.55}, ${cx - neckW * 1.3} ${neckY}, ${cx - neckW} ${neckY} L ${cx} ${bottomY} L ${cx + neckW} ${neckY} C ${cx + neckW * 1.3} ${neckY}, ${cx + R * 0.85} ${cy + R * 0.55}, ${cx + R * 1.05} ${cy + R * 0.02} Z`}
              fill={`url(#${wrapGradId})`}
            />
            {/* Wrap fold lines */}
            {[-0.6, -0.2, 0.2, 0.6].map((f, i) => (
              <path key={`f${i}`} d={`M ${cx + f * neckW} ${neckY} L ${cx + f * R * 0.95} ${cy + R * 0.05}`} stroke={shade(wrapHex, -0.22)} strokeWidth={1} opacity={0.35} fill="none" />
            ))}

            {/* Focal blooms */}
            {placed.map((b, i) => (
              <Bloom key={i} x={b.x} y={b.y} size={b.size} hex={b.hex} seed={b.seed} />
            ))}

            {/* Baby's-breath fillers */}
            {fillers.map((p, i) => (
              <g key={`fl${i}`}>
                {[[0, 0], [3, -2], [-3, -1], [1, 3]].map(([dx, dy], k) => (
                  <circle key={k} cx={p.x + dx} cy={p.y + dy} r={1.7} fill="#f7f5ef" stroke="#e3ddcf" strokeWidth={0.4} />
                ))}
              </g>
            ))}

            {/* Ribbon bow at the neck */}
            <g>
              <path d={`M ${cx} ${neckY} C ${cx - 34} ${neckY - 22}, ${cx - 42} ${neckY + 16}, ${cx - 6} ${neckY + 6} Z`} fill={ribbonHex} stroke={shade(ribbonHex, -0.25)} strokeWidth={1} />
              <path d={`M ${cx} ${neckY} C ${cx + 34} ${neckY - 22}, ${cx + 42} ${neckY + 16}, ${cx + 6} ${neckY + 6} Z`} fill={ribbonHex} stroke={shade(ribbonHex, -0.25)} strokeWidth={1} />
              <path d={`M ${cx - 4} ${neckY + 5} q -8 24 -18 38 l 9 3 q 9 -20 13 -36 Z`} fill={shade(ribbonHex, -0.16)} />
              <path d={`M ${cx + 4} ${neckY + 5} q 8 24 18 38 l -9 3 q -9 -20 -13 -36 Z`} fill={shade(ribbonHex, -0.16)} />
              <ellipse cx={cx} cy={neckY + 2} rx={7} ry={9} fill={shade(ribbonHex, 0.2)} stroke={shade(ribbonHex, -0.25)} strokeWidth={1} />
            </g>
          </>
        ) : (
          <g>
            <path d={`M ${cx - 70} ${cy} C ${cx - 55} ${cy + 90}, ${cx - 18} ${neckY}, ${cx} ${bottomY} C ${cx + 18} ${neckY}, ${cx + 55} ${cy + 90}, ${cx + 70} ${cy} Z`} fill="hsl(var(--muted))" opacity={0.6} />
            <text x={cx} y={cy + 10} textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 13 }}>اختر الورود لتظهر معاينة الباقة</text>
          </g>
        )}
      </svg>
      <p className="px-1 text-center text-[10px] leading-relaxed text-muted-foreground">
        معاينة تخيلية للتصميم فقط (ليست صورة المنتج الفعلي).
      </p>
    </div>
  );
}
