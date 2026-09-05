import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, TriangleAlert } from "lucide-react";
import type { KoshaManagerDetail } from "@/lib/kosha-manager-contract";
import { sourceQuery, executionLabels } from "@/lib/kosha-manager";
import { adminFetch } from "@/views/admin/_lib";
import { Button } from "@/components/ui/button";
import { BookingStatusBadge } from "./booking-presentation";

function Photos({title,urls}:{title:string;urls:string[]}) {
  return <section className="space-y-3"><h4 className="flex items-center gap-2 text-sm font-semibold"><Camera size={16}/>{title} <span className="font-normal text-slate-500">({urls.length})</span></h4>{urls.length?<div className="grid grid-cols-3 gap-2">{[...new Set(urls)].map(url=><a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label={`فتح ${title}`} className="overflow-hidden rounded-xl border border-slate-100"><img src={url} alt={title} loading="lazy" className="aspect-square w-full object-cover"/></a>)}</div>:<p className="text-xs text-slate-500">لا توجد صور مرفوعة.</p>}</section>;
}
export function StaffExecutionPanel({detail}:{detail:KoshaManagerDetail}) {
  const client=useQueryClient();
  const [resolving,setResolving]=useState<number|null>(null);
  const [note,setNote]=useState("");
  const mutation=useMutation({mutationFn:(id:number)=>adminFetch(`/admin/kosha-bookings/${detail.booking.id}/manager-view/problems/${id}/resolve?${sourceQuery(detail.booking)}`,{method:"POST",body:JSON.stringify({note})}),onSuccess:()=>{setResolving(null);setNote("");void client.invalidateQueries({queryKey:["admin","kosha-manager"]});}});
  if(!detail.permissions.execution)return <p className="text-sm text-slate-500">عرض تنفيذ الكادر يتطلب صلاحية التنفيذ.</p>;
  const damageMedia=detail.media.filter(m=>["breakage","loss","damage","problem"].includes(m.purpose));
  const executionMedia=detail.media.filter(m=>m.kind==="image"&&!["breakage","loss","damage","problem","signature","reference"].includes(m.purpose));
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">تنفيذ الكادر</h3><BookingStatusBadge status={detail.booking.executionStage||"booked"} execution/></div>
    <div className="rounded-xl bg-[#faf8f5] p-3 text-sm"><span className="text-slate-500">الفريق: </span>{[...new Set(detail.assignedStaff.map(s=>s.name))].join("، ")||"لم يُعيّن فريق بعد"}{detail.workOrder&&<p className="mt-2 text-xs text-slate-500">أمر العمل {detail.workOrder.number} · {detail.workOrder.leaderName||"لم يحدد مسؤول الفريق"}</p>}</div>
    <Photos title="صور تعليمات المدير والمرجع" urls={detail.referencePhotos}/>
    <Photos title="صور تنفيذ الكادر" urls={executionMedia.map(m=>m.url)}/>
    <Photos title="صور الأضرار والمشكلات" urls={[...damageMedia.filter(m=>m.kind==="image").map(m=>m.url),...detail.damages.flatMap(d=>d.photoUrl?[d.photoUrl]:[])]}/>
    {detail.media.filter(m=>m.kind==="video").map(m=><video key={m.id} src={m.url} controls preload="none" className="w-full rounded-xl" aria-label="فيديو تنفيذ الكادر"/>)}
    <section className="space-y-3"><h4 className="font-semibold">المشكلات وتقارير الأضرار</h4>{!detail.damages.length&&<p className="text-sm text-slate-500">لا توجد مشكلات مسجلة.</p>}{detail.damages.map(d=><article key={d.id} className="space-y-2 rounded-xl border border-amber-100 p-4"><div className="flex items-start gap-2">{d.status==="resolved"?<CheckCircle2 size={18} className="shrink-0 text-emerald-700"/>:<TriangleAlert size={18} className="shrink-0 text-amber-700"/>}<p className="whitespace-pre-wrap break-words text-sm">{d.description}</p></div><p className="text-xs text-slate-500">{d.staffName||"الكادر"} · {d.status==="resolved"?"تمت المعالجة — التقرير محفوظ":d.status==="closed"?"مغلقة":"مشكلة مسجلة"}</p>{d.canResolve&&<Button variant="outline" size="sm" onClick={()=>{setResolving(d.id);setNote("");mutation.reset();}}>تسجيل المعالجة</Button>}{resolving===d.id&&<div className="space-y-2"><label className="block text-sm">تفاصيل المعالجة<textarea className="mt-2 min-h-20 w-full rounded-lg border p-2" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)}/></label><p className="text-xs text-slate-500">يحفظ التقرير وسجل المعالجة؛ لا يغيّر المخزون أو المبالغ المالية.</p>{mutation.isError&&<p role="alert" className="text-sm text-red-700">{mutation.error.message}</p>}<div className="flex gap-2"><Button size="sm" disabled={!note.trim()||mutation.isPending} onClick={()=>mutation.mutate(d.id)}>{mutation.isPending?"جارٍ الحفظ…":"حفظ المعالجة"}</Button><Button variant="ghost" size="sm" onClick={()=>setResolving(null)}>إلغاء</Button></div></div>}</article>)}</section>
    <section><h4 className="mb-4 font-semibold">سجل التنفيذ</h4>{!detail.timeline.length&&<p className="text-sm text-slate-500">لا توجد تحديثات تنفيذ مسجلة.</p>}<ol className="space-y-4 border-s border-[#e9decc] ps-4">{detail.timeline.map(e=><li key={e.id} className="relative"><span className="absolute -start-[21px] top-1.5 h-2 w-2 rounded-full bg-[#ad8c58]"/><p className="text-sm font-medium">{e.title}</p>{e.note&&<p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-600">{e.note}</p>}<p className="mt-1 text-xs text-slate-500">{e.staffName||"الكادر"}{e.createdAt&&` · ${new Date(e.createdAt).toLocaleString("ar-IQ")}`}</p>{e.fromStage&&e.toStage&&<p className="text-xs text-slate-500">{executionLabels[e.fromStage]||e.fromStage} ← {executionLabels[e.toStage]||e.toStage}</p>}</li>)}</ol></section>
  </div>;
}
