import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch, apiErrorMessage } from "./_lib";
import { useToast } from "@/hooks/use-toast";

type Category = { id: number; name: string };
type Dish = { id:number; code:string; name:string; category_id:number; category_name?:string; unit:string; selling_price:number; cost:number; stock_quantity:number; min_stock:number; image_url?:string|null; track_inventory:boolean; is_active:boolean; available_for_sale:boolean };
const input = "w-full rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none focus:border-primary/60";
const money = (value:number) => Number(value || 0).toLocaleString("ar-IQ-u-nu-latn") + " د.ع";

function readDishImage(file: File): Promise<string> {
  if (!/^image\/(png|webp|jpeg|jpg)$/i.test(file.type)) throw new Error("صيغة الصورة يجب أن تكون PNG أو WebP أو JPG");
  if (file.size > 5 * 1024 * 1024) throw new Error("حجم صورة الطبق يجب ألا يتجاوز 5 ميغابايت");
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("تعذر قراءة الصورة")); reader.readAsDataURL(file); });
}

function DishImageControl({ dish }: { dish: Dish }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const upload = useMutation({
    mutationFn: (imageUrl: string) => adminFetch(`/admin/catering/items/${dish.id}/image`, { method: "POST", body: JSON.stringify({ imageUrl }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catering", "items"] }); qc.invalidateQueries({ queryKey: ["catering", "catalog"] }); toast({ title: "تم حفظ صورة الطبق" }); },
    onError: (error: Error) => toast({ title: apiErrorMessage(error), variant: "destructive" }),
  });
  const select = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { upload.mutate(await readDishImage(file)); } catch (error) { toast({ title: error instanceof Error ? error.message : "تعذر قراءة الصورة", variant: "destructive" }); } };
  return <div className="flex items-center gap-2"><button type="button" title="رفع أو تغيير صورة الطبق" onClick={() => inputRef.current?.click()} className="group relative h-12 w-12 overflow-hidden rounded-md border bg-muted"><img src={dish.image_url || "/placeholder.svg"} alt={dish.name} className="h-full w-full object-cover" /><span className="absolute inset-0 grid place-content-center bg-background/70 opacity-0 transition-opacity group-hover:opacity-100"><Upload className="h-4 w-4" /></span></button><input ref={inputRef} type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={select}/>{upload.isPending && <span className="text-xs text-muted-foreground">جارٍ الرفع…</span>}</div>;
}

export default function CateringItems() {
  const qc = useQueryClient(); const { toast } = useToast();
  const [search, setSearch] = useState(""); const [imageDataUrl, setImageDataUrl] = useState("");
  const [form, setForm] = useState({ code:"", name:"", categoryId:"", sellingPrice:"", cost:"", stockQuantity:"", minStock:"", unit:"حبة" });
  const categories = useQuery<{categories:Category[]}>({ queryKey:["catering","categories"], queryFn:()=>adminFetch("/admin/catering/categories") });
  const dishes = useQuery<{items:Dish[]}>({ queryKey:["catering","items",search], queryFn:()=>adminFetch(`/admin/catering/items?search=${encodeURIComponent(search)}`) });
  const save = useMutation({
    mutationFn: async () => {
      const dish = await adminFetch<Dish>("/admin/catering/items", { method:"POST", body:JSON.stringify({ code:form.code, name:form.name, categoryId:Number(form.categoryId), unit:form.unit, cost:Number(form.cost)||0, sellingPrice:Number(form.sellingPrice)||0, stockQuantity:Number(form.stockQuantity)||0, minStock:Number(form.minStock)||0, preparationMinutes:0, packagingCost:0, preparationLaborCost:0, trackInventory:true, availableForSale:true, isActive:true }) });
      if (imageDataUrl) await adminFetch(`/admin/catering/items/${dish.id}/image`, { method:"POST", body:JSON.stringify({ imageUrl:imageDataUrl }) });
    },
    onSuccess: () => { setForm({ code:"",name:"",categoryId:"",sellingPrice:"",cost:"",stockQuantity:"",minStock:"",unit:"حبة" }); setImageDataUrl(""); qc.invalidateQueries({queryKey:["catering","items"]}); qc.invalidateQueries({queryKey:["catering","catalog"]}); toast({title:"تم حفظ الطبق وصورته"}); },
    onError: (error:Error) => toast({title:apiErrorMessage(error),variant:"destructive"}),
  });
  const selectImage = async (event: ChangeEvent<HTMLInputElement>) => { const file=event.target.files?.[0]; event.target.value=""; if(!file)return; try { setImageDataUrl(await readDishImage(file)); } catch(error) { toast({title:error instanceof Error?error.message:"تعذر قراءة الصورة",variant:"destructive"}); } };
  return <div className="space-y-4">
    <form onSubmit={(event)=>{event.preventDefault();save.mutate();}} className="grid gap-2 rounded-xl border border-border/30 bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <input className={input} required placeholder="الكود" value={form.code} onChange={event=>setForm({...form,code:event.target.value})}/><input className={input} required placeholder="اسم الطبق" value={form.name} onChange={event=>setForm({...form,name:event.target.value})}/><select className={input} required value={form.categoryId} onChange={event=>setForm({...form,categoryId:event.target.value})}><option value="">اختر الفئة</option>{categories.data?.categories.map(category=><option value={category.id} key={category.id}>{category.name}</option>)}</select><input className={input} placeholder="الوحدة" value={form.unit} onChange={event=>setForm({...form,unit:event.target.value})}/>
      <input className={input} type="number" min="0" placeholder="سعر البيع" value={form.sellingPrice} onChange={event=>setForm({...form,sellingPrice:event.target.value})}/><input className={input} type="number" min="0" placeholder="الكلفة" value={form.cost} onChange={event=>setForm({...form,cost:event.target.value})}/><input className={input} type="number" min="0" placeholder="رصيد المخزون" value={form.stockQuantity} onChange={event=>setForm({...form,stockQuantity:event.target.value})}/><input className={input} type="number" min="0" placeholder="حد التنبيه" value={form.minStock} onChange={event=>setForm({...form,minStock:event.target.value})}/>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-primary/50 bg-primary/5 px-3 text-sm font-medium"><ImagePlus className="h-4 w-4 text-primary"/>{imageDataUrl ? "تم اختيار صورة — اضغط لتغييرها" : "إضافة صورة للطبق"}<input type="file" accept="image/png,image/webp,image/jpeg" className="hidden" onChange={selectImage}/></label>{imageDataUrl&&<img src={imageDataUrl} alt="معاينة الطبق" className="h-11 w-11 rounded-md border object-cover"/>}<Button className="lg:col-start-4" disabled={save.isPending}>{save.isPending?"جارٍ الحفظ…":"حفظ الطبق"}</Button>
    </form>
    <div className="relative max-w-md"><Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground"/><input className={input+" pr-9"} placeholder="بحث بالاسم أو الكود أو الباركود" value={search} onChange={event=>setSearch(event.target.value)}/></div>
    <div className="overflow-x-auto rounded-xl border border-border/30 bg-card"><table className="w-full min-w-[760px] text-sm"><thead className="border-b text-right text-xs text-muted-foreground"><tr>{["الصورة","الطبق","الفئة","البيع","الكلفة","المخزون","الحالة"].map(header=><th key={header} className="p-3">{header}</th>)}</tr></thead><tbody>{dishes.data?.items.map(dish=><tr key={dish.id} className="border-b border-border/20"><td className="p-3"><DishImageControl dish={dish}/></td><td className="p-3"><b>{dish.name}</b><small className="mr-2 text-muted-foreground">{dish.code}</small></td><td className="p-3">{dish.category_name}</td><td className="p-3">{money(dish.selling_price)}</td><td className="p-3">{money(dish.cost)}</td><td className={`p-3 ${dish.stock_quantity<=dish.min_stock?"text-destructive font-bold":""}`}>{dish.stock_quantity} {dish.unit}</td><td className="p-3">{dish.is_active&&dish.available_for_sale?"متاح":"موقوف"}</td></tr>)}</tbody></table></div>
  </div>;
}
