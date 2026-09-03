"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageIcon, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { adminFetch } from "@/views/admin/_lib";

export type AjnMediaSelection = { id:number; mediaUrl:string; thumbnailUrl?:string|null; titleAr?:string|null; category?:string; tags?:string[] };
type Result={items:AjnMediaSelection[]};

/** Central chooser: consumers receive a gallery reference, never a copied upload. */
export function AjnMediaPicker({ open, onOpenChange, onSelect, title="اختيار من معرض AJN" }:{open:boolean;onOpenChange:(open:boolean)=>void;onSelect:(media:AjnMediaSelection)=>void;title?:string}){
 const[search,setSearch]=useState("");const query=useMemo(()=>{const p=new URLSearchParams({detailed:"1",pageSize:"24",status:"published"});if(search.trim())p.set("search",search.trim());return p;},[search]);
 const media=useQuery({queryKey:["ajn-media-picker",query.toString()],queryFn:()=>adminFetch<Result>(`/gallery?${query}`),enabled:open});
 if(!open)return null;
 return <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" dir="rtl" role="dialog" aria-modal="true" aria-label={title}><section className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card shadow-xl"><header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card p-4"><div><h2 className="font-bold">{title}</h2><p className="text-sm text-muted-foreground">اختر وسائط موجودة من المكتبة المركزية.</p></div><button onClick={()=>onOpenChange(false)} aria-label="إغلاق"><X/></button></header><div className="p-4"><label className="relative block"><Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground"/><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="ابحث بالعنوان أو القسم" className="h-10 w-full rounded-lg border border-border bg-background pr-9 pl-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"/></label>{media.isLoading?<p className="py-10 text-center text-sm text-muted-foreground">جاري تحميل الوسائط…</p>:!media.data?.items.length?<div className="py-10 text-center text-sm text-muted-foreground"><ImageIcon className="mx-auto mb-2 h-7 w-7"/>لا توجد وسائط مطابقة.</div>:<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{media.data.items.map(item=><button key={item.id} onClick={()=>{onSelect(item);onOpenChange(false)}} className="overflow-hidden rounded-xl border border-border text-right transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"><img loading="lazy" src={item.thumbnailUrl??item.mediaUrl} alt={item.titleAr??"وسائط AJN"} className="aspect-square w-full object-cover"/><span className="block truncate p-2 text-xs">{item.titleAr??item.category??"وسائط"}</span></button>)}</div>}<div className="mt-4 flex justify-end"><Button variant="outline" onClick={()=>onOpenChange(false)}>إلغاء</Button></div></div></section></div>;
}
